/**
 * @fileoverview BuyShield Protection Service Routes
 * Implements secure routing for BuyShield escrow service with comprehensive
 * validation, monitoring, and security measures.
 * @version 1.0.0
 */

import { Router } from 'express'; // ^4.17.1
import { BuyShieldController } from '../controllers/buyshield.controller';
import { 
    authenticate, 
    authorize 
} from '../middlewares/auth.middleware';
import { buyShieldValidators } from '../validators/buyshield.validator';
import { correlationId, rateLimiter } from '../middlewares/auth.middleware';

/**
 * Initializes BuyShield protection service routes with enhanced security
 * and comprehensive request validation
 * @param controller - Initialized BuyShield controller instance
 * @returns Configured Express router
 */
const initializeBuyShieldRoutes = (controller: BuyShieldController): Router => {
    const router = Router();

    /**
     * Create new BuyShield protection
     * @route POST /api/buyshield/create
     * @security JWT
     * @param {Object} req.body - Protection creation request
     * @returns {Object} Created protection details
     */
    router.post('/create',
        correlationId,
        authenticate,
        authorize(['user']),
        rateLimiter({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 10 // 10 requests per window
        }),
        buyShieldValidators.validateBuyShieldCreation(),
        controller.createProtection
    );

    /**
     * Submit verification photo for protected transaction
     * @route POST /api/buyshield/verify
     * @security JWT
     * @param {Object} req.body - Verification submission
     * @returns {Object} Verification result
     */
    router.post('/verify',
        correlationId,
        authenticate,
        authorize(['user']),
        rateLimiter({
            windowMs: 15 * 60 * 1000,
            max: 5 // 5 verification attempts per window
        }),
        buyShieldValidators.validateVerificationSubmission(),
        controller.submitVerification
    );

    /**
     * Cancel active BuyShield protection
     * @route POST /api/buyshield/cancel
     * @security JWT
     * @param {Object} req.body - Cancellation request
     * @returns {Object} Cancellation confirmation
     */
    router.post('/cancel',
        correlationId,
        authenticate,
        authorize(['user']),
        rateLimiter({
            windowMs: 60 * 60 * 1000, // 1 hour
            max: 3 // 3 cancellations per hour
        }),
        buyShieldValidators.validateStatusUpdate(),
        controller.cancelProtection
    );

    /**
     * Get BuyShield protection status
     * @route GET /api/buyshield/status/:id
     * @security JWT
     * @param {string} req.params.id - Protection ID
     * @returns {Object} Protection status details
     */
    router.get('/status/:id',
        correlationId,
        authenticate,
        authorize(['user']),
        rateLimiter({
            windowMs: 5 * 60 * 1000, // 5 minutes
            max: 20 // 20 status checks per window
        }),
        controller.getProtectionStatus
    );

    return router;
};

// Create and configure router instance
const buyShieldRouter = initializeBuyShieldRoutes(new BuyShieldController());

export default buyShieldRouter;