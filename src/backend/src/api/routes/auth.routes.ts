/**
 * Authentication Routes
 * Implements secure authentication endpoints with comprehensive security measures
 * @version 1.0.0
 */

import express, { Router, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import {
    validateLoginRequest,
    validateOAuthRequest,
    validateRefreshTokenRequest,
    validateRegistrationRequest
} from '../validators/auth.validator';
import { logger } from '../../utils/logger.util';
import { createCustomError } from '../../utils/error.util';
import { AUTH_ERRORS } from '../../constants/error.constants';

// Initialize router
const router: Router = express.Router();

// Initialize auth controller
const authController = new AuthController();

/**
 * Rate limiting configurations for different auth endpoints
 */
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: 'Too many login attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registration attempts per hour
    message: 'Too many registration attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

const refreshTokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 refresh attempts
    message: 'Too many token refresh attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Error handling middleware for auth routes
 */
const handleAuthError = (
    error: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    logger.error('Authentication error:', {
        error,
        path: req.path,
        method: req.method,
        ip: req.ip
    });

    if (error.code === AUTH_ERRORS.INVALID_CREDENTIALS) {
        return res.status(401).json({
            error: 'Invalid credentials',
            code: error.code
        });
    }

    if (error.code === AUTH_ERRORS.TOKEN_EXPIRED) {
        return res.status(401).json({
            error: 'Token expired',
            code: error.code
        });
    }

    return res.status(500).json({
        error: 'Authentication failed',
        code: AUTH_ERRORS.UNAUTHORIZED
    });
};

// Apply security headers to all auth routes
router.use(helmet());

/**
 * @route POST /api/auth/login
 * @description Authenticate user with email/password
 * @access Public
 */
router.post(
    '/login',
    loginLimiter,
    validateLoginRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await authController.login(req, res);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route POST /api/auth/register
 * @description Register new user account
 * @access Public
 */
router.post(
    '/register',
    registrationLimiter,
    validateRegistrationRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await authController.register(req, res);
            return res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route POST /api/auth/refresh-token
 * @description Refresh access token using refresh token
 * @access Public
 */
router.post(
    '/refresh-token',
    refreshTokenLimiter,
    validateRefreshTokenRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await authController.refreshToken(req, res);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route POST /api/auth/oauth/login
 * @description Handle OAuth authentication
 * @access Public
 */
router.post(
    '/oauth/login',
    loginLimiter,
    validateOAuthRequest,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await authController.oauthLogin(req, res);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * @route POST /api/auth/logout
 * @description Logout user and invalidate tokens
 * @access Protected
 */
router.post(
    '/logout',
    authenticate,
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await authController.logout(req, res);
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
);

// Apply error handling middleware
router.use(handleAuthError);

export default router;