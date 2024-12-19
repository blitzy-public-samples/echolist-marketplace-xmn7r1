/**
 * @fileoverview TypeScript interface definitions for the BuyShield protection service
 * Defines data structures for escrow-based secure transactions between buyers and sellers
 * @version 1.0.0
 */

/**
 * Enum defining the possible states of a BuyShield protection
 * Used to track the lifecycle of a protected transaction
 */
export enum BuyShieldStatus {
    ACTIVE = 'ACTIVE',         // Protection is active and funds are in escrow
    COMPLETED = 'COMPLETED',   // Transaction completed successfully
    CANCELLED = 'CANCELLED',   // Transaction was cancelled by either party
    EXPIRED = 'EXPIRED'        // 72-hour window expired without completion
}

/**
 * Enum defining the possible states of the verification process
 * Used to track the status of photo verification submissions
 */
export enum VerificationStatus {
    PENDING = 'PENDING',       // Awaiting photo submission
    SUBMITTED = 'SUBMITTED',   // Photo submitted, pending review
    APPROVED = 'APPROVED',     // Photo verified successfully
    REJECTED = 'REJECTED'      // Photo verification failed
}

/**
 * Interface defining the structure of a BuyShield protection record
 * Represents the core data structure for protected transactions
 */
export interface IBuyShieldProtection {
    /** Unique identifier for the protection record */
    id: string;
    
    /** Reference to the associated transaction */
    transactionId: string;
    
    /** Identifier of the buyer involved in the transaction */
    buyerId: string;
    
    /** Identifier of the seller involved in the transaction */
    sellerId: string;
    
    /** Transaction amount held in escrow */
    amount: number;
    
    /** Current status of the BuyShield protection */
    status: BuyShieldStatus;
    
    /** Current status of the verification process */
    verificationStatus: VerificationStatus;
    
    /** URL or reference to the verification photo */
    verificationPhoto: string;
    
    /** Reference to the escrow service record */
    escrowId: string;
    
    /** Timestamp when the protection expires (72-hour window) */
    expiresAt: Date;
    
    /** Timestamp when the protection was created */
    createdAt: Date;
    
    /** Timestamp of the last update to the protection */
    updatedAt: Date;
}

/**
 * Interface defining the structure of a verification result response
 * Used when returning the outcome of a verification attempt
 */
export interface IVerificationResult {
    /** Indicates if the verification was successful */
    success: boolean;
    
    /** Current status of the verification process */
    status: VerificationStatus;
    
    /** Human-readable message about the verification result */
    message: string;
    
    /** Remaining time in seconds before protection expires */
    timeRemaining: number;
}