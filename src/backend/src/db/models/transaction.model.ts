/**
 * @fileoverview Transaction model definition for the EchoList platform
 * Implements comprehensive transaction handling with BuyShield protection and payment processing
 * @version 1.0.0
 */

import { Schema, model, Types } from 'mongoose'; // ^6.0.0
import { ITransaction } from '../../interfaces/transaction.interface';
import { TRANSACTION_STATUS } from '../../constants/status.constants';

/**
 * Schema definition for shipping details within a transaction
 */
const ShippingSchema = new Schema({
  carrier: { type: String, required: false },
  trackingNumber: { type: String, required: false },
  label: { type: String, required: false },
  address: {
    street: { type: String, required: false },
    city: { type: String, required: false },
    state: { type: String, required: false },
    zipCode: { type: String, required: false },
    country: { type: String, required: false }
  },
  estimatedDelivery: { type: Date, required: false },
  isDelivered: { type: Boolean, default: false }
}, { _id: false });

/**
 * Schema definition for transaction fees
 */
const FeesSchema = new Schema({
  platformFee: { type: Number, required: true, min: 0 },
  processingFee: { type: Number, required: true, min: 0 },
  buyShieldFee: { type: Number, required: true, min: 0 },
  shippingFee: { type: Number, required: true, min: 0 },
  totalFees: { type: Number, required: true, min: 0 }
}, { _id: false });

/**
 * Schema definition for BuyShield protection details
 */
const BuyShieldSchema = new Schema({
  protectionStart: { type: Date, required: true },
  protectionEnd: { type: Date, required: true },
  verificationStatus: { 
    type: String, 
    enum: ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  verificationPhoto: { type: String, required: false },
  verificationTime: { type: Date, required: false }
}, { _id: false });

/**
 * Main transaction schema definition
 */
const TransactionSchema = new Schema({
  listingId: {
    type: Types.ObjectId,
    required: true,
    ref: 'Listing',
    index: true
  },
  buyerId: {
    type: Types.ObjectId,
    required: true,
    ref: 'User',
    index: true
  },
  sellerId: {
    type: Types.ObjectId,
    required: true,
    ref: 'User',
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: Object.values(TRANSACTION_STATUS),
    default: TRANSACTION_STATUS.INITIATED,
    required: true,
    index: true
  },
  paymentMethod: {
    type: String,
    enum: ['CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER'],
    required: true
  },
  stripePaymentIntentId: {
    type: String,
    sparse: true,
    index: true
  },
  buyShieldProtectionId: {
    type: Types.ObjectId,
    ref: 'BuyShieldProtection',
    required: false,
    index: true
  },
  isLocalPickup: {
    type: Boolean,
    required: true,
    default: false
  },
  shipping: {
    type: ShippingSchema,
    required: false
  },
  fees: {
    type: FeesSchema,
    required: true
  },
  buyShield: {
    type: BuyShieldSchema,
    required: false
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  completedAt: {
    type: Date,
    required: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true,
  collection: 'transactions'
});

/**
 * Indexes for optimizing common queries
 */
TransactionSchema.index({ buyerId: 1, createdAt: -1 });
TransactionSchema.index({ sellerId: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, expiresAt: 1 });
TransactionSchema.index({ stripePaymentIntentId: 1 }, { sparse: true });

/**
 * Pre-save middleware for transaction processing
 */
TransactionSchema.pre('save', async function(next) {
  // Update timestamps
  this.updatedAt = new Date();
  
  // Set expiration for new transactions (72-hour window)
  if (this.isNew) {
    this.expiresAt = new Date(Date.now() + (72 * 60 * 60 * 1000));
  }

  // Calculate BuyShield protection window if applicable
  if (this.isModified('buyShield') && this.buyShield) {
    this.buyShield.protectionStart = new Date();
    this.buyShield.protectionEnd = new Date(Date.now() + (72 * 60 * 60 * 1000));
  }

  // Validate status transitions
  if (this.isModified('status')) {
    const isValid = await this.validateStatusTransition();
    if (!isValid) {
      throw new Error(`Invalid status transition to ${this.status}`);
    }
  }

  // Calculate total fees
  if (this.isModified('fees')) {
    const { platformFee, processingFee, buyShieldFee, shippingFee } = this.fees;
    this.fees.totalFees = platformFee + processingFee + buyShieldFee + shippingFee;
  }

  next();
});

/**
 * Validates transaction status transitions
 */
TransactionSchema.methods.validateStatusTransition = async function(): Promise<boolean> {
  const validTransitions = {
    [TRANSACTION_STATUS.INITIATED]: [
      TRANSACTION_STATUS.PAYMENT_PENDING,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.PAYMENT_PENDING]: [
      TRANSACTION_STATUS.PAYMENT_COMPLETED,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.PAYMENT_COMPLETED]: [
      TRANSACTION_STATUS.AWAITING_MEETUP,
      TRANSACTION_STATUS.AWAITING_SHIPPING,
      TRANSACTION_STATUS.DISPUTED
    ],
    [TRANSACTION_STATUS.AWAITING_MEETUP]: [
      TRANSACTION_STATUS.COMPLETED,
      TRANSACTION_STATUS.DISPUTED,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.AWAITING_SHIPPING]: [
      TRANSACTION_STATUS.COMPLETED,
      TRANSACTION_STATUS.DISPUTED,
      TRANSACTION_STATUS.CANCELLED
    ],
    [TRANSACTION_STATUS.DISPUTED]: [
      TRANSACTION_STATUS.COMPLETED,
      TRANSACTION_STATUS.CANCELLED
    ]
  };

  const currentStatus = this.status;
  const newStatus = this.modifiedPaths().includes('status') ? this.get('status') : currentStatus;

  return validTransitions[currentStatus]?.includes(newStatus) || false;
};

/**
 * Static method to find transactions by buyer
 */
TransactionSchema.statics.findByBuyerId = function(buyerId: string) {
  return this.find({ buyerId }).sort({ createdAt: -1 });
};

/**
 * Static method to find transactions by seller
 */
TransactionSchema.statics.findBySellerId = function(sellerId: string) {
  return this.find({ sellerId }).sort({ createdAt: -1 });
};

/**
 * Static method to find active BuyShield transactions
 */
TransactionSchema.statics.findActiveBuyShield = function() {
  return this.find({
    'buyShield.protectionEnd': { $gt: new Date() },
    status: { $nin: [TRANSACTION_STATUS.COMPLETED, TRANSACTION_STATUS.CANCELLED] }
  });
};

// Export the transaction model
export const TransactionModel = model<ITransaction>('Transaction', TransactionSchema);