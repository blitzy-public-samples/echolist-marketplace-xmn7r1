/**
 * Shipping Routes Configuration
 * Implements secure routes for USPS shipping operations including label generation,
 * pickup scheduling, box delivery service, and tracking updates.
 * @version 1.0.0
 */

import express, { Router } from 'express'; // ^4.17.1
import rateLimit from 'express-rate-limit'; // ^5.3.0
import { ShippingController } from '../controllers/shipping.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { logger } from '../../utils/logger.util';
import { SHIPPING_ERRORS } from '../../constants/error.constants';
import {
    validateShippingLabel,
    validatePickupRequest,
    validateBoxDelivery,
    validateTrackingUpdate
} from '../validators/shipping.validator';

// Constants for rate limiting
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 100;
const SHIPPING_BASE_PATH = '/api/shipping';

/**
 * Configures rate limiting for shipping endpoints
 */
const createRateLimiter = () => rateLimit({
    windowMs: RATE_LIMIT_WINDOW,
    max: RATE_LIMIT_MAX,
    message: {
        error: 'Too many shipping requests, please try again later',
        code: SHIPPING_ERRORS.RATE_LIMIT_EXCEEDED
    },
    headers: true,
    keyGenerator: (req) => req.user?.id || req.ip
});

/**
 * Initializes shipping routes with security middleware and validation
 * @param shippingController - Instance of ShippingController
 * @returns Configured Express router
 */
const initializeShippingRoutes = (shippingController: ShippingController): Router => {
    const router = express.Router();
    const rateLimiter = createRateLimiter();

    // Apply rate limiting to all shipping routes
    router.use(rateLimiter);

    // Shipping label generation endpoint
    router.post('/label',
        authenticate,
        authorize(['seller']),
        async (req, res, next) => {
            try {
                await validateShippingLabel(req.body);
                await shippingController.generateShippingLabel(req, res, next);
            } catch (error) {
                logger.error('Shipping label generation failed', {
                    error,
                    userId: req.user?.id,
                    requestId: req.headers['x-request-id']
                });
                next(error);
            }
        }
    );

    // Pickup scheduling endpoint
    router.post('/pickup',
        authenticate,
        authorize(['seller']),
        async (req, res, next) => {
            try {
                await validatePickupRequest(req.body);
                await shippingController.schedulePickup(req, res, next);
            } catch (error) {
                logger.error('Pickup scheduling failed', {
                    error,
                    userId: req.user?.id,
                    requestId: req.headers['x-request-id']
                });
                next(error);
            }
        }
    );

    // Box delivery service endpoint
    router.post('/box-delivery',
        authenticate,
        authorize(['seller']),
        async (req, res, next) => {
            try {
                await validateBoxDelivery(req.body);
                await shippingController.requestBoxDelivery(req, res, next);
            } catch (error) {
                logger.error('Box delivery request failed', {
                    error,
                    userId: req.user?.id,
                    requestId: req.headers['x-request-id']
                });
                next(error);
            }
        }
    );

    // Tracking information endpoint with caching
    router.get('/tracking/:trackingNumber',
        authenticate,
        async (req, res, next) => {
            try {
                await validateTrackingUpdate({ trackingNumber: req.params.trackingNumber });
                await shippingController.getTrackingInfo(req, res, next);
            } catch (error) {
                logger.error('Tracking info retrieval failed', {
                    error,
                    trackingNumber: req.params.trackingNumber,
                    requestId: req.headers['x-request-id']
                });
                next(error);
            }
        }
    );

    return router;
};

// Export configured router
export default initializeShippingRoutes;