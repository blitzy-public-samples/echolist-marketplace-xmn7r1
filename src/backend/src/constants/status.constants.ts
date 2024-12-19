// @ts-check
/**
 * @fileoverview Centralized status constants for the EchoList platform.
 * Defines type-safe enums for various status types used throughout the application.
 * @version 1.0.0
 */

/**
 * Status constants for listing states throughout its lifecycle
 * @enum {string}
 */
export enum LISTING_STATUS {
    DRAFT = 'DRAFT',           // Initial creation state
    ACTIVE = 'ACTIVE',         // Publicly visible and available
    PENDING = 'PENDING',       // Awaiting review/approval
    SOLD = 'SOLD',            // Successfully sold
    ARCHIVED = 'ARCHIVED'      // No longer active/visible
}

/**
 * Status constants for transaction states from initiation to completion
 * @enum {string}
 */
export enum TRANSACTION_STATUS {
    INITIATED = 'INITIATED',               // Transaction started
    PAYMENT_PENDING = 'PAYMENT_PENDING',   // Awaiting payment
    PAYMENT_COMPLETED = 'PAYMENT_COMPLETED', // Payment received
    AWAITING_MEETUP = 'AWAITING_MEETUP',   // Local pickup pending
    AWAITING_SHIPPING = 'AWAITING_SHIPPING', // Shipping pending
    COMPLETED = 'COMPLETED',               // Transaction finished
    DISPUTED = 'DISPUTED',                 // Under dispute
    CANCELLED = 'CANCELLED'                // Transaction cancelled
}

/**
 * Status constants for BuyShield protection service states
 * @enum {string}
 */
export enum BUYSHIELD_STATUS {
    PENDING = 'PENDING',       // Protection request initiated
    ACTIVE = 'ACTIVE',        // Protection active
    VERIFIED = 'VERIFIED',    // Transaction verified
    COMPLETED = 'COMPLETED',  // Protection completed
    DISPUTED = 'DISPUTED',    // Under dispute
    CANCELLED = 'CANCELLED'   // Protection cancelled
}

/**
 * Status constants for transaction verification process
 * @enum {string}
 */
export enum VERIFICATION_STATUS {
    PENDING = 'PENDING',     // Awaiting verification
    SUBMITTED = 'SUBMITTED', // Verification submitted
    APPROVED = 'APPROVED',   // Verification approved
    REJECTED = 'REJECTED'    // Verification rejected
}

/**
 * Status constants for marketplace synchronization states
 * @enum {string}
 */
export enum SYNC_STATUS {
    PENDING = 'PENDING',     // Sync in progress
    SYNCED = 'SYNCED',      // Successfully synced
    FAILED = 'FAILED'       // Sync failed
}

/**
 * Error messages for various status-related operations
 * @constant
 */
export const STATUS_ERROR_MESSAGES = {
    INVALID_TRANSITION: 'Invalid status transition attempted: {from} -> {to}',
    PERMISSION_DENIED: 'User {userId} does not have permission for status change: {status}',
    VERIFICATION_REQUIRED: 'Verification required before changing status to: {status}',
    SYNC_FAILED: 'Failed to sync status with {marketplace}: {error}'
} as const;

/**
 * Type guard to check if a value is a valid listing status
 * @param {string} status - Status value to check
 * @returns {boolean} True if status is valid
 */
export const isValidListingStatus = (status: string): status is LISTING_STATUS => {
    return Object.values(LISTING_STATUS).includes(status as LISTING_STATUS);
};

/**
 * Type guard to check if a value is a valid transaction status
 * @param {string} status - Status value to check
 * @returns {boolean} True if status is valid
 */
export const isValidTransactionStatus = (status: string): status is TRANSACTION_STATUS => {
    return Object.values(TRANSACTION_STATUS).includes(status as TRANSACTION_STATUS);
};

/**
 * Type guard to check if a value is a valid BuyShield status
 * @param {string} status - Status value to check
 * @returns {boolean} True if status is valid
 */
export const isValidBuyShieldStatus = (status: string): status is BUYSHIELD_STATUS => {
    return Object.values(BUYSHIELD_STATUS).includes(status as BUYSHIELD_STATUS);
};

/**
 * Type guard to check if a value is a valid verification status
 * @param {string} status - Status value to check
 * @returns {boolean} True if status is valid
 */
export const isValidVerificationStatus = (status: string): status is VERIFICATION_STATUS => {
    return Object.values(VERIFICATION_STATUS).includes(status as VERIFICATION_STATUS);
};

/**
 * Type guard to check if a value is a valid sync status
 * @param {string} status - Status value to check
 * @returns {boolean} True if status is valid
 */
export const isValidSyncStatus = (status: string): status is SYNC_STATUS => {
    return Object.values(SYNC_STATUS).includes(status as SYNC_STATUS);
};