/**
 * @fileoverview Payment interface definitions for the EchoList platform.
 * Defines TypeScript interfaces and types for payment processing, including
 * Stripe integration, escrow services, and payment status tracking.
 * @version 1.0.0
 */

import { TRANSACTION_STATUS } from '../constants/status.constants';
import type { Stripe } from 'stripe'; // v8.0.0

/**
 * Enum defining possible states of a payment throughout its lifecycle
 * @enum {string}
 */
export enum PaymentStatus {
    PENDING = 'PENDING',       // Initial payment state
    AUTHORIZED = 'AUTHORIZED', // Payment authorized but not captured
    CAPTURED = 'CAPTURED',     // Payment successfully captured
    FAILED = 'FAILED',        // Payment failed
    REFUNDED = 'REFUNDED'     // Payment refunded
}

/**
 * Enum defining supported payment methods in the platform
 * @enum {string}
 */
export enum PaymentMethod {
    CREDIT_CARD = 'CREDIT_CARD',
    DEBIT_CARD = 'DEBIT_CARD',
    BANK_TRANSFER = 'BANK_TRANSFER'
}

/**
 * Enum defining types of payments (local vs marketplace)
 * @enum {string}
 */
export enum PaymentType {
    LOCAL = 'LOCAL',           // Local transaction with BuyShield
    MARKETPLACE = 'MARKETPLACE' // Platform marketplace transaction
}

/**
 * Interface defining the structure of payment records
 * @interface IPayment
 */
export interface IPayment {
    /** Unique identifier for the payment */
    id: string;
    
    /** Associated transaction ID */
    transactionId: string;
    
    /** Payment amount in smallest currency unit (e.g., cents) */
    amount: number;
    
    /** Three-letter ISO currency code */
    currency: string;
    
    /** Current payment status */
    status: PaymentStatus;
    
    /** Type of payment (local/marketplace) */
    type: PaymentType;
    
    /** Payment method used */
    method: PaymentMethod;
    
    /** Stripe payment intent ID for tracking */
    stripePaymentIntentId: string;
    
    /** Stripe customer ID for the payer */
    stripeCustomerId: string;
    
    /** BuyShield escrow ID for local transactions */
    escrowId?: string;
    
    /** Payment creation timestamp */
    createdAt: Date;
    
    /** Last update timestamp */
    updatedAt: Date;
}

/**
 * Interface for creating new payment records
 * @interface IPaymentCreate
 */
export interface IPaymentCreate {
    /** Associated transaction ID */
    transactionId: string;
    
    /** Payment amount in smallest currency unit */
    amount: number;
    
    /** Three-letter ISO currency code */
    currency: string;
    
    /** Type of payment */
    type: PaymentType;
    
    /** Payment method to be used */
    method: PaymentMethod;
}

/**
 * Interface for payment operation results
 * @interface IPaymentResult
 */
export interface IPaymentResult {
    /** Indicates if the operation was successful */
    success: boolean;
    
    /** ID of the created/processed payment */
    paymentId: string;
    
    /** Current payment status */
    status: PaymentStatus;
    
    /** Operation result message */
    message: string;
    
    /** Stripe client secret for payment confirmation */
    stripeClientSecret?: string;
}

/**
 * Type guard to check if a value is a valid payment status
 * @param {string} status - Status value to check
 * @returns {boolean} True if status is valid
 */
export const isValidPaymentStatus = (status: string): status is PaymentStatus => {
    return Object.values(PaymentStatus).includes(status as PaymentStatus);
};

/**
 * Maps transaction status to payment status
 * @param {TRANSACTION_STATUS} transactionStatus - Current transaction status
 * @returns {PaymentStatus} Corresponding payment status
 */
export const mapTransactionToPaymentStatus = (
    transactionStatus: TRANSACTION_STATUS
): PaymentStatus => {
    switch (transactionStatus) {
        case TRANSACTION_STATUS.PAYMENT_PENDING:
            return PaymentStatus.PENDING;
        case TRANSACTION_STATUS.PAYMENT_COMPLETED:
            return PaymentStatus.CAPTURED;
        default:
            return PaymentStatus.PENDING;
    }
};