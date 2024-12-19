/**
 * Payment Routes Configuration
 * Implements secure payment processing endpoints with PCI DSS compliance,
 * rate limiting, and comprehensive error handling.
 * @version 1.0.0
 */

import express, { Router } from 'express'; // ^4.17.1
import correlationId from 'express-correlation-id'; // ^2.0.1
import rateLimit from 'express-rate-limit'; // ^5.2.6
import winston from 'winston'; // ^3.3.3

import { PaymentController } from '../controllers/payment.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validateRequest } from '../middlewares/validation.middleware';
import {
  validatePaymentCreate,
  validatePaymentCapture
} from '../validators/payment.validator';

// Initialize router
const router: Router = express.Router();

// Initialize payment controller
const paymentController = new PaymentController();

// Configure rate limiters for payment endpoints
const createPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  message: 'Too many payment requests, please try again later'
});

const capturePaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many capture attempts, please try again later'
});

const refundPaymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many refund attempts, please try again later'
});

/**
 * @route POST /api/payments
 * @description Creates a new payment with comprehensive validation and security checks
 * @access Private - Authenticated users and sellers
 */
router.post(
  '/',
  correlationId(),
  createPaymentLimiter,
  authenticate,
  authorize(['user', 'seller']),
  validateRequest(validatePaymentCreate, 'body'),
  paymentController.createPayment
);

/**
 * @route POST /api/payments/:id/capture
 * @description Captures an authorized payment with verification checks
 * @access Private - Sellers only
 */
router.post(
  '/:id/capture',
  correlationId(),
  capturePaymentLimiter,
  authenticate,
  authorize(['seller']),
  validateRequest(validatePaymentCapture, 'body'),
  paymentController.capturePayment
);

/**
 * @route POST /api/payments/:id/refund
 * @description Processes a refund for a completed payment
 * @access Private - Admin only
 */
router.post(
  '/:id/refund',
  correlationId(),
  refundPaymentLimiter,
  authenticate,
  authorize(['admin']),
  validateRequest(validatePaymentCapture, 'body'),
  paymentController.refundPayment
);

// Log route initialization
winston.info('Payment routes initialized', {
  routes: [
    'POST /api/payments',
    'POST /api/payments/:id/capture',
    'POST /api/payments/:id/refund'
  ],
  security: {
    authentication: true,
    rateLimit: true,
    validation: true,
    pciCompliance: true
  }
});

export default router;