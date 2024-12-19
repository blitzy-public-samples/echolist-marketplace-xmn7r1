import { injectable } from 'inversify'; // ^6.0.1
import { EBay } from 'ebay-api-node'; // ^2.0.0
import axios from 'axios'; // ^1.0.0
import { CircuitBreaker } from 'opossum'; // ^6.0.0
import { RateLimit } from 'async-sema'; // ^3.1.0

import { IMarketplaceCredentials, IMarketplaceSync } from '../../interfaces/marketplace.interface';
import { IListing } from '../../interfaces/listing.interface';
import { SYNC_STATUS } from '../../constants/status.constants';
import { RabbitMQService } from '../queue/rabbitmq.service';
import { logger } from '../../utils/logger.util';

// Constants for eBay service configuration
const EBAY_API_VERSION = 'v1.18.0';
const EBAY_API_TIMEOUT = 30000;
const EBAY_SYNC_QUEUE = 'ebay-sync-queue';
const EBAY_RETRY_ATTEMPTS = 3;
const EBAY_RATE_LIMIT = 5000; // 5 seconds between requests
const EBAY_CIRCUIT_TIMEOUT = 60000; // 1 minute circuit breaker timeout

/**
 * Service class implementing comprehensive eBay marketplace integration
 * with robust error handling, rate limiting, and event-driven operations
 */
@injectable()
export class EbayService {
    private ebayClient: EBay;
    private credentials: IMarketplaceCredentials;
    private circuitBreaker: CircuitBreaker;
    private rateLimiter: RateLimit;

    constructor(private queueService: RabbitMQService) {
        this.initializeService();
    }

    /**
     * Initializes the eBay service with required configurations
     */
    private async initializeService(): Promise<void> {
        try {
            // Initialize rate limiter
            this.rateLimiter = new RateLimit({
                interval: EBAY_RATE_LIMIT,
                tokensPerInterval: 1,
                timeout: EBAY_API_TIMEOUT
            });

            // Initialize circuit breaker
            this.circuitBreaker = new CircuitBreaker(async (operation: Function) => {
                await this.rateLimiter.acquire();
                return operation();
            }, {
                timeout: EBAY_CIRCUIT_TIMEOUT,
                resetTimeout: EBAY_CIRCUIT_TIMEOUT * 2,
                errorThresholdPercentage: 50,
                volumeThreshold: 10
            });

            // Set up circuit breaker event handlers
            this.setupCircuitBreakerEvents();

            // Initialize eBay client
            await this.authenticateEbay();

            logger.info('eBay service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize eBay service', { error });
            throw error;
        }
    }

    /**
     * Authenticates with eBay API using OAuth
     */
    public async authenticateEbay(): Promise<void> {
        try {
            this.credentials = {
                platform: 'EBAY',
                apiKey: process.env.EBAY_APP_ID!,
                secretKey: process.env.EBAY_CERT_ID!,
                refreshToken: process.env.EBAY_DEV_ID!
            };

            this.ebayClient = new EBay({
                appId: this.credentials.apiKey,
                certId: this.credentials.secretKey,
                devId: this.credentials.refreshToken,
                sandbox: process.env.NODE_ENV !== 'production'
            });

            logger.info('eBay authentication successful');
        } catch (error) {
            logger.error('eBay authentication failed', { error });
            throw error;
        }
    }

    /**
     * Creates a new listing on eBay
     */
    public async createEbayListing(listing: IListing): Promise<IMarketplaceSync> {
        return this.circuitBreaker.fire(async () => {
            try {
                const ebayListing = this.formatListingForEbay(listing);
                
                const response = await this.ebayClient.trading.addFixedPriceItem({
                    Item: ebayListing
                });

                const syncRecord: IMarketplaceSync = {
                    listingId: listing.id,
                    platform: 'EBAY',
                    externalId: response.ItemID,
                    status: SYNC_STATUS.SYNCED,
                    lastSyncAttempt: new Date(),
                    syncErrors: []
                };

                // Publish sync event to queue
                await this.queueService.publishMessage(
                    'marketplace_sync',
                    'sync.listing',
                    Buffer.from(JSON.stringify(syncRecord))
                );

                logger.info('eBay listing created successfully', { listingId: listing.id, ebayItemId: response.ItemID });
                return syncRecord;
            } catch (error) {
                logger.error('Failed to create eBay listing', { error, listingId: listing.id });
                throw error;
            }
        });
    }

