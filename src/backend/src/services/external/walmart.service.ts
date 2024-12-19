import { injectable } from 'inversify'; // ^6.0.1
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'; // ^1.4.0
import crypto from 'crypto'; // ^1.0.1
import { CacheManager } from 'cache-manager'; // ^5.2.0
import { RateLimiterMemory } from 'rate-limiter-flexible'; // ^2.4.1
import CircuitBreaker from 'circuit-breaker-js'; // ^0.0.1

import { IMarketplaceCredentials, IMarketplaceSync } from '../../interfaces/marketplace.interface';
import { RabbitMQService } from '../queue/rabbitmq.service';
import { logger } from '../../utils/logger.util';
import { SYNC_STATUS } from '../../constants/status.constants';
import { IListing } from '../../interfaces/listing.interface';

/**
 * Constants for Walmart API integration
 */
const WALMART_API_VERSION = 'v3';
const WALMART_API_TIMEOUT = 30000;
const WALMART_INVENTORY_SYNC_QUEUE = 'walmart.inventory.sync';
const WALMART_MAX_RETRY_ATTEMPTS = 3;
const WALMART_RETRY_DELAY = 5000;
const WALMART_CACHE_TTL = 300; // 5 minutes
const WALMART_RATE_LIMIT_WINDOW = 60000; // 1 minute
const WALMART_RATE_LIMIT_MAX = 100; // requests per window

/**
 * Enhanced Walmart Marketplace API integration service with advanced features
 * for reliability, performance, and security.
 */
@injectable()
export class WalmartService {
    private readonly httpClient: AxiosInstance;
    private readonly baseUrl: string;
    private readonly credentials: IMarketplaceCredentials;
    private readonly circuitBreaker: CircuitBreaker;
    private readonly rateLimiter: RateLimiterMemory;
    private readonly cacheManager: CacheManager;
    private readonly queueService: RabbitMQService;

    constructor(
        queueService: RabbitMQService,
        credentials: IMarketplaceCredentials,
        circuitBreaker: CircuitBreaker,
        rateLimiter: RateLimiterMemory,
        cacheManager: CacheManager
    ) {
        this.queueService = queueService;
        this.credentials = credentials;
        this.circuitBreaker = circuitBreaker;
        this.rateLimiter = rateLimiter;
        this.cacheManager = cacheManager;
        this.baseUrl = `https://marketplace.walmartapis.com/${WALMART_API_VERSION}`;

        // Initialize HTTP client with enhanced configuration
        this.httpClient = axios.create({
            baseURL: this.baseUrl,
            timeout: WALMART_API_TIMEOUT,
            headers: this.getDefaultHeaders(),
        });

        // Add request interceptor for authentication
        this.httpClient.interceptors.request.use(
            this.addAuthenticationHeaders.bind(this)
        );

        // Add response interceptor for error handling
        this.httpClient.interceptors.response.use(
            response => response,
            this.handleRequestError.bind(this)
        );
    }

    /**
     * Creates a new listing on Walmart Marketplace
     * @param listingData - The listing data to be created
     * @returns Promise with sync status
     */
    public async createListing(listingData: IListing): Promise<IMarketplaceSync> {
        try {
            // Check rate limits
            await this.rateLimiter.consume('createListing', 1);

            // Transform listing data to Walmart format
            const walmartListing = this.transformListingToWalmart(listingData);

            // Execute request with circuit breaker
            const response = await this.executeWithCircuitBreaker(
                'createListing',
                async () => {
                    return this.httpClient.post('/items', walmartListing);
                }
            );

            // Create sync record
            const syncRecord: IMarketplaceSync = {
                externalId: response.data.itemId,
                status: SYNC_STATUS.SYNCED,
                retryCount: 0,
                lastError: null
            };

            // Queue inventory sync
            await this.queueInventorySync(syncRecord.externalId, listingData);

            return syncRecord;
        } catch (error) {
            logger.error('Failed to create Walmart listing', { error, listingId: listingData.id });
            throw error;
        }
    }

    /**
     * Updates an existing listing on Walmart Marketplace
     * @param externalId - Walmart item ID
     * @param updateData - Updated listing data
     * @returns Promise with sync status
     */
    public async updateListing(
        externalId: string,
        updateData: Partial<IListing>
    ): Promise<IMarketplaceSync> {
        try {
            // Check rate limits
            await this.rateLimiter.consume('updateListing', 1);

            // Check cache for existing data
            const cacheKey = `walmart_listing_${externalId}`;
            const cachedData = await this.cacheManager.get(cacheKey);

            // Transform update data
            const walmartUpdate = this.transformListingToWalmart({
                ...cachedData,
                ...updateData
            });

            // Execute update with circuit breaker
            const response = await this.executeWithCircuitBreaker(
                'updateListing',
                async () => {
                    return this.httpClient.put(`/items/${externalId}`, walmartUpdate);
                }
            );

            // Update cache
            await this.cacheManager.set(cacheKey, response.data, WALMART_CACHE_TTL);

            return {
                externalId,
                status: SYNC_STATUS.SYNCED,
                retryCount: 0,
                lastError: null
            };
        } catch (error) {
            logger.error('Failed to update Walmart listing', { error, externalId });
            throw error;
        }
    }

    /**
     * Synchronizes inventory levels with Walmart Marketplace
     * @param externalId - Walmart item ID
     * @param quantity - Updated quantity
     * @returns Promise indicating success
     */
    public async syncInventory(externalId: string, quantity: number): Promise<boolean> {
        try {
            // Check rate limits
            await this.rateLimiter.consume('syncInventory', 1);

            const inventoryUpdate = {
                sku: externalId,
                quantity: {
                    amount: quantity,
                    unit: 'EACH'
                }
            };

            // Execute inventory sync with circuit breaker
            await this.executeWithCircuitBreaker(
                'syncInventory',
                async () => {
                    return this.httpClient.put(
                        `/inventory/items/${externalId}`,
                        inventoryUpdate
                    );
                }
            );

            return true;
        } catch (error) {
            logger.error('Failed to sync Walmart inventory', { error, externalId });
            throw error;
        }
    }

    /**
     * Private helper methods
     */

    private getDefaultHeaders(): Record<string, string> {
        return {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'WM_SVC.NAME': 'EchoList',
            'WM_QOS.CORRELATION_ID': crypto.randomUUID()
        };
    }

    private async addAuthenticationHeaders(
        config: AxiosRequestConfig
    ): Promise<AxiosRequestConfig> {
        const timestamp = new Date().toISOString();
        const signature = this.generateAuthSignature(
            config.method?.toUpperCase() || 'GET',
            config.url || '',
            timestamp
        );

        config.headers = {
            ...config.headers,
            'WM_SEC.AUTH_SIGNATURE': signature,
            'WM_SEC.TIMESTAMP': timestamp,
            'WM_SEC.ACCESS_TOKEN': this.credentials.apiKey
        };

        return config;
    }

    private generateAuthSignature(
        method: string,
        endpoint: string,
        timestamp: string
    ): string {
        const data = `${this.credentials.apiKey}\n${endpoint}\n${method}\n${timestamp}\n`;
        return crypto
            .createHmac('sha256', this.credentials.secretKey)
            .update(data)
            .digest('base64');
    }

    private async executeWithCircuitBreaker<T>(
        operation: string,
        fn: () => Promise<T>
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            this.circuitBreaker.run(
                async () => {
                    try {
                        const result = await fn();
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                },
                () => {
                    reject(new Error(`Circuit breaker open for operation: ${operation}`));
                }
            );
        });
    }

    private async handleRequestError(error: any): Promise<never> {
        const errorData = {
            status: error.response?.status,
            data: error.response?.data,
            headers: error.response?.headers
        };

        logger.error('Walmart API request failed', { error: errorData });

        if (error.response?.status === 429) {
            await this.handleRateLimitError();
        }

        throw error;
    }

    private async handleRateLimitError(): Promise<void> {
        const retryAfter = parseInt(error.response?.headers['retry-after'] || '5');
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    }

    private async queueInventorySync(
        externalId: string,
        listing: IListing
    ): Promise<void> {
        await this.queueService.publishMessage(
            'marketplace_sync',
            WALMART_INVENTORY_SYNC_QUEUE,
            Buffer.from(JSON.stringify({
                externalId,
                quantity: listing.quantity,
                timestamp: new Date().toISOString()
            }))
        );
    }

    private transformListingToWalmart(listing: IListing): any {
        // Transform EchoList listing format to Walmart's expected format
        return {
            sku: listing.id,
            productName: listing.title,
            shortDescription: listing.description,
            price: {
                amount: listing.price,
                currency: 'USD'
            },
            // Add other required Walmart fields...
        };
    }
}

export default WalmartService;