/**
 * @fileoverview BuyShield Protection Service Validators
 * Implements comprehensive validation rules for BuyShield escrow service operations
 * with enhanced security measures and data integrity checks.
 * @version 1.0.0
 */

import Joi from 'joi'; // ^17.6.0
import { BuyShieldStatus, VerificationStatus } from '../../interfaces/buyshield.interface';
import { TransactionStatus } from '../../interfaces/transaction.interface';

/**
 * Validation messages for BuyShield operations
 */
const VALIDATION_MESSAGES = {
    INVALID_TRANSACTION: 'Invalid or non-existent transaction ID provided',
    INVALID_AMOUNT: 'Protection amount must exactly match transaction amount',
    INVALID_PHOTO: 'Invalid verification photo format, size, or potential tampering detected',
    EXPIRED_WINDOW: 'Verification window has expired (72-hour limit)',
    INVALID_STATUS: 'Invalid status transition requested or unauthorized',
    DUPLICATE_SUBMISSION: 'Duplicate verification photo submission detected',
    INVALID_METADATA: 'Photo metadata validation failed',
    QUALITY_CHECK_FAILED: 'Photo quality requirements not met',
    AUTHORIZATION_FAILED: 'Insufficient authorization for requested operation',
    SYSTEM_CONSTRAINT: 'Operation violates system constraints or business rules'
} as const;

/**
 * Validation rules and constraints for BuyShield operations
 */
const VALIDATION_RULES = {
    MAX_PHOTO_SIZE: 10485760, // 10MB in bytes
    MIN_PHOTO_SIZE: 102400, // 100KB in bytes
    ALLOWED_PHOTO_TYPES: ['image/jpeg', 'image/png'],
    PROTECTION_WINDOW_HOURS: 72,
    MIN_AMOUNT: 1,
    MAX_AMOUNT: 50000,
    PHOTO_MIN_DIMENSIONS: '800x600',
    PHOTO_MAX_DIMENSIONS: '4096x4096',
    MAX_ATTEMPTS: 3,
    COOLDOWN_MINUTES: 15
} as const;

/**
 * Validates request data for creating a new BuyShield protection
 * Implements comprehensive security checks and business rule validation
 */
const validateBuyShieldCreation = () => {
    return Joi.object({
        transactionId: Joi.string()
            .uuid()
            .required()
            .messages({
                'string.empty': VALIDATION_MESSAGES.INVALID_TRANSACTION,
                'string.guid': VALIDATION_MESSAGES.INVALID_TRANSACTION
            }),

        buyerId: Joi.string()
            .uuid()
            .required(),

        sellerId: Joi.string()
            .uuid()
            .required(),

        amount: Joi.number()
            .min(VALIDATION_RULES.MIN_AMOUNT)
            .max(VALIDATION_RULES.MAX_AMOUNT)
            .required()
            .messages({
                'number.min': `Amount must be at least ${VALIDATION_RULES.MIN_AMOUNT}`,
                'number.max': `Amount cannot exceed ${VALIDATION_RULES.MAX_AMOUNT}`
            }),

        paymentMethod: Joi.string()
            .valid('CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER')
            .required(),

        transactionStatus: Joi.string()
            .valid(...Object.values(TransactionStatus))
            .required(),

        expiresAt: Joi.date()
            .min('now')
            .max(`now+${VALIDATION_RULES.PROTECTION_WINDOW_HOURS}h`)
            .required()
            .messages({
                'date.min': 'Expiration must be in the future',
                'date.max': `Protection window cannot exceed ${VALIDATION_RULES.PROTECTION_WINDOW_HOURS} hours`
            }),

        termsAccepted: Joi.boolean()
            .valid(true)
            .required()
            .messages({
                'boolean.base': 'Terms acceptance is required'
            })
    });
};

/**
 * Validates verification photo submission for BuyShield protection
 * Implements comprehensive security measures for photo verification
 */
const validateVerificationSubmission = () => {
    return Joi.object({
        protectionId: Joi.string()
            .uuid()
            .required(),

        photo: Joi.object({
            data: Joi.binary()
                .min(VALIDATION_RULES.MIN_PHOTO_SIZE)
                .max(VALIDATION_RULES.MAX_PHOTO_SIZE)
                .required(),

            mimeType: Joi.string()
                .valid(...VALIDATION_RULES.ALLOWED_PHOTO_TYPES)
                .required(),

            dimensions: Joi.string()
                .pattern(new RegExp(`^\\d+x\\d+$`))
                .required()
                .custom((value, helpers) => {
                    const [width, height] = value.split('x').map(Number);
                    const [minWidth, minHeight] = VALIDATION_RULES.PHOTO_MIN_DIMENSIONS.split('x').map(Number);
                    const [maxWidth, maxHeight] = VALIDATION_RULES.PHOTO_MAX_DIMENSIONS.split('x').map(Number);

                    if (width < minWidth || height < minHeight) {
                        return helpers.error('dimensions.tooSmall');
                    }
                    if (width > maxWidth || height > maxHeight) {
                        return helpers.error('dimensions.tooLarge');
                    }
                    return value;
                }),

            metadata: Joi.object({
                timestamp: Joi.date().required(),
                gpsCoordinates: Joi.object({
                    latitude: Joi.number().min(-90).max(90),
                    longitude: Joi.number().min(-180).max(180)
                }).optional(),
                deviceInfo: Joi.object().required()
            }).required()
        }).required(),

        attemptNumber: Joi.number()
            .max(VALIDATION_RULES.MAX_ATTEMPTS)
            .required()
            .messages({
                'number.max': `Maximum ${VALIDATION_RULES.MAX_ATTEMPTS} verification attempts allowed`
            })
    });
};

/**
 * Validates BuyShield status update requests
 * Implements comprehensive transition rules and security checks
 */
const validateStatusUpdate = () => {
    return Joi.object({
        protectionId: Joi.string()
            .uuid()
            .required(),

        currentStatus: Joi.string()
            .valid(...Object.values(BuyShieldStatus))
            .required(),

        newStatus: Joi.string()
            .valid(...Object.values(BuyShieldStatus))
            .required()
            .custom((value, helpers) => {
                const current = helpers.state.ancestors[0].currentStatus;
                const validTransitions = {
                    [BuyShieldStatus.ACTIVE]: [BuyShieldStatus.COMPLETED, BuyShieldStatus.CANCELLED, BuyShieldStatus.EXPIRED],
                    [BuyShieldStatus.COMPLETED]: [],
                    [BuyShieldStatus.CANCELLED]: [],
                    [BuyShieldStatus.EXPIRED]: []
                };

                if (!validTransitions[current]?.includes(value)) {
                    return helpers.error('status.invalidTransition');
                }
                return value;
            }),

        verificationStatus: Joi.string()
            .valid(...Object.values(VerificationStatus))
            .required(),

        reason: Joi.string()
            .min(10)
            .max(500)
            .when('newStatus', {
                is: Joi.valid(BuyShieldStatus.CANCELLED),
                then: Joi.required(),
                otherwise: Joi.optional()
            }),

        updatedBy: Joi.string()
            .uuid()
            .required(),

        timestamp: Joi.date()
            .max('now')
            .required()
    });
};

/**
 * Exports comprehensive validation functions for BuyShield operations
 */
export const buyShieldValidators = {
    validateBuyShieldCreation,
    validateVerificationSubmission,
    validateStatusUpdate
};