    /**
     * Updates an existing eBay listing
     */
    public async updateEbayListing(externalId: string, updateData: Partial<IListing>): Promise<IMarketplaceSync> {
        return this.circuitBreaker.fire(async () => {
            try {
                const ebayUpdateData = this.formatListingForEbay(updateData as IListing);
                
                await this.ebayClient.trading.reviseFixedPriceItem({
                    Item: {
                        ItemID: externalId,
                        ...ebayUpdateData
                    }
                });

                const syncRecord: IMarketplaceSync = {
                    listingId: updateData.id!,
                    platform: 'EBAY',
                    externalId,
                    status: SYNC_STATUS.SYNCED,
                    lastSyncAttempt: new Date(),
                    syncErrors: []
                };

                logger.info('eBay listing updated successfully', { externalId });
                return syncRecord;
            } catch (error) {
                logger.error('Failed to update eBay listing', { error, externalId });
                throw error;
            }
        });
    }

    /**
     * Deletes an eBay listing
     */
    public async deleteEbayListing(externalId: string): Promise<void> {
        return this.circuitBreaker.fire(async () => {
            try {
                await this.ebayClient.trading.endFixedPriceItem({
                    ItemID: externalId,
                    EndingReason: 'NotAvailable'
                });

                logger.info('eBay listing deleted successfully', { externalId });
            } catch (error) {
                logger.error('Failed to delete eBay listing', { error, externalId });
                throw error;
            }
        });
    }

    /**
     * Synchronizes inventory levels with eBay
     */
    public async syncInventory(externalId: string, quantity: number): Promise<void> {
        return this.circuitBreaker.fire(async () => {
            try {
                await this.ebayClient.trading.reviseFixedPriceItem({
                    Item: {
                        ItemID: externalId,
                        Quantity: quantity
                    }
                });

                logger.info('eBay inventory synced successfully', { externalId, quantity });
            } catch (error) {
                logger.error('Failed to sync eBay inventory', { error, externalId });
                throw error;
            }
        });
    }

    /**
     * Formats listing data for eBay API
     */
    private formatListingForEbay(listing: IListing): any {
        return {
            Title: listing.title,
            Description: listing.description,
            StartPrice: listing.price,
            Quantity: 1,
            ListingDuration: 'GTC',
            Country: 'US',
            Currency: 'USD',
            PaymentMethods: ['PayPal'],
            PictureDetails: {
                PictureURL: listing.images
            },
            ShippingDetails: this.formatShippingDetails(listing.shipping),
            ReturnPolicy: {
                ReturnsAcceptedOption: 'ReturnsAccepted',
                RefundOption: 'MoneyBack',
                ReturnsWithinOption: 'Days_30',
                ShippingCostPaidByOption: 'Buyer'
            }
        };
    }

    /**
     * Formats shipping details for eBay API
     */
    private formatShippingDetails(shipping: any): any {
        return {
            ShippingType: shipping.offersShipping ? 'Flat' : 'NotSpecified',
            ShippingServiceOptions: shipping.offersShipping ? [{
                ShippingService: 'USPSPriority',
                ShippingServiceCost: shipping.estimatedShippingCost,
                ShippingServiceAdditionalCost: 0
            }] : undefined
        };
    }

    /**
     * Sets up circuit breaker event handlers
     */
    private setupCircuitBreakerEvents(): void {
        this.circuitBreaker.on('open', () => {
            logger.warn('eBay circuit breaker opened');
        });

        this.circuitBreaker.on('halfOpen', () => {
            logger.info('eBay circuit breaker half-opened');
        });

        this.circuitBreaker.on('close', () => {
            logger.info('eBay circuit breaker closed');
        });

        this.circuitBreaker.on('reject', () => {
            logger.warn('eBay circuit breaker rejected request');
        });
    }
}

export default EbayService;