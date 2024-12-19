/**
 * @fileoverview Integration tests for BuyShield protection service
 * Tests the complete flow of escrow-based secure transactions including
 * photo verification and payment processing
 * @version 1.0.0
 */

import { describe, it, beforeEach, afterEach, expect, jest } from 'jest';
import supertest from 'supertest';
import { faker } from '@faker-js/faker';
import { IBuyShieldProtection, VerificationStatus } from '../../src/interfaces/buyshield.interface';
import { VerificationService } from '../../src/services/buyshield/verification.service';
import { EscrowService } from '../../src/services/buyshield/escrow.service';
import { BUYSHIELD_STATUS, VERIFICATION_STATUS } from '../../src/constants/status.constants';

// Constants for test configuration
const TEST_TIMEOUT = 15000;
const ESCROW_AMOUNT = 1000; // $10.00
const VERIFICATION_WINDOW = 72 * 60 * 60 * 1000; // 72 hours in milliseconds

// Mock services
jest.mock('../../src/services/buyshield/verification.service');
jest.mock('../../src/services/buyshield/escrow.service');
jest.mock('../../src/services/external/stripe.service');

describe('BuyShield Protection Flow', () => {
  let verificationService: VerificationService;
  let escrowService: EscrowService;
  let testData: {
    buyerId: string;
    sellerId: string;
    listingId: string;
    transactionId: string;
    protection: IBuyShieldProtection;
    verificationPhoto: string;
  };

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Initialize services
    verificationService = new VerificationService();
    escrowService = new EscrowService();

    // Setup test data
    testData = await setupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  it('should create new BuyShield protection with escrow hold', async () => {
    // Arrange
    const protectionData = {
      buyerId: testData.buyerId,
      sellerId: testData.sellerId,
      listingId: testData.listingId,
      amount: ESCROW_AMOUNT,
      transactionId: testData.transactionId
    };

    // Mock escrow service response
    const mockEscrowId = faker.string.uuid();
    jest.spyOn(escrowService, 'createEscrowHold').mockResolvedValue(mockEscrowId);

    // Act
    const response = await supertest(app)
      .post('/api/buyshield/protections')
      .send(protectionData)
      .expect(201);

    // Assert
    expect(response.body.protection).toBeDefined();
    expect(response.body.protection.status).toBe(BUYSHIELD_STATUS.ACTIVE);
    expect(response.body.protection.escrowId).toBe(mockEscrowId);
    expect(response.body.protection.amount).toBe(ESCROW_AMOUNT);
    expect(escrowService.createEscrowHold).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: ESCROW_AMOUNT,
        transactionId: testData.transactionId
      })
    );
  }, TEST_TIMEOUT);

  it('should process verification photo successfully', async () => {
    // Arrange
    const verificationData = {
      protectionId: testData.protection.id,
      photo: testData.verificationPhoto,
      metadata: {
        timestamp: new Date().toISOString(),
        location: {
          latitude: faker.location.latitude(),
          longitude: faker.location.longitude()
        }
      }
    };

    // Mock verification service response
    jest.spyOn(verificationService, 'verifyTransaction').mockResolvedValue({
      success: true,
      status: VerificationStatus.APPROVED,
      confidence: 0.95,
      metadata: verificationData.metadata
    });

    // Act
    const response = await supertest(app)
      .post(`/api/buyshield/protections/${testData.protection.id}/verify`)
      .send(verificationData)
      .expect(200);

    // Assert
    expect(response.body.verification).toBeDefined();
    expect(response.body.verification.status).toBe(VERIFICATION_STATUS.APPROVED);
    expect(verificationService.verifyTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: testData.protection.id,
        verificationPhoto: testData.verificationPhoto
      })
    );
  }, TEST_TIMEOUT);

  it('should complete transaction and release funds after verification', async () => {
    // Arrange
    const protectionId = testData.protection.id;
    
    // Mock successful verification and escrow release
    jest.spyOn(verificationService, 'verifyTransaction').mockResolvedValue({
      success: true,
      status: VerificationStatus.APPROVED,
      confidence: 0.95,
      metadata: { verifiedAt: new Date().toISOString() }
    });
    jest.spyOn(escrowService, 'releaseEscrowFunds').mockResolvedValue(true);

    // Act
    const response = await supertest(app)
      .post(`/api/buyshield/protections/${protectionId}/complete`)
      .expect(200);

    // Assert
    expect(response.body.status).toBe(BUYSHIELD_STATUS.COMPLETED);
    expect(escrowService.releaseEscrowFunds).toHaveBeenCalledWith(
      testData.protection.escrowId
    );
  }, TEST_TIMEOUT);

  it('should handle expired protection and refund', async () => {
    // Arrange
    const expiredProtection = {
      ...testData.protection,
      expiresAt: new Date(Date.now() - 1000) // Set to past date
    };

    // Mock escrow service refund
    jest.spyOn(escrowService, 'refundEscrowFunds').mockResolvedValue(faker.string.uuid());
    jest.spyOn(escrowService, 'checkEscrowExpiration').mockResolvedValue(true);

    // Act
    const response = await supertest(app)
      .get(`/api/buyshield/protections/${expiredProtection.id}/status`)
      .expect(200);

    // Assert
    expect(response.body.status).toBe(BUYSHIELD_STATUS.EXPIRED);
    expect(escrowService.refundEscrowFunds).toHaveBeenCalledWith(
      expiredProtection.escrowId
    );
  }, TEST_TIMEOUT);

  it('should handle security violations and fraud attempts', async () => {
    // Arrange
    const fraudulentVerification = {
      protectionId: testData.protection.id,
      photo: 'invalid_photo_data',
      metadata: {
        timestamp: new Date(Date.now() - VERIFICATION_WINDOW - 1000).toISOString() // Invalid timestamp
      }
    };

    // Mock verification service to detect fraud
    jest.spyOn(verificationService, 'verifyTransaction').mockRejectedValue(
      new Error('Potential fraudulent activity detected')
    );

    // Act & Assert
    await supertest(app)
      .post(`/api/buyshield/protections/${testData.protection.id}/verify`)
      .send(fraudulentVerification)
      .expect(400)
      .then(response => {
        expect(response.body.error).toBeDefined();
        expect(response.body.error.code).toBe(5001); // AI_SERVICE_ERRORS.IMAGE_PROCESSING_FAILED
      });
  }, TEST_TIMEOUT);
});

/**
 * Sets up test data for BuyShield integration tests
 */
async function setupTestData() {
  const buyerId = faker.string.uuid();
  const sellerId = faker.string.uuid();
  const listingId = faker.string.uuid();
  const transactionId = faker.string.uuid();
  const escrowId = faker.string.uuid();

  const protection: IBuyShieldProtection = {
    id: faker.string.uuid(),
    transactionId,
    buyerId,
    sellerId,
    amount: ESCROW_AMOUNT,
    status: BUYSHIELD_STATUS.ACTIVE,
    verificationStatus: VERIFICATION_STATUS.PENDING,
    verificationPhoto: '',
    escrowId,
    expiresAt: new Date(Date.now() + VERIFICATION_WINDOW),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const verificationPhoto = 'data:image/jpeg;base64,' + faker.string.alpha(1000);

  return {
    buyerId,
    sellerId,
    listingId,
    transactionId,
    protection,
    verificationPhoto
  };
}

/**
 * Cleans up test data after tests complete
 */
async function cleanupTestData() {
  // Clean up any test data created in the database
  // Reset mock services
  jest.resetAllMocks();
}