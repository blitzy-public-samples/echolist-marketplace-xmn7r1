/**
 * @file Message system interfaces and types for the EchoList platform
 * @description Defines the core interfaces and types for the messaging system,
 * including real-time communications, AI processing metadata, and message types.
 */

/**
 * Enum defining all possible message types in the system
 */
export enum MessageType {
    TEXT = 'TEXT',
    OFFER = 'OFFER',
    TRANSACTION = 'TRANSACTION',
    SYSTEM = 'SYSTEM',
    AI_RESPONSE = 'AI_RESPONSE',
    LOCATION_SHARE = 'LOCATION_SHARE'
}

/**
 * Enum for tracking message delivery and moderation status
 */
export enum MessageStatus {
    SENT = 'SENT',
    DELIVERED = 'DELIVERED',
    READ = 'READ',
    FAILED = 'FAILED',
    BLOCKED = 'BLOCKED',
    PENDING_MODERATION = 'PENDING_MODERATION'
}

/**
 * Enum defining supported attachment types with transaction-specific types
 */
export enum AttachmentType {
    IMAGE = 'IMAGE',
    FILE = 'FILE',
    LOCATION = 'LOCATION',
    VOICE = 'VOICE',
    TRANSACTION_RECEIPT = 'TRANSACTION_RECEIPT'
}

/**
 * Interface for AI processing metadata including sentiment analysis and fraud detection
 */
export interface IMessageAIMetadata {
    /** Sentiment score from -1 to 1 */
    sentiment: number;
    
    /** Fraud probability score from 0 to 1 */
    fraudScore: number;
    
    /** AI-generated suggested response */
    suggestedResponse: string | null;
    
    /** Content moderation flags */
    contentFlags: string[];
    
    /** Current moderation status */
    moderationStatus: string;
    
    /** Time taken for AI processing in milliseconds */
    processingTime: number;
    
    /** AI confidence score from 0 to 1 */
    confidenceScore: number;
}

/**
 * Interface for message attachments with CDN integration
 */
export interface IMessageAttachment {
    /** Unique identifier for the attachment */
    id: UUID;
    
    /** Type of attachment */
    type: AttachmentType;
    
    /** CDN URL for the attachment */
    url: string;
    
    /** Original filename */
    filename: string;
    
    /** File size in bytes */
    size: number;
    
    /** MIME type of the attachment */
    mimeType: string;
    
    /** Additional metadata for the attachment */
    metadata: Record<string, any>;
    
    /** CDN URL for thumbnail if available */
    thumbnailUrl: string | null;
}

/**
 * Comprehensive interface for all message types in the system
 */
export interface IMessage {
    /** Unique identifier for the message */
    id: UUID;
    
    /** ID of the user sending the message */
    senderId: UUID;
    
    /** ID of the user receiving the message */
    receiverId: UUID;
    
    /** Associated listing ID if applicable */
    listingId: UUID;
    
    /** Message content */
    content: string;
    
    /** Type of message */
    type: MessageType;
    
    /** Current message status */
    status: MessageStatus;
    
    /** Flag indicating if message has been processed by AI */
    aiProcessed: boolean;
    
    /** AI processing metadata */
    aiMetadata: IMessageAIMetadata;
    
    /** Array of message attachments */
    attachments: IMessageAttachment[];
    
    /** Associated transaction ID if applicable */
    transactionId: UUID | null;
    
    /** Offer amount for OFFER type messages */
    offerAmount: number | null;
    
    /** Additional system metadata */
    systemMetadata: Record<string, any>;
    
    /** Timestamp when message was delivered */
    deliveredAt: Date | null;
    
    /** Timestamp when message was read */
    readAt: Date | null;
    
    /** Message creation timestamp */
    createdAt: Date;
    
    /** Last update timestamp */
    updatedAt: Date;
}

// Type alias for UUID to maintain consistency
type UUID = string;