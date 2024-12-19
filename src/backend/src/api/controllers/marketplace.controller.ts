/**
 * @fileoverview Marketplace Controller
 * Handles marketplace integration operations with enhanced error handling and monitoring
 * @version 1.0.0
 */

import { injectable, inject } from 'inversify'; // ^6.0.1
import { 
    controller, 
    httpPost, 
    httpPut, 
    httpGet,
    authorize,
    validate
} from 'routing-controllers'; // ^0.10.0
import CircuitBreaker from 'opossum'; // ^6.0.0
import winston from 'winston'; // ^3.8.0

// Internal imports
import { 
    MarketplacePlatform, 
    IMarketplaceCredentials,
    IMarketplaceResponse,
    IMarketplaceSyncOptions,
    MARKETPLACE_API_TIMEOUT
} from '../../interfaces/marketplace.interface';
import { 
    IListing,
    IListingCreationAttributes,
    PlatformSpecificData 
} from '../../interfaces/listing.interface';
import { SYNC_STATUS } from '../../constants/status.constants';
import { LoggingInterceptor } from '../../interceptors/logging.interceptor';
import { MetricsInterceptor } from '../../interceptors/metrics.interceptor';
import { MarketplaceValidator } from '../../validators/marketplace.validator';
import { ApiError } from '../../errors/api.error';

// Service imports
import { EbayService } from '../../services/marketplace/ebay.service';
import { AmazonService } from '../../services/marketplace/amazon.service';
import { WalmartService } from '../../services/marketplace/walmart.service';
import { MetricsService } from '../../services/metrics.service';

/**
 * Enhanced marketplace controller with comprehensive error handling and monitoring
 */
@injectable()
@controller('/api/marketplace')
@authorize()
@useInterceptor(LoggingInterceptor)
@useInterceptor(MetricsInterceptor)
export class MarketplaceController {
    private readonly circuitBreaker: Record<MarketplacePlatform, CircuitBreaker>;
    private readonly platformServices: Map<MarketplacePlatform, any>;

    constructor(
        @inject(EbayService) private readonly ebayService: EbayService,
        @inject(AmazonService) private readonly amazonService: AmazonService,
        @inject(WalmartService) private readonly walmartService: WalmartService,
        @inject('Logger') private readonly logger: winston.Logger,
        @inject(MetricsService) private readonly metricsService: MetricsService
    ) {
        // Initialize platform services map
        this.platformServices = new Map([
            [MarketplacePlatform.EBAY, this.ebayService],
            [MarketplacePlatform.AMAZON, this.amazonService],
            [MarketplacePlatform.WALMART, this.walmartService]
        ]);

        // Initialize circuit breakers for each platform
        this.circuitBreaker = this.initializeCircuitBreakers();
    }

    /**
     * Initialize circuit breakers for external API calls
     */
    private initializeCircuitBreakers(): Record<MarketplacePlatform, CircuitBreaker> {
        const breakers: Record<MarketplacePlatform, CircuitBreaker> = {} as any;
        
        Object.values(MarketplacePlatform).forEach(platform => {
            breakers[platform] = new CircuitBreaker(async (fn: Function) => fn(), {
                timeout: MARKETPLACE_API_TIMEOUT,
                errorThresholdPercentage: 50,
                resetTimeout: 30000,
                name: `marketplace-${platform.toLowerCase()}`
            });

            // Circuit breaker event handlers
            breakers[platform].on('open', () => {
                this.logger.warn(`Circuit breaker opened for ${platform}`);
                this.metricsService.incrementCounter(`marketplace_circuit_breaker_open_${platform}`);
            });

            breakers[platform].on('success', () => {
                this.metricsService.incrementCounter(`marketplace_api_success_${platform}`);
            });

            breakers[platform].on('failure', (error) => {
                this.logger.error(`API call failed for ${platform}:`, error);
                this.metricsService.incrementCounter(`marketplace_api_failure_${platform}`);
            });
        });

        return breakers;
    }

    /**
     * Authenticate with marketplace platform
     * @param credentials Platform credentials
     */
    @httpPost('/authenticate')
    @validate(MarketplaceValidator)
    async authenticateMarketplace(
        @body() credentials: IMarketplaceCredentials
    ): Promise<IMarketplaceResponse> {
        const startTime = Date.now();
        this.logger.info(`Authenticating with ${credentials.platform}`);

        try {
            const service = this.platformServices.get(credentials.platform);
            if (!service) {
                throw new ApiError('UNSUPPORTED_PLATFORM', `Platform ${credentials.platform} not supported`);
            }

            const result = await this.circuitBreaker[credentials.platform].fire(
                () => service.authenticate(credentials)
            );

            this.metricsService.recordTiming(
                `marketplace_auth_duration_${credentials.platform}`,
                Date.now() - startTime
            );

            return result;
        } catch (error) {
            this.logger.error(`Authentication failed for ${credentials.platform}:`, error);
            throw new ApiError('AUTHENTICATION_FAILED', error.message, error);
        }
    }

    /**
     * Create listings across multiple marketplaces
     * @param listingData Listing creation data
     * @param platforms Target marketplace platforms
     */
    @httpPost('/listings/bulk')
    @validate(MarketplaceValidator)
    async createListings(
        @body() listingData: IListingCreationAttributes,
        @body() platforms: MarketplacePlatform[]
    ): Promise<Record<MarketplacePlatform, IMarketplaceResponse>> {
        const startTime = Date.now();
        this.logger.info(`Creating listings across platforms: ${platforms.join(', ')}`);

        const results: Record<MarketplacePlatform, IMarketplaceResponse> = {};
        const errors: Error[] = [];

        await Promise.all(platforms.map(async platform => {
            try {
                const service = this.platformServices.get(platform);
                if (!service) {
                    throw new ApiError('UNSUPPORTED_PLATFORM', `Platform ${platform} not supported`);
                }

                results[platform] = await this.circuitBreaker[platform].fire(
                    () => service.createListing(listingData)
                );

                this.metricsService.incrementCounter(`marketplace_listing_created_${platform}`);
            } catch (error) {
                this.logger.error(`Failed to create listing on ${platform}:`, error);
                errors.push(error);
                results[platform] = {
                    success: false,
                    errors: [error.message],
                    metadata: {
                        timestamp: new Date(),
                        platformSpecific: null
                    }
                } as IMarketplaceResponse;
            }
        }));

        this.metricsService.recordTiming(
            'marketplace_bulk_listing_duration',
            Date.now() - startTime
        );

        if (errors.length === platforms.length) {
            throw new ApiError('BULK_LISTING_FAILED', 'Failed to create listings on all platforms', errors);
        }

        return results;
    }

    /**
     * Sync inventory levels across marketplaces
     * @param listingId Listing ID to sync
     * @param platforms Target platforms
     */
    @httpPut('/listings/:listingId/sync')
    async syncInventory(
        @param('listingId') listingId: string,
        @body() platforms: MarketplacePlatform[]
    ): Promise<Record<MarketplacePlatform, SYNC_STATUS>> {
        const startTime = Date.now();
        this.logger.info(`Syncing inventory for listing ${listingId}`);

        const results: Record<MarketplacePlatform, SYNC_STATUS> = {};

        await Promise.all(platforms.map(async platform => {
            try {
                const service = this.platformServices.get(platform);
                if (!service) {
                    throw new ApiError('UNSUPPORTED_PLATFORM', `Platform ${platform} not supported`);
                }

                await this.circuitBreaker[platform].fire(
                    () => service.syncInventory(listingId)
                );

                results[platform] = SYNC_STATUS.SYNCED;
                this.metricsService.incrementCounter(`marketplace_sync_success_${platform}`);
            } catch (error) {
                this.logger.error(`Inventory sync failed for ${platform}:`, error);
                results[platform] = SYNC_STATUS.FAILED;
                this.metricsService.incrementCounter(`marketplace_sync_failure_${platform}`);
            }
        }));

        this.metricsService.recordTiming(
            'marketplace_sync_duration',
            Date.now() - startTime
        );

        return results;
    }

    /**
     * Get marketplace platform health status
     */
    @httpGet('/health')
    async getPlatformHealth(): Promise<Record<MarketplacePlatform, boolean>> {
        const health: Record<MarketplacePlatform, boolean> = {} as any;

        Object.values(MarketplacePlatform).forEach(platform => {
            health[platform] = !this.circuitBreaker[platform].opened;
        });

        return health;
    }
}