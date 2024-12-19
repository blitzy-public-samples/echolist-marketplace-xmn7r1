/**
 * @fileoverview Marketplace Synchronization Worker
 * Handles asynchronous marketplace synchronization tasks for EchoList platform
 * with robust error handling, retry mechanisms, and monitoring.
 * @version 1.0.0
 */

import { injectable } from 'inversify'; // ^6.0.1
import CircuitBreaker from 'opossum'; // ^6.0.0
import retry from 'retry'; // ^0.13.1

import { AmazonService } from '../services/external/amazon.service';
import { EbayService } from '../services/external/ebay.service';
import { WalmartService } from '../services/external/walmart.service';
import { RabbitMQService } from '../services/queue/rabbitmq.service';
import { logger } from '../utils/logger.util';

// Queue configuration constants
const MARKETPLACE_SYNC_QUEUES = {
    LISTING_CREATE: 'marketplace.listing.create',
    LISTING_UPDATE: 'marketplace.listing.update',
    INVENTORY_SYNC: 'marketplace.inventory.sync',
    DEAD_LETTER: 'marketplace.dead.letter'
} as const;

// Retry configuration
const RETRY_CONFIG = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    BACKOFF_FACTOR: 2
} as const;

// Rate limiting configuration
const RATE_LIMITS = {
    AMAZON: 5, // requests per second
    EBAY: 3,
    WALMART: 4
} as const;

@injectable()
export class MarketplaceSyncWorker {
    private queueService: RabbitMQService;
    private circuitBreaker: CircuitBreaker;
    private maxRetries: number = RETRY_CONFIG.MAX_RETRIES;
    private retryDelay: number = RETRY_CONFIG.RETRY_DELAY;
    private isShuttingDown: boolean = false;

    constructor(
        private readonly amazonService: AmazonService,
        private readonly ebayService: EbayService,
        private readonly walmartService: WalmartService
    ) {
        this.initializeCircuitBreaker();
    }

    /**
     * Starts the marketplace sync worker
     */
    public async start(): Promise<void> {
        try {
            this.queueService = RabbitMQService.getInstance();
            await this.queueService.initialize();

            // Set up dead letter queue
            await this.queueService.setupDeadLetterQueue(
                MARKETPLACE_SYNC_QUEUES.DEAD_LETTER,
                'marketplace_sync'
            );

            // Set up message consumers
            await this.setupConsumers();

            logger.info('Marketplace sync worker started successfully');
        } catch (error) {
            logger.error('Failed to start marketplace sync worker', { error });
            throw error;
        }
    }

    /**
     * Handles listing creation across marketplaces
     */
    private async handleListingCreation(message: any): Promise<void> {
        const correlationId = message.properties?.correlationId || 'unknown';
        logger.info('Processing listing creation', { correlationId });

        try {
            const { listingData, platforms } = JSON.parse(message.content.toString());

            const syncPromises = platforms.map(async (platform: string) => {
                const operation = retry.operation({
                    retries: this.maxRetries,
                    factor: RETRY_CONFIG.BACKOFF_FACTOR,
                    minTimeout: this.retryDelay
                });

                return new Promise((resolve, reject) => {
                    operation.attempt(async (currentAttempt) => {
                        try {
                            let result;
                            switch (platform) {
                                case 'AMAZON':
                                    result = await this.amazonService.createListing(
                                        listingData.id,
                                        listingData
                                    );
                                    break;
                                case 'EBAY':
                                    result = await this.ebayService.createEbayListing(
                                        listingData
                                    );
                                    break;
                                case 'WALMART':
                                    result = await this.walmartService.createListing(
                                        listingData
                                    );
                                    break;
                                default:
                                    throw new Error(`Unsupported platform: ${platform}`);
                            }
                            resolve(result);
                        } catch (error) {
                            if (operation.retry(error)) {
                                logger.warn(`Retrying listing creation for ${platform}`, {
                                    attempt: currentAttempt,
                                    correlationId
                                });
                                return;
                            }
                            reject(error);
                        }
                    });
                });
            });

            await Promise.all(syncPromises);
            logger.info('Listing creation completed', { correlationId });
        } catch (error) {
            logger.error('Failed to process listing creation', {
                error,
                correlationId
            });
            throw error;
        }
    }

    /**
     * Handles listing updates across marketplaces
     */
    private async handleListingUpdate(message: any): Promise<void> {
        const correlationId = message.properties?.correlationId || 'unknown';
        logger.info('Processing listing update', { correlationId });

        try {
            const { externalId, platform, updateData } = JSON.parse(
                message.content.toString()
            );

            await this.circuitBreaker.fire(async () => {
                switch (platform) {
                    case 'AMAZON':
                        await this.amazonService.updateListing(externalId, updateData);
                        break;
                    case 'EBAY':
                        await this.ebayService.updateEbayListing(externalId, updateData);
                        break;
                    case 'WALMART':
                        await this.walmartService.updateListing(externalId, updateData);
                        break;
                    default:
                        throw new Error(`Unsupported platform: ${platform}`);
                }
            });

            logger.info('Listing update completed', { correlationId, platform });
        } catch (error) {
            logger.error('Failed to process listing update', {
                error,
                correlationId
            });
            throw error;
        }
    }

    /**
     * Handles inventory synchronization across marketplaces
     */
    private async handleInventorySync(message: any): Promise<void> {
        const correlationId = message.properties?.correlationId || 'unknown';
        logger.info('Processing inventory sync', { correlationId });

        try {
            const { externalId, platform, quantity } = JSON.parse(
                message.content.toString()
            );

            await this.circuitBreaker.fire(async () => {
                switch (platform) {
                    case 'AMAZON':
                        await this.amazonService.syncInventory(externalId, quantity);
                        break;
                    case 'EBAY':
                        await this.ebayService.syncInventory(externalId, quantity);
                        break;
                    case 'WALMART':
                        await this.walmartService.syncInventory(externalId, quantity);
                        break;
                    default:
                        throw new Error(`Unsupported platform: ${platform}`);
                }
            });

            logger.info('Inventory sync completed', { correlationId, platform });
        } catch (error) {
            logger.error('Failed to process inventory sync', {
                error,
                correlationId
            });
            throw error;
        }
    }

    /**
     * Sets up message consumers for different sync operations
     */
    private async setupConsumers(): Promise<void> {
        await this.queueService.consumeMessage(
            MARKETPLACE_SYNC_QUEUES.LISTING_CREATE,
            this.handleListingCreation.bind(this)
        );

        await this.queueService.consumeMessage(
            MARKETPLACE_SYNC_QUEUES.LISTING_UPDATE,
            this.handleListingUpdate.bind(this)
        );

        await this.queueService.consumeMessage(
            MARKETPLACE_SYNC_QUEUES.INVENTORY_SYNC,
            this.handleInventorySync.bind(this)
        );
    }

    /**
     * Initializes circuit breaker for API calls
     */
    private initializeCircuitBreaker(): void {
        this.circuitBreaker = new CircuitBreaker(async (operation: Function) => {
            return operation();
        }, {
            timeout: 30000,
            errorThresholdPercentage: 50,
            resetTimeout: 30000
        });

        this.setupCircuitBreakerEvents();
    }

    /**
     * Sets up circuit breaker event handlers
     */
    private setupCircuitBreakerEvents(): void {
        this.circuitBreaker.on('open', () => {
            logger.warn('Marketplace sync circuit breaker opened');
        });

        this.circuitBreaker.on('halfOpen', () => {
            logger.info('Marketplace sync circuit breaker half-opened');
        });

        this.circuitBreaker.on('close', () => {
            logger.info('Marketplace sync circuit breaker closed');
        });
    }

    /**
     * Gracefully shuts down the worker
     */
    public async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        logger.info('Shutting down marketplace sync worker');
        
        try {
            await this.queueService.closeConnection();
            logger.info('Marketplace sync worker shutdown completed');
        } catch (error) {
            logger.error('Error during worker shutdown', { error });
            throw error;
        }
    }
}

export default MarketplaceSyncWorker;