/**
 * @fileoverview Marketplace Routes Configuration
 * Implements secure routing for multi-platform marketplace operations with comprehensive
 * validation, rate limiting, and monitoring.
 * @version 1.0.0
 */

import { Router } from 'express'; // ^4.17.1
import rateLimit from 'express-rate-limit'; // ^5.2.6
import { MarketplaceController } from '../controllers/marketplace.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validateRequestBody } from '../middlewares/validation.middleware';
import { marketplaceSchemas } from '../validators/marketplace.validator';
import { logger } from '../../utils/logger.util';
import { MARKETPLACE_ERRORS } from '../../constants/error.constants';

// Initialize router
const router = Router();

// Configure rate limiters for different endpoints
const authRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 requests per hour
    message: { error: MARKETPLACE_ERRORS.RATE_LIMIT_EXCEEDED }
});

const listingRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1000, // 1000 requests per hour
    message: { error: MARKETPLACE_ERRORS.RATE_LIMIT_EXCEEDED }
});

const syncRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 100, // 100 sync requests per hour
    message: { error: MARKETPLACE_ERRORS.RATE_LIMIT_EXCEEDED }
});

/**
 * Marketplace platform authentication route
 * @route POST /api/marketplace/authenticate
 * @security JWT
 */
router.post(
    '/authenticate',
    authenticate,
    authRateLimiter,
    validateRequestBody(marketplaceSchemas.marketplaceCredentialsSchema),
    async (req, res, next) => {
        try {
            logger.info('Marketplace authentication attempt', {
                platform: req.body.platform,
                userId: req.user?.id
            });

            const response = await MarketplaceController.authenticateMarketplace(req.body);
            res.json(response);
        } catch (error) {
            logger.error('Marketplace authentication failed', {
                error,
                platform: req.body.platform,
                userId: req.user?.id
            });
            next(error);
        }
    }
);

/**
 * Create listing on marketplace platforms
 * @route POST /api/marketplace/listings
 * @security JWT
 */
router.post(
    '/listings',
    authenticate,
    listingRateLimiter,
    validateRequestBody(marketplaceSchemas.createListingSchema),
    async (req, res, next) => {
        try {
            logger.info('Creating marketplace listing', {
                platforms: req.body.platforms,
                userId: req.user?.id
            });

            const response = await MarketplaceController.createListing(req.body);
            res.json(response);
        } catch (error) {
            logger.error('Marketplace listing creation failed', {
                error,
                platforms: req.body.platforms,
                userId: req.user?.id
            });
            next(error);
        }
    }
);

/**
 * Update existing marketplace listing
 * @route PUT /api/marketplace/listings/:externalId
 * @security JWT
 */
router.put(
    '/listings/:externalId',
    authenticate,
    listingRateLimiter,
    validateRequestBody(marketplaceSchemas.updateListingSchema),
    async (req, res, next) => {
        try {
            logger.info('Updating marketplace listing', {
                externalId: req.params.externalId,
                userId: req.user?.id
            });

            const response = await MarketplaceController.updateListing(
                req.params.externalId,
                req.body
            );
            res.json(response);
        } catch (error) {
            logger.error('Marketplace listing update failed', {
                error,
                externalId: req.params.externalId,
                userId: req.user?.id
            });
            next(error);
        }
    }
);

/**
 * Synchronize inventory across marketplaces
 * @route POST /api/marketplace/inventory/sync
 * @security JWT
 */
router.post(
    '/inventory/sync',
    authenticate,
    syncRateLimiter,
    validateRequestBody(marketplaceSchemas.syncInventorySchema),
    async (req, res, next) => {
        try {
            logger.info('Initiating inventory sync', {
                platforms: req.body.platforms,
                userId: req.user?.id
            });

            const response = await MarketplaceController.syncInventory(req.body);
            res.json(response);
        } catch (error) {
            logger.error('Inventory sync failed', {
                error,
                platforms: req.body.platforms,
                userId: req.user?.id
            });
            next(error);
        }
    }
);

/**
 * Get marketplace platform status
 * @route GET /api/marketplace/status
 * @security JWT
 */
router.get(
    '/status',
    authenticate,
    listingRateLimiter,
    async (req, res, next) => {
        try {
            logger.info('Fetching marketplace status', {
                userId: req.user?.id
            });

            const response = await MarketplaceController.getMarketplaceStatus();
            res.json(response);
        } catch (error) {
            logger.error('Failed to fetch marketplace status', {
                error,
                userId: req.user?.id
            });
            next(error);
        }
    }
);

// Export configured router
export const marketplaceRouter = router;