/**
 * @fileoverview TypeScript interface definitions for transaction management
 * Defines core data structures for handling transactions, payments, and BuyShield protection
 * @version 1.0.0
 */

import { Document } from 'mongoose'; // ^6.0.0
import { IUser } from './user.interface';
import { IListing } from './listing.interface';
import { IBuyShieldProtection } from './buyshield.interface';

/**
 * Enum defining all possible states of a transaction
 * Tracks the complete lifecycle from initiation to completion
 */
export enum TransactionStatus {
    PENDING = 'PENDING',                     // Initial transaction state
    PAYMENT_PROCESSING = 'PAYMENT_PROCESSING', // Payment is being processed
    ESCROW_HOLD = 'ESCROW_HOLD',             // Funds held in BuyShield escrow
    AWAITING_VERIFICATION = 'AWAITING_VERIFICATION', // Pending photo verification
    COMPLETED = 'COMPLETED',                 // Transaction successfully completed
    CANCELLED = 'CANCELLED',                 // Transaction cancelled by either party
    REFUNDED = 'REFUNDED',                  // Payment refunded to buyer
    DISPUTED = 'DISPUTED'                    // Transaction under dispute
}

/**
 * Enum defining supported payment methods
 */
export enum PaymentMethod {
    CREDIT_CARD = 'CREDIT_CARD',
    DEBIT_CARD = 'DEBIT_CARD',
    BANK_TRANSFER = 'BANK_TRANSFER'
}

/**
 * Interface defining shipping details for non-local transactions
 */
interface ShippingDetails {
    trackingNumber?: string;
    carrier?: string;
    label?: string;
    estimatedDelivery?: Date;
}

/**
 * Interface defining fee breakdown for transactions
 */
interface TransactionFees {
    platformFee: number;      // EchoList platform fee
    processingFee: number;    // Payment processing fee
    buyShieldFee: number;     // BuyShield protection fee
    totalFees: number;        // Sum of all fees
}

/**
 * Core transaction interface extending Mongoose Document
 * Defines the complete structure of a transaction record
 */
export interface ITransaction extends Document {
    /** Unique identifier for the transaction */
    id: string;

    /** Reference to the associated listing */
    listingId: string;

    /** Identifier of the buyer */
    buyerId: string;

    /** Identifier of the seller */
    sellerId: string;

    /** Total transaction amount including fees */
    amount: number;

    /** Current status of the transaction */
    status: TransactionStatus;

    /** Payment method used for the transaction */
    paymentMethod: PaymentMethod;

    /** Stripe payment intent identifier */
    stripePaymentIntentId: string;

    /** Reference to associated BuyShield protection */
    buyShieldProtectionId?: string;

    /** Indicates if transaction is for local pickup */
    isLocalPickup: boolean;

    /** Indicates if photo verification is required */
    verificationRequired: boolean;

    /** Deadline for completing verification (72-hour window) */
    verificationDeadline?: Date;

    /** Shipping information for non-local transactions */
    shipping?: ShippingDetails;

    /** Breakdown of transaction fees */
    fees: TransactionFees;

    /** Timestamp of transaction creation */
    createdAt: Date;

    /** Timestamp of last transaction update */
    updatedAt: Date;

    /** Timestamp of transaction completion */
    completedAt?: Date;
}

/**
 * Interface for creating new transaction records
 * Defines required fields for transaction initialization
 */
export interface ITransactionCreationAttributes {
    /** Reference to the listing being purchased */
    listingId: string;

    /** Identifier of the buyer */
    buyerId: string;

    /** Identifier of the seller */
    sellerId: string;

    /** Total transaction amount */
    amount: number;

    /** Selected payment method */
    paymentMethod: PaymentMethod;

    /** Indicates if transaction is for local pickup */
    isLocalPickup: boolean;

    /** Indicates if photo verification is required */
    verificationRequired: boolean;
}

/**
 * Interface for transaction update operations
 * Defines fields that can be modified during transaction lifecycle
 */
export interface ITransactionUpdateAttributes {
    status?: TransactionStatus;
    stripePaymentIntentId?: string;
    buyShieldProtectionId?: string;
    shipping?: Partial<ShippingDetails>;
    verificationDeadline?: Date;
    completedAt?: Date;
}

/**
 * Interface for transaction search and filtering
 * Defines criteria for querying transactions
 */
export interface ITransactionSearchCriteria {
    buyerId?: string;
    sellerId?: string;
    status?: TransactionStatus | TransactionStatus[];
    isLocalPickup?: boolean;
    dateRange?: {
        start: Date;
        end: Date;
    };
    amountRange?: {
        min: number;
        max: number;
    };
    sortBy?: 'createdAt' | 'amount' | 'status';
    sortOrder?: 'asc' | 'desc';
}

/**
 * Type guard to check if a status is a valid transaction status
 * @param status - Status value to check
 */
export const isValidTransactionStatus = (status: string): status is TransactionStatus => {
    return Object.values(TransactionStatus).includes(status as TransactionStatus);
};

/**
 * Type guard to check if a payment method is supported
 * @param method - Payment method to check
 */
export const isValidPaymentMethod = (method: string): method is PaymentMethod => {
    return Object.values(PaymentMethod).includes(method as PaymentMethod);
};