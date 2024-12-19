/**
 * @fileoverview Unit tests for TransactionService
 * Tests transaction lifecycle, BuyShield protection, payment processing, and security validations
 * @version 1.0.0
 */

import { describe, beforeEach, it, expect, jest } from '@jest/globals';
import type { MockInstance } from 'jest-mock';
import { TransactionService } from '../../../src/services/transaction/transaction.service';
import { PaymentService } from '../../../src/services/transaction/payment.service';
import { TransactionModel } from '../../../src/db/models/transaction.model';
import { 
  TRANSACTION_STATUS, 
  BUYSHIELD_STATUS 
} from '../../../src/constants/status.constants';
import { 
  PaymentStatus, 
  PaymentMethod, 
  PaymentType 
} from '../../../src/interfaces/payment.interface';
import { Logger } from 'winston';
import { RabbitMQClient } from 'amqplib';
import { Redis } from 'ioredis';

describe('TransactionService', () => {
  let transactionService: TransactionService;
  let paymentServiceMock: jest.Mocked<PaymentService>;
  let loggerMock: jest.Mocked<Logger>;
  let mqClientMock: jest.Mocked<RabbitMQClient>;
  let redisMock: jest.Mocked<Redis>;
  let transactionModelMock: jest.Mocked<typeof TransactionModel>;

  const mockTransaction = {
    id: 'tx_123',
    buyerId: 'buyer_123',
    sellerId: 'seller_123',
    amount: 1000,
    status: TRANSACTION_STATUS.INITIATED,
    paymentMethod: PaymentMethod.CREDIT_CARD,
    isLocalPickup: false,
    stripePaymentIntentId: 'pi_123',
    fees: {
      platformFee: 50,
      processingFee: 29.30,
      buyShieldFee: 10,
      totalFees: 89.30
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    // Initialize mocks
    paymentServiceMock = {
      processPayment: jest.fn(),
      processBuyShieldPayment: jest.fn(),
      capturePayment: jest.fn(),
      refundPayment: jest.fn()
    } as any;

    loggerMock = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      child: jest.fn().mockReturnThis()
    } as any;

    mqClientMock = {
      publish: jest.fn()
    } as any;

    redisMock = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn()
    } as any;

    transactionModelMock = {
      create: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn()
    } as any;

    // Create service instance with mocked dependencies
    transactionService = new TransactionService(
      paymentServiceMock,
      loggerMock,
      mqClientMock,
      redisMock
    );
  });

  describe('createTransaction', () => {
    const createTransactionData = {
      buyerId: 'buyer_123',
      sellerId: 'seller_123',
      listingId: 'listing_123',
      amount: 1000,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      isLocalPickup: false,
      verificationRequired: false
    };

    it('should create transaction with proper validation', async () => {
      // Setup mocks
      transactionModelMock.create.mockResolvedValueOnce(mockTransaction);
      paymentServiceMock.processPayment.mockResolvedValueOnce({
        success: true,
        paymentId: 'payment_123',
        status: PaymentStatus.PENDING,
        message: 'Payment intent created',
        stripeClientSecret: 'secret_123'
      });

      // Execute test
      const result = await transactionService.createTransaction(createTransactionData);

      // Verify results
      expect(result).toBeDefined();
      expect(result.id).toBe(mockTransaction.id);
      expect(result.status).toBe(TRANSACTION_STATUS.PAYMENT_PENDING);
      expect(paymentServiceMock.processPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: createTransactionData.amount,
          type: PaymentType.MARKETPLACE
        })
      );
      expect(mqClientMock.publish).toHaveBeenCalledWith(
        'transactions',
        'transaction.created',
        expect.any(Buffer)
      );
    });

    it('should handle BuyShield protection flow for local pickup', async () => {
      // Setup test data
      const localTransactionData = {
        ...createTransactionData,
        isLocalPickup: true,
        verificationRequired: true
      };

      // Setup mocks
      const buyShieldTransaction = {
        ...mockTransaction,
        isLocalPickup: true,
        buyShield: {
          protectionStart: new Date(),
          protectionEnd: new Date(Date.now() + 72 * 60 * 60 * 1000),
          verificationStatus: 'PENDING'
        }
      };
      transactionModelMock.create.mockResolvedValueOnce(buyShieldTransaction);
      paymentServiceMock.processBuyShieldPayment.mockResolvedValueOnce({
        success: true,
        paymentId: 'payment_123',
        status: PaymentStatus.AUTHORIZED,
        message: 'BuyShield escrow created',
        escrowId: 'escrow_123'
      });

      // Execute test
      const result = await transactionService.createTransaction(localTransactionData);

      // Verify results
      expect(result.isLocalPickup).toBe(true);
      expect(result.buyShield).toBeDefined();
      expect(result.buyShield.verificationStatus).toBe('PENDING');
      expect(paymentServiceMock.processBuyShieldPayment).toHaveBeenCalled();
    });

    it('should validate transaction amount', async () => {
      const invalidData = {
        ...createTransactionData,
        amount: -100
      };

      await expect(
        transactionService.createTransaction(invalidData)
      ).rejects.toThrow('Invalid transaction amount');
    });
  });

  describe('processLocalTransaction', () => {
    it('should process local transaction with BuyShield protection', async () => {
      // Setup mocks
      const localTransaction = {
        ...mockTransaction,
        isLocalPickup: true,
        status: TRANSACTION_STATUS.PAYMENT_COMPLETED
      };
      redisMock.get.mockResolvedValueOnce(null);
      transactionModelMock.findById.mockResolvedValueOnce(localTransaction);
      transactionModelMock.findByIdAndUpdate.mockResolvedValueOnce({
        ...localTransaction,
        status: TRANSACTION_STATUS.AWAITING_MEETUP,
        buyShieldProtectionId: 'protection_123'
      });

      // Execute test
      const result = await transactionService.processLocalTransaction('tx_123');

      // Verify results
      expect(result.status).toBe(TRANSACTION_STATUS.AWAITING_MEETUP);
      expect(result.buyShieldProtectionId).toBeDefined();
      expect(mqClientMock.publish).toHaveBeenCalledWith(
        'transactions',
        'buyshield.activated',
        expect.any(Buffer)
      );
    });

    it('should throw error for non-local transaction', async () => {
      redisMock.get.mockResolvedValueOnce(null);
      transactionModelMock.findById.mockResolvedValueOnce({
        ...mockTransaction,
        isLocalPickup: false
      });

      await expect(
        transactionService.processLocalTransaction('tx_123')
      ).rejects.toThrow('Transaction is not marked for local pickup');
    });
  });

  describe('completeTransaction', () => {
    it('should complete transaction and release escrow if applicable', async () => {
      // Setup mocks
      const localTransaction = {
        ...mockTransaction,
        isLocalPickup: true,
        status: TRANSACTION_STATUS.AWAITING_MEETUP
      };
      redisMock.get.mockResolvedValueOnce(null);
      transactionModelMock.findById.mockResolvedValueOnce(localTransaction);
      transactionModelMock.findByIdAndUpdate.mockResolvedValueOnce({
        ...localTransaction,
        status: TRANSACTION_STATUS.COMPLETED,
        completedAt: expect.any(Date)
      });
      paymentServiceMock.capturePayment.mockResolvedValueOnce({
        success: true,
        transactionId: 'tx_123'
      });

      // Execute test
      const result = await transactionService.completeTransaction('tx_123');

      // Verify results
      expect(result.status).toBe(TRANSACTION_STATUS.COMPLETED);
      expect(result.completedAt).toBeDefined();
      expect(paymentServiceMock.capturePayment).toHaveBeenCalled();
      expect(mqClientMock.publish).toHaveBeenCalledWith(
        'transactions',
        'transaction.completed',
        expect.any(Buffer)
      );
    });
  });

  describe('cancelTransaction', () => {
    it('should cancel transaction and process refund', async () => {
      // Setup mocks
      redisMock.get.mockResolvedValueOnce(null);
      transactionModelMock.findById.mockResolvedValueOnce(mockTransaction);
      transactionModelMock.findByIdAndUpdate.mockResolvedValueOnce({
        ...mockTransaction,
        status: TRANSACTION_STATUS.CANCELLED
      });
      paymentServiceMock.refundPayment.mockResolvedValueOnce({
        success: true,
        paymentId: 'payment_123',
        status: PaymentStatus.REFUNDED,
        message: 'Refund processed'
      });

      // Execute test
      const result = await transactionService.cancelTransaction('tx_123', 'Customer requested');

      // Verify results
      expect(result.status).toBe(TRANSACTION_STATUS.CANCELLED);
      expect(paymentServiceMock.refundPayment).toHaveBeenCalledWith(
        mockTransaction.stripePaymentIntentId,
        expect.any(Object)
      );
      expect(mqClientMock.publish).toHaveBeenCalledWith(
        'transactions',
        'transaction.cancelled',
        expect.any(Buffer)
      );
    });
  });

  // Add more test cases for error handling, edge cases, and other scenarios...
});