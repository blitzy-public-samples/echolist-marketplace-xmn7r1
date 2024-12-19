/**
 * Message Constants
 * Defines constant values and enums used throughout the EchoList platform's messaging system
 * @version 1.0.0
 */

/**
 * Defines types of messages supported in the system
 * Used for categorizing different kinds of message content
 */
export enum MESSAGE_TYPES {
    TEXT = 'text',
    OFFER = 'offer',
    COUNTER_OFFER = 'counter_offer',
    SYSTEM = 'system',
    AI_RESPONSE = 'ai_response'
}

/**
 * Defines possible message delivery statuses
 * Used for tracking message state throughout its lifecycle
 */
export enum MESSAGE_STATUS {
    SENT = 'sent',
    DELIVERED = 'delivered',
    READ = 'read',
    FAILED = 'failed'
}

/**
 * Defines WebSocket event types for real-time messaging
 * Used with Socket.io for real-time communications
 */
export enum MESSAGE_EVENTS {
    NEW_MESSAGE = 'message.new',
    MESSAGE_DELIVERED = 'message.delivered',
    MESSAGE_READ = 'message.read',
    MESSAGE_FAILED = 'message.failed'
}

/**
 * Defines types of attachments allowed in messages
 * Used for validating and processing message attachments
 */
export enum ATTACHMENT_TYPES {
    IMAGE = 'image',
    DOCUMENT = 'document',
    AUDIO = 'audio',
    VIDEO = 'video'
}

/**
 * Defines AI processing flag types for messages
 * Used by the smart messaging intervention system
 */
export enum AI_MESSAGE_FLAGS {
    POTENTIAL_FRAUD = 'potential_fraud',
    INAPPROPRIATE_CONTENT = 'inappropriate_content',
    SPAM = 'spam',
    REQUIRES_MODERATION = 'requires_moderation'
}

/**
 * Defines error codes for messaging operations
 * Used for standardized error handling across the messaging system
 */
export enum MESSAGE_ERROR_CODES {
    INVALID_CONTENT = 'invalid_content',
    BLOCKED_SENDER = 'blocked_sender',
    ATTACHMENT_TOO_LARGE = 'attachment_too_large',
    INVALID_RECIPIENT = 'invalid_recipient'
}

/**
 * Maximum length of a message in characters
 * @constant
 */
export const MAX_MESSAGE_LENGTH: number = 2000;

/**
 * Maximum size of an attachment in bytes (10MB)
 * @constant
 */
export const MAX_ATTACHMENT_SIZE: number = 10485760;

/**
 * Maximum number of attachments allowed per message
 * @constant
 */
export const MAX_ATTACHMENTS_PER_MESSAGE: number = 5;

/**
 * Number of messages allowed per minute per user
 * Used for rate limiting
 * @constant
 */
export const MESSAGE_RATE_LIMIT: number = 60;