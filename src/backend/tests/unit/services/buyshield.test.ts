import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import dayjs from 'dayjs'; // v1.11.0
import { EscrowService } from '../../../src/services/buyshield/escrow.service';
import { VerificationService } from '../../../src/services/buyshield/verification.service';
import { IBuyShieldProtection, BuyShieldStatus, VerificationStatus } from '../../../src/interfaces/buyshield.interface';
import { ImageRecognitionService } from '../../../src/services/ai/imageRecognition.service';
import { createCustomError } from '../../../src/utils/error.util';
import { AI_SERVICE_ERRORS } from '../../../src/constants/error.constants';

// Mock external services
jest.mock('../../../src/services/ai/imageRecognition.service');
jest.mock('../../../src/services/external/stripe.service');
jest.mock('../../../src/utils/logger.util');

describe('BuyShield Service Tests', () => {
  let escrowService: EscrowService;
  let verificationService: VerificationService;
  let mockStripeService: any;
  let mockLogger: any;
  let mockMetrics: any;

  // Test data setup
  const mockProtection: IBuyShieldProtection = {
    id: 'test-protection-123',
    transactionId: 'test-transaction-123',
    buyerId: 'buyer-123',
    sellerId: 'seller-123',
    amount: 10000, // $100.00
    status: BuyShieldStatus.ACTIVE,
    verificationStatus: VerificationStatus.PENDING,
    verificationPhoto: 'https://test-bucket.s3.amazonaws.com/photo.jpg',
    escrowId: 'test-escrow-123',
    expiresAt: dayjs().add(72, 'hour').toDate(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock services
    mockStripeService = {
      createEscrowPayment: jest.fn(),
      capturePayment: jest.fn(),
      createRefund: jest.fn()
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    mockMetrics = {
      Counter: jest.fn().mockImplementation(() => ({
        inc: jest.fn()
      })),
      Histogram: jest.fn().mockImplementation(() => ({
        observe: jest.fn()
      }))
    };

    // Initialize services
    escrowService = new EscrowService(mockStripeService, mockLogger);
    verificationService = new VerificationService(
      new ImageRecognitionService(),
      escrowService,
      mockLogger,
      mockMetrics
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('EscrowService', () => {
    test('should create escrow hold successfully', async () => {
      const mockPaymentIntent = {
        paymentIntentId: 'pi_123',
        clientSecret: 'secret_123'
      };

      mockStripeService.createEscrowPayment.mockResolvedValue(mockPaymentIntent);

      const result = await escrowService.createEscrowHold(mockProtection);

      expect(result).toBe(mockPaymentIntent.paymentIntentId);
      expect(mockStripeService.createEscrowPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: mockProtection.amount,
          currency: 'USD',
          transactionId: mockProtection.transactionId
        }),
        expect.objectContaining({
          buyShieldId: mockProtection.id
        })
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Escrow hold created successfully',
        expect.any(Object)
      );
    });

    test('should handle escrow hold creation failure', async () => {
      const mockError = new Error('Stripe API error');
      mockStripeService.createEscrowPayment.mockRejectedValue(mockError);

      await expect(escrowService.createEscrowHold(mockProtection))
        .rejects.toThrow('Stripe API error');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to create escrow hold',
        expect.any(Object)
      );
    });

    test('should release escrow funds after successful verification', async () => {
      mockStripeService.capturePayment.mockResolvedValue({
        success: true,
        transactionId: mockProtection.transactionId
      });

      const result = await escrowService.releaseEscrowFunds(mockProtection.escrowId);

      expect(result).toBe(true);
      expect(mockStripeService.capturePayment).toHaveBeenCalledWith(
        mockProtection.escrowId
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Escrow funds released successfully',
        expect.any(Object)
      );
    });

    test('should handle escrow release failure with retries', async () => {
      const mockError = new Error('Payment capture failed');
      mockStripeService.capturePayment.mockRejectedValue(mockError);

      await expect(escrowService.releaseEscrowFunds(mockProtection.escrowId))
        .rejects.toThrow('Payment capture failed');

      expect(mockStripeService.capturePayment).toHaveBeenCalledTimes(3); // Max retries
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to release escrow funds',
        expect.any(Object)
      );
    });

    test('should check escrow expiration correctly', async () => {
      const expiredProtection = {
        ...mockProtection,
        expiresAt: dayjs().subtract(1, 'hour').toDate()
      };

      const result = await escrowService.checkEscrowExpiration(expiredProtection);

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Checking escrow expiration',
        expect.any(Object)
      );
    });
  });

  describe('VerificationService', () => {
    test('should verify transaction with valid photo', async () => {
      const mockVerificationResult = {
        isValid: true,
        qualityScore: 0.95,
        fraudDetectionResult: {
          isFraudulent: false,
          confidence: 0.98
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      };

      (ImageRecognitionService.prototype.verifyImage as jest.Mock).mockResolvedValue({
        isAuthentic: true,
        qualityScore: 0.95,
        metadata: {}
      });

      const result = await verificationService.verifyTransaction(mockProtection);

      expect(result.success).toBe(true);
      expect(result.status).toBe(VerificationStatus.APPROVED);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(mockMetrics.attempts.inc).toHaveBeenCalled();
      expect(mockMetrics.success.inc).toHaveBeenCalled();
    });

    test('should reject verification with poor quality photo', async () => {
      (ImageRecognitionService.prototype.verifyImage as jest.Mock).mockResolvedValue({
        isAuthentic: true,
        qualityScore: 0.5,
        metadata: {}
      });

      await expect(verificationService.verifyTransaction(mockProtection))
        .rejects.toThrow(expect.objectContaining({
          code: AI_SERVICE_ERRORS.VERIFICATION_FAILED
        }));

      expect(mockMetrics.failures.inc).toHaveBeenCalled();
    });

    test('should handle maximum verification attempts', async () => {
      const maxAttemptsProtection = {
        ...mockProtection,
        verificationAttempts: 3
      };

      await expect(verificationService.verifyTransaction(maxAttemptsProtection))
        .rejects.toThrow('Maximum verification attempts exceeded');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Verification failed',
        expect.any(Object)
      );
    });

    test('should detect fraudulent verification attempts', async () => {
      (ImageRecognitionService.prototype.verifyImage as jest.Mock).mockResolvedValue({
        isAuthentic: false,
        qualityScore: 0.95,
        metadata: {
          fraudDetected: true
        }
      });

      await expect(verificationService.verifyTransaction(mockProtection))
        .rejects.toThrow('Potential fraudulent activity detected');

      expect(mockMetrics.failures.inc).toHaveBeenCalled();
    });
  });
});