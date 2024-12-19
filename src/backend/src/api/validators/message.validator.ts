/**
 * @file Message validator implementation for EchoList platform
 * @description Implements comprehensive validation rules and schemas for message-related
 * requests with enhanced security measures for real-time communications
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import { 
    IMessage, 
    MessageType, 
    MessageStatus, 
    AttachmentType,
    IMessageAttachment,
    IMessageAIMetadata 
} from '../../../interfaces/message.interface';
import { 
    validateSchema, 
    ValidationError,
    sanitizeInput 
} from '../../../utils/validation.util';

// Constants for validation rules
const MESSAGE_CONSTANTS = {
    CONTENT_MIN_LENGTH: 1,
    CONTENT_MAX_LENGTH: 5000,
    MAX_ATTACHMENTS: 10,
    MAX_ATTACHMENT_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif'],
    ALLOWED_FILE_TYPES: ['application/pdf', 'application/msword', 'text/plain'],
    ALLOWED_DOMAINS: ['echolist-cdn.com', 'amazonaws.com'],
    MIN_OFFER_AMOUNT: 0.01,
    MAX_OFFER_AMOUNT: 999999.99
};

/**
 * Schema for AI metadata validation
 */
const aiMetadataSchema = Joi.object<IMessageAIMetadata>({
    sentiment: Joi.number().min(-1).max(1).required(),
    fraudScore: Joi.number().min(0).max(1).required(),
    suggestedResponse: Joi.string().allow(null),
    contentFlags: Joi.array().items(Joi.string()),
    moderationStatus: Joi.string().required(),
    processingTime: Joi.number().positive().required(),
    confidenceScore: Joi.number().min(0).max(1).required()
});

/**
 * Schema for message attachment validation
 */
const attachmentSchema = Joi.object<IMessageAttachment>({
    id: Joi.string().uuid().required(),
    type: Joi.string().valid(...Object.values(AttachmentType)).required(),
    url: Joi.string().uri().custom((value, helpers) => {
        const domain = new URL(value).hostname;
        if (!MESSAGE_CONSTANTS.ALLOWED_DOMAINS.some(d => domain.endsWith(d))) {
            return helpers.error('Invalid domain for attachment URL');
        }
        return value;
    }).required(),
    filename: Joi.string().max(255).required(),
    size: Joi.number().max(MESSAGE_CONSTANTS.MAX_ATTACHMENT_SIZE).required(),
    mimeType: Joi.string().custom((value, helpers) => {
        const validTypes = [
            ...MESSAGE_CONSTANTS.ALLOWED_IMAGE_TYPES,
            ...MESSAGE_CONSTANTS.ALLOWED_FILE_TYPES
        ];
        if (!validTypes.includes(value)) {
            return helpers.error('Invalid file type');
        }
        return value;
    }).required(),
    metadata: Joi.object().required(),
    thumbnailUrl: Joi.string().uri().allow(null)
});

/**
 * Schema for creating new messages
 */
const createMessageSchema = Joi.object({
    senderId: Joi.string().uuid().required(),
    receiverId: Joi.string().uuid().required(),
    listingId: Joi.string().uuid().required(),
    content: Joi.string()
        .min(MESSAGE_CONSTANTS.CONTENT_MIN_LENGTH)
        .max(MESSAGE_CONSTANTS.CONTENT_MAX_LENGTH)
        .required(),
    type: Joi.string()
        .valid(...Object.values(MessageType))
        .required(),
    attachments: Joi.array()
        .items(attachmentSchema)
        .max(MESSAGE_CONSTANTS.MAX_ATTACHMENTS),
    transactionId: Joi.string().uuid().allow(null),
    offerAmount: Joi.when('type', {
        is: MessageType.OFFER,
        then: Joi.number()
            .min(MESSAGE_CONSTANTS.MIN_OFFER_AMOUNT)
            .max(MESSAGE_CONSTANTS.MAX_OFFER_AMOUNT)
            .required(),
        otherwise: Joi.allow(null)
    }),
    systemMetadata: Joi.object()
});

/**
 * Schema for updating messages
 */
const updateMessageSchema = Joi.object({
    messageId: Joi.string().uuid().required(),
    status: Joi.string()
        .valid(...Object.values(MessageStatus))
        .required(),
    aiMetadata: aiMetadataSchema,
    readAt: Joi.date().iso(),
    deliveredAt: Joi.date().iso()
});

/**
 * Validates message creation request with enhanced security measures
 * @param request - The message creation request data
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validateCreateMessage(request: Partial<IMessage>): Promise<boolean> {
    try {
        // Sanitize input data
        const sanitizedRequest = sanitizeInput(request, {
            stripTags: true,
            escapeHTML: true,
            preventSQLInjection: true
        });

        // Validate against schema
        await validateSchema(createMessageSchema, sanitizedRequest, {
            stripUnknown: true,
            abortEarly: false
        });

        return true;
    } catch (error) {
        if (error instanceof ValidationError) {
            error.category = 'message_validation';
            throw error;
        }
        throw error;
    }
}

/**
 * Validates message update request with comprehensive checks
 * @param request - The message update request data
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validateUpdateMessage(request: Partial<IMessage>): Promise<boolean> {
    try {
        // Sanitize input data
        const sanitizedRequest = sanitizeInput(request, {
            stripTags: true,
            escapeHTML: true,
            preventSQLInjection: true
        });

        // Validate against schema
        await validateSchema(updateMessageSchema, sanitizedRequest, {
            stripUnknown: true,
            abortEarly: false
        });

        return true;
    } catch (error) {
        if (error instanceof ValidationError) {
            error.category = 'message_update_validation';
            throw error;
        }
        throw error;
    }
}

/**
 * Validates message attachments with enhanced security checks
 * @param attachments - Array of message attachments to validate
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validateMessageAttachments(
    attachments: IMessageAttachment[]
): Promise<boolean> {
    try {
        // Validate each attachment
        await Promise.all(
            attachments.map(async (attachment) => {
                await validateSchema(attachmentSchema, attachment, {
                    stripUnknown: true,
                    abortEarly: false
                });
            })
        );

        return true;
    } catch (error) {
        if (error instanceof ValidationError) {
            error.category = 'attachment_validation';
            throw error;
        }
        throw error;
    }
}

// Export schemas for external use
export const messageSchemas = {
    createMessageSchema,
    updateMessageSchema,
    attachmentSchema
};