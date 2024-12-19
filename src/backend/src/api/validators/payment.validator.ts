/**
 * @fileoverview Payment validation module implementing PCI DSS compliant validation rules
 * for payment-related requests in the EchoList platform.
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import { validateSchema } from '../../utils/validation.util';
import {
    IPayment,
    IPaymentCreate,
    PaymentMethod,
    PaymentType,
    PaymentStatus,
    isValidPaymentStatus
} from '../../interfaces/payment.interface';

// Constants for validation rules
const PAYMENT_AMOUNT_MIN = 0.01;
const PAYMENT_AMOUNT_MAX = 999999.99;
const VERIFICATION_CODE_LENGTH = 6;
const CAPTURE_WINDOW_HOURS = 72;

/**
 * Schema for payment creation validation with PCI DSS compliance
 */
const paymentCreateSchema = Joi.object({
    transactionId: Joi.string()
        .uuid()
        .required()
        .description('Associated transaction UUID'),

    amount: Joi.number()
        .precision(2)
        .min(PAYMENT_AMOUNT_MIN)
        .max(PAYMENT_AMOUNT_MAX)
        .required()
        .description('Payment amount in smallest currency unit'),

    currency: Joi.string()
        .length(3)
        .uppercase()
        .pattern(/^[A-Z]{3}$/)
        .required()
        .description('ISO 4217 currency code'),

    type: Joi.string()
        .valid(...Object.values(PaymentType))
        .required()
        .description('Payment type (LOCAL or MARKETPLACE)'),

    method: Joi.string()
        .valid(...Object.values(PaymentMethod))
        .required()
        .description('Payment method')
}).options({ stripUnknown: true });

/**
 * Schema for payment update validation
 */
const paymentUpdateSchema = Joi.object({
    status: Joi.string()
        .valid(...Object.values(PaymentStatus))
        .custom((value, helpers) => {
            if (!isValidPaymentStatus(value)) {
                return helpers.error('Invalid payment status');
            }
            return value;
        }),

    stripePaymentIntentId: Joi.string()
        .pattern(/^pi_[A-Za-z0-9]{24,}$/)
        .description('Stripe payment intent ID'),

    escrowId: Joi.string()
        .uuid()
        .description('BuyShield escrow ID for local transactions')
}).options({ stripUnknown: true });

/**
 * Schema for payment capture validation
 */
const paymentCaptureSchema = Joi.object({
    paymentId: Joi.string()
        .uuid()
        .required()
        .description('Payment UUID'),

    verificationCode: Joi.string()
        .length(VERIFICATION_CODE_LENGTH)
        .pattern(/^[0-9]{6}$/)
        .required()
        .description('6-digit verification code')
}).options({ stripUnknown: true });

/**
 * Validates payment creation request with enhanced security checks and PCI DSS compliance
 * @param {IPaymentCreate} paymentData - Payment creation request data
 * @returns {Promise<boolean>} True if validation passes, throws ValidationError if fails
 */
export async function validatePaymentCreate(paymentData: IPaymentCreate): Promise<boolean> {
    try {
        await validateSchema(paymentCreateSchema, paymentData, {
            abortEarly: false,
            messages: {
                'number.min': 'Payment amount must be at least {#limit}',
                'number.max': 'Payment amount cannot exceed {#limit}',
                'string.pattern.base': 'Invalid format for {#key}'
            }
        });
        return true;
    } catch (error) {
        // Rethrow with payment-specific category
        if (error.name === 'ValidationError') {
            error.category = 'payment_validation';
        }
        throw error;
    }
}

/**
 * Validates payment update request with status transition validation
 * @param {Partial<IPayment>} updateData - Payment update request data
 * @returns {Promise<boolean>} True if validation passes, throws ValidationError if fails
 */
export async function validatePaymentUpdate(updateData: Partial<IPayment>): Promise<boolean> {
    try {
        await validateSchema(paymentUpdateSchema, updateData, {
            abortEarly: false,
            messages: {
                'string.pattern.base': 'Invalid {#key} format',
                'any.only': 'Invalid payment status transition'
            }
        });
        return true;
    } catch (error) {
        if (error.name === 'ValidationError') {
            error.category = 'payment_update_validation';
        }
        throw error;
    }
}

/**
 * Validates payment capture request for BuyShield transactions
 * @param {object} captureData - Payment capture request data
 * @returns {Promise<boolean>} True if validation passes, throws ValidationError if fails
 */
export async function validatePaymentCapture(captureData: {
    paymentId: string;
    verificationCode: string;
}): Promise<boolean> {
    try {
        await validateSchema(paymentCaptureSchema, captureData, {
            abortEarly: false,
            messages: {
                'string.length': 'Verification code must be exactly {#limit} digits',
                'string.pattern.base': 'Verification code must contain only numbers'
            }
        });
        return true;
    } catch (error) {
        if (error.name === 'ValidationError') {
            error.category = 'payment_capture_validation';
        }
        throw error;
    }
}