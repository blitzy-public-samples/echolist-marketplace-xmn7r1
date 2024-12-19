/**
 * Error Constants for EchoList Backend Application
 * Version: 1.0.0
 * 
 * Defines standardized error codes, messages, and categories for comprehensive
 * error handling across the application. Error codes are organized in ranges:
 * - 1000-1999: Authentication errors
 * - 2000-2999: Transaction errors
 * - 3000-3999: Marketplace errors
 * - 4000-4999: Shipping errors
 * - 5000-5999: AI Service errors
 * - 9000-9999: System errors
 */

/**
 * Authentication related error codes (1000-1999)
 */
export enum AUTH_ERRORS {
    INVALID_CREDENTIALS = 1001,
    TOKEN_EXPIRED = 1002,
    UNAUTHORIZED = 1003,
    INVALID_TOKEN = 1004,
    SESSION_EXPIRED = 1005
}

/**
 * Transaction and payment related error codes (2000-2999)
 */
export enum TRANSACTION_ERRORS {
    PAYMENT_FAILED = 2001,
    ESCROW_ERROR = 2002,
    INVALID_AMOUNT = 2003,
    INSUFFICIENT_FUNDS = 2004,
    TRANSACTION_TIMEOUT = 2005
}

/**
 * Marketplace integration error codes (3000-3999)
 */
export enum MARKETPLACE_ERRORS {
    SYNC_FAILED = 3001,
    INVALID_LISTING = 3002,
    PLATFORM_ERROR = 3003,
    RATE_LIMIT_EXCEEDED = 3004,
    API_INTEGRATION_ERROR = 3005
}

/**
 * Shipping service error codes (4000-4999)
 */
export enum SHIPPING_ERRORS {
    LABEL_GENERATION_FAILED = 4001,
    INVALID_ADDRESS = 4002,
    PICKUP_SCHEDULING_FAILED = 4003,
    CARRIER_API_ERROR = 4004,
    TRACKING_UPDATE_FAILED = 4005
}

/**
 * AI service related error codes (5000-5999)
 */
export enum AI_SERVICE_ERRORS {
    IMAGE_PROCESSING_FAILED = 5001,
    ANALYSIS_FAILED = 5002,
    MODEL_ERROR = 5003,
    DIMENSION_CALCULATION_FAILED = 5004,
    CLASSIFICATION_FAILED = 5005
}

/**
 * System and infrastructure error codes (9000-9999)
 */
export enum SYSTEM_ERRORS {
    DATABASE_ERROR = 9001,
    CACHE_ERROR = 9002,
    INTERNAL_SERVER_ERROR = 9003,
    SERVICE_UNAVAILABLE = 9004,
    NETWORK_ERROR = 9005
}

/**
 * Maps error codes to their corresponding user-friendly messages
 * with detailed descriptions for logging and client responses
 */
export const ERROR_MESSAGES: Record<number, string> = {
    // Authentication Errors
    [AUTH_ERRORS.INVALID_CREDENTIALS]: "Invalid username or password provided",
    [AUTH_ERRORS.TOKEN_EXPIRED]: "Authentication token has expired",
    [AUTH_ERRORS.UNAUTHORIZED]: "User is not authorized to perform this action",
    [AUTH_ERRORS.INVALID_TOKEN]: "Invalid or malformed authentication token",
    [AUTH_ERRORS.SESSION_EXPIRED]: "User session has expired",

    // Transaction Errors
    [TRANSACTION_ERRORS.PAYMENT_FAILED]: "Payment processing failed",
    [TRANSACTION_ERRORS.ESCROW_ERROR]: "Error processing escrow transaction",
    [TRANSACTION_ERRORS.INVALID_AMOUNT]: "Invalid transaction amount specified",
    [TRANSACTION_ERRORS.INSUFFICIENT_FUNDS]: "Insufficient funds for transaction",
    [TRANSACTION_ERRORS.TRANSACTION_TIMEOUT]: "Transaction timed out",

    // Marketplace Errors
    [MARKETPLACE_ERRORS.SYNC_FAILED]: "Failed to sync listing with marketplace",
    [MARKETPLACE_ERRORS.INVALID_LISTING]: "Invalid listing data provided",
    [MARKETPLACE_ERRORS.PLATFORM_ERROR]: "External marketplace platform error",
    [MARKETPLACE_ERRORS.RATE_LIMIT_EXCEEDED]: "Marketplace API rate limit exceeded",
    [MARKETPLACE_ERRORS.API_INTEGRATION_ERROR]: "Error in marketplace API integration",

    // Shipping Errors
    [SHIPPING_ERRORS.LABEL_GENERATION_FAILED]: "Failed to generate shipping label",
    [SHIPPING_ERRORS.INVALID_ADDRESS]: "Invalid shipping address provided",
    [SHIPPING_ERRORS.PICKUP_SCHEDULING_FAILED]: "Failed to schedule pickup",
    [SHIPPING_ERRORS.CARRIER_API_ERROR]: "Shipping carrier API error",
    [SHIPPING_ERRORS.TRACKING_UPDATE_FAILED]: "Failed to update tracking information",

    // AI Service Errors
    [AI_SERVICE_ERRORS.IMAGE_PROCESSING_FAILED]: "Failed to process image",
    [AI_SERVICE_ERRORS.ANALYSIS_FAILED]: "Image analysis failed",
    [AI_SERVICE_ERRORS.MODEL_ERROR]: "AI model processing error",
    [AI_SERVICE_ERRORS.DIMENSION_CALCULATION_FAILED]: "Failed to calculate item dimensions",
    [AI_SERVICE_ERRORS.CLASSIFICATION_FAILED]: "Item classification failed",

    // System Errors
    [SYSTEM_ERRORS.DATABASE_ERROR]: "Database operation failed",
    [SYSTEM_ERRORS.CACHE_ERROR]: "Cache operation failed",
    [SYSTEM_ERRORS.INTERNAL_SERVER_ERROR]: "Internal server error occurred",
    [SYSTEM_ERRORS.SERVICE_UNAVAILABLE]: "Service is temporarily unavailable",
    [SYSTEM_ERRORS.NETWORK_ERROR]: "Network communication error"
};