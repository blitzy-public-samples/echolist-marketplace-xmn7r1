/**
 * User Routes Configuration
 * Implements secure routes for user management with comprehensive validation,
 * authentication, and monitoring for the EchoList platform.
 * @version 1.0.0
 */

import express, { Router } from 'express'; // ^4.18.2
import { UserController } from '../controllers/user.controller';
import { 
  authenticate, 
  authorize 
} from '../middlewares/auth.middleware';
import {
  validateUserRegistration,
  validateUserUpdate,
  validatePreferencesUpdate
} from '../validators/user.validator';
import { logger } from '../../utils/logger.util';

// Initialize router with strict security options
const router: Router = express.Router({
  strict: true,
  caseSensitive: true,
  mergeParams: false
});

// Initialize UserController instance
const userController = new UserController(
  new PasswordService(new AWS.KMS()),
  new AWS.KMS()
);

/**
 * Rate limiting configuration for user routes
 */
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
};

/**
 * Correlation ID middleware for request tracking
 */
router.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || 
                     crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

/**
 * Performance monitoring middleware
 */
router.use((req, res, next) => {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000;
    
    logger.info('Route performance', {
      path: req.path,
      method: req.method,
      duration,
      correlationId: req.correlationId
    });
  });
  
  next();
});

/**
 * Public Routes
 */

// User registration with rate limiting and validation
router.post(
  '/register',
  rateLimit(rateLimitConfig),
  validateUserRegistration,
  async (req, res, next) => {
    try {
      const response = await userController.createUser(req, res);
      logger.info('User registration successful', {
        correlationId: req.correlationId,
        email: req.body.email
      });
      return response;
    } catch (error) {
      logger.error('User registration failed', {
        correlationId: req.correlationId,
        error
      });
      next(error);
    }
  }
);

/**
 * Authenticated Routes
 * All routes below require valid JWT authentication
 */
router.use(authenticate);

// Update user profile
router.put(
  '/profile',
  validateUserUpdate,
  authorize(['USER', 'ADMIN']),
  async (req, res, next) => {
    try {
      const response = await userController.updateUser(req, res);
      logger.info('Profile update successful', {
        correlationId: req.correlationId,
        userId: req.user?.id
      });
      return response;
    } catch (error) {
      logger.error('Profile update failed', {
        correlationId: req.correlationId,
        userId: req.user?.id,
        error
      });
      next(error);
    }
  }
);

// Update user preferences
router.put(
  '/preferences',
  validatePreferencesUpdate,
  authorize(['USER', 'ADMIN']),
  async (req, res, next) => {
    try {
      const response = await userController.updatePreferences(req, res);
      logger.info('Preferences update successful', {
        correlationId: req.correlationId,
        userId: req.user?.id
      });
      return response;
    } catch (error) {
      logger.error('Preferences update failed', {
        correlationId: req.correlationId,
        userId: req.user?.id,
        error
      });
      next(error);
    }
  }
);

// Get user profile
router.get(
  '/profile',
  authorize(['USER', 'ADMIN', 'SUPPORT']),
  async (req, res, next) => {
    try {
      const response = await userController.getUser(req, res);
      logger.info('Profile retrieval successful', {
        correlationId: req.correlationId,
        userId: req.user?.id
      });
      return response;
    } catch (error) {
      logger.error('Profile retrieval failed', {
        correlationId: req.correlationId,
        userId: req.user?.id,
        error
      });
      next(error);
    }
  }
);

// Delete user account
router.delete(
  '/account',
  authorize(['USER', 'ADMIN']),
  async (req, res, next) => {
    try {
      const response = await userController.deleteUser(req, res);
      logger.info('Account deletion successful', {
        correlationId: req.correlationId,
        userId: req.user?.id
      });
      return response;
    } catch (error) {
      logger.error('Account deletion failed', {
        correlationId: req.correlationId,
        userId: req.user?.id,
        error
      });
      next(error);
    }
  }
);

// Error handling middleware
router.use((error: any, req: any, res: any, next: any) => {
  logger.error('Route error handler', {
    correlationId: req.correlationId,
    error,
    path: req.path,
    method: req.method
  });

  const statusCode = error.statusCode || 500;
  const message = error.message || 'Internal server error';

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: error.code,
      correlationId: req.correlationId
    }
  });
});

export default router;