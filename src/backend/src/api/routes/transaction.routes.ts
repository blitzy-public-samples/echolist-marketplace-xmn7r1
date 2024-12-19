/**
 * @fileoverview Transaction routes implementation for the EchoList platform
 * Defines secure API endpoints for transaction management with BuyShield protection
 * @version 1.0.0
 */

import { Router } from 'express'; // ^4.17.1
import { container } from 'inversify'; // ^6.0.0
import cors from 'cors'; // ^2.8.5
import { RateLimiterMemory } from 'rate-limiter-flexible'; // ^2.4.1

import { TransactionController } from '../controllers/transaction.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { 
  validateCreateTransaction, 
  validateUpdateTransaction 
} from '../validators/transaction.validator';
import { logger } from '../../utils/logger.util';

// Initialize router
const transactionRouter = Router();

// Configure CORS for transaction endpoints
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['POST', 'PUT'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Request-Id'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

// Configure rate limiting for payment endpoints
const rateLimiter = new RateLimiterMemory({
  points: 100, // Number of requests
  duration: 60, // Per minute
  blockDuration: 300 // Block for 5 minutes if exceeded
});

// Get transaction controller instance
const transactionController = container.get<TransactionController>(TransactionController);

/**
 * Request correlation middleware for transaction tracking
 */
const requestCorrelation = (req: any, res: any, next: any) => {
  const correlationId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.correlationId = correlationId;
  res.setHeader('X-Request-Id', correlationId);
  next();
};

/**
 * Rate limiting middleware for payment endpoints
 */
const paymentRateLimit = async (req: any, res: any, next: any) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (error) {
    logger.warn('Rate limit exceeded for payment endpoint', {
      ip: req.ip,
      path: req.path,
      correlationId: req.correlationId
    });
    res.status(429).json({
      error: 'Too many requests, please try again later',
      retryAfter: error.msBeforeNext / 1000
    });
  }
};

/**
 * Error handling middleware for transaction routes
 */
const errorHandler = (error: any, req: any, res: any, next: any) => {
  logger.error('Transaction route error', {
    error: error.message,
    stack: error.stack,
    correlationId: req.correlationId,
    path: req.path
  });

  res.status(error.status || 500).json({
    error: error.message || 'Internal server error',
    code: error.code,
    correlationId: req.correlationId
  });
};

// Route: Create new transaction
transactionRouter.post('/transactions',
  cors(corsOptions),
  authenticate,
  authorize(['user']),
  requestCorrelation,
  paymentRateLimit,
  validateCreateTransaction,
  transactionController.createTransaction
);

// Route: Process local transaction with BuyShield
transactionRouter.put('/transactions/:id/process',
  cors(corsOptions),
  authenticate,
  authorize(['user']),
  requestCorrelation,
  validateUpdateTransaction,
  transactionController.processLocalTransaction
);

// Route: Complete transaction
transactionRouter.put('/transactions/:id/complete',
  cors(corsOptions),
  authenticate,
  authorize(['user']),
  requestCorrelation,
  validateUpdateTransaction,
  transactionController.completeTransaction
);

// Route: Cancel transaction
transactionRouter.put('/transactions/:id/cancel',
  cors(corsOptions),
  authenticate,
  authorize(['user']),
  requestCorrelation,
  validateUpdateTransaction,
  transactionController.cancelTransaction
);

// Apply error handling middleware
transactionRouter.use(errorHandler);

// Export configured router
export default transactionRouter;