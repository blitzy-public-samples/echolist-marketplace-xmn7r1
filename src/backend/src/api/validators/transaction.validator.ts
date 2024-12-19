/**
 * @fileoverview Transaction Validator
 * Implements comprehensive validation rules for transaction-related API endpoints
 * with enhanced security checks and performance optimizations.
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import { rateLimit } from 'express-rate-limit'; // ^6.0.0
import { 
  ITransactionCreationAttributes, 
  ITransactionUpdateAttributes,
  TransactionStatus,
  PaymentMethod
} from '../../interfaces/transaction.interface';
import { TRANSACTION_ERRORS } from '../../constants/error.constants';
import { validateSchema, ValidationOptions } from '../middlewares/validation.middleware';

// Constants for transaction validation
const MIN_TRANSACTION_AMOUNT = 0.01;
const MAX_TRANSACTION_AMOUNT = 50000.00;
const VALIDATION_TIMEOUT_MS = 5000;
const MAX_VALIDATION_ATTEMPTS = 5;
const CACHE_DURATION_MS = 300000; // 5 minutes
const BUYSHIELD_WINDOW_HOURS = 72;

/**
 * Enhanced Joi schema for transaction creation with comprehensive validation rules
 */
export const createTransactionSchema = Joi.object<ITransactionCreationAttributes>({
  listingId: Joi.string()
    .required()
    .trim()
    .uuid()
    .messages({
      'string.empty': 'Listing ID is required',
      'string.uuid': 'Invalid listing ID format'
    }),

  buyerId: Joi.string()
    .required()
    .trim()
    .uuid()
    .messages({
      'string.empty': 'Buyer ID is required',
      'string.uuid': 'Invalid buyer ID format'
    }),

  sellerId: Joi.string()
    .required()
    .trim()
    .uuid()
    .messages({
      'string.empty': 'Seller ID is required',
      'string.uuid': 'Invalid seller ID format'
    }),

  amount: Joi.number()
    .required()
    .min(MIN_TRANSACTION_AMOUNT)
    .max(MAX_TRANSACTION_AMOUNT)
    .precision(2)
    .messages({
      'number.base': 'Amount must be a valid number',
      'number.min': `Amount must be at least ${MIN_TRANSACTION_AMOUNT}`,
      'number.max': `Amount cannot exceed ${MAX_TRANSACTION_AMOUNT}`,
      'number.precision': 'Amount must have at most 2 decimal places'
    }),

  paymentMethod: Joi.string()
    .required()
    .valid(...Object.values(PaymentMethod))
    .messages({
      'any.only': 'Invalid payment method',
      'string.empty': 'Payment method is required'
    }),

  isLocalPickup: Joi.boolean()
    .required()
    .messages({
      'boolean.base': 'Local pickup flag must be a boolean'
    }),

  verificationRequired: Joi.boolean()
    .required()
    .when('isLocalPickup', {
      is: true,
      then: Joi.valid(true).messages({
        'any.only': 'Verification is required for local pickup transactions'
      })
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

/**
 * Enhanced Joi schema for transaction updates with security validations
 */
export const updateTransactionSchema = Joi.object<ITransactionUpdateAttributes>({
  status: Joi.string()
    .valid(...Object.values(TransactionStatus))
    .messages({
      'any.only': 'Invalid transaction status'
    }),

  stripePaymentIntentId: Joi.string()
    .trim()
    .pattern(/^pi_[a-zA-Z0-9]{24}$/)
    .messages({
      'string.pattern.base': 'Invalid Stripe payment intent ID format'
    }),

  buyShieldProtectionId: Joi.string()
    .trim()
    .uuid()
    .messages({
      'string.uuid': 'Invalid BuyShield protection ID format'
    }),

  shipping: Joi.object({
    trackingNumber: Joi.string().trim(),
    carrier: Joi.string().trim(),
    label: Joi.string().trim().uri(),
    estimatedDelivery: Joi.date().iso()
  }),

  verificationDeadline: Joi.date()
    .iso()
    .min('now')
    .max(Joi.ref('now', { adjust: (now) => now + BUYSHIELD_WINDOW_HOURS * 3600000 }))
    .messages({
      'date.min': 'Verification deadline cannot be in the past',
      'date.max': `Verification deadline cannot exceed ${BUYSHIELD_WINDOW_HOURS} hours`
    }),

  completedAt: Joi.date()
    .iso()
    .messages({
      'date.base': 'Invalid completion date format'
    })
}).options({
  abortEarly: false,
  stripUnknown: true
});

/**
 * Rate limiting configuration for transaction validation endpoints
 */
const transactionRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many validation requests, please try again later'
});

/**
 * Validates transaction creation request with enhanced security checks
 */
export const validateCreateTransaction = [
  transactionRateLimit,
  async (req: any, res: any, next: any) => {
    try {
      const validationOptions: ValidationOptions = {
        useCache: true,
        stripUnknown: true,
        timeoutMs: VALIDATION_TIMEOUT_MS
      };

      const validatedData = await validateSchema(
        createTransactionSchema,
        req.body,
        validationOptions
      );

      // Additional security checks
      if (validatedData.buyerId === validatedData.sellerId) {
        throw new Error('Buyer and seller cannot be the same user');
      }

      // Attach validated data to request
      req.validatedData = validatedData;
      next();
    } catch (error: any) {
      next(error);
    }
  }
];

/**
 * Validates transaction update request with security verification
 */
export const validateUpdateTransaction = [
  transactionRateLimit,
  async (req: any, res: any, next: any) => {
    try {
      const validationOptions: ValidationOptions = {
        useCache: true,
        stripUnknown: true,
        timeoutMs: VALIDATION_TIMEOUT_MS
      };

      const validatedData = await validateSchema(
        updateTransactionSchema,
        req.body,
        validationOptions
      );

      // Status transition validation
      if (validatedData.status) {
        const currentStatus = req.transaction?.status;
        if (!isValidStatusTransition(currentStatus, validatedData.status)) {
          throw new Error(`Invalid status transition from ${currentStatus} to ${validatedData.status}`);
        }
      }

      // Attach validated data to request
      req.validatedData = validatedData;
      next();
    } catch (error: any) {
      next(error);
    }
  }
];

/**
 * Validates if a status transition is allowed
 * @param currentStatus - Current transaction status
 * @param newStatus - New transaction status
 */
function isValidStatusTransition(currentStatus: TransactionStatus, newStatus: TransactionStatus): boolean {
  const allowedTransitions: Record<TransactionStatus, TransactionStatus[]> = {
    [TransactionStatus.PENDING]: [
      TransactionStatus.PAYMENT_PROCESSING,
      TransactionStatus.CANCELLED
    ],
    [TransactionStatus.PAYMENT_PROCESSING]: [
      TransactionStatus.ESCROW_HOLD,
      TransactionStatus.CANCELLED,
      TransactionStatus.REFUNDED
    ],
    [TransactionStatus.ESCROW_HOLD]: [
      TransactionStatus.AWAITING_VERIFICATION,
      TransactionStatus.CANCELLED,
      TransactionStatus.REFUNDED
    ],
    [TransactionStatus.AWAITING_VERIFICATION]: [
      TransactionStatus.COMPLETED,
      TransactionStatus.DISPUTED,
      TransactionStatus.CANCELLED
    ],
    [TransactionStatus.COMPLETED]: [
      TransactionStatus.DISPUTED
    ],
    [TransactionStatus.CANCELLED]: [],
    [TransactionStatus.REFUNDED]: [],
    [TransactionStatus.DISPUTED]: [
      TransactionStatus.COMPLETED,
      TransactionStatus.REFUNDED
    ]
  };

  return allowedTransitions[currentStatus]?.includes(newStatus) || false;
}