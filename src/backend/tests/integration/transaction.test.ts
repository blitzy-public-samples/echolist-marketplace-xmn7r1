/**
 * @fileoverview Integration tests for EchoList transaction management system
 * Tests transaction lifecycle, BuyShield protection, and security measures
 * @version 1.0.0
 */

import request from 'supertest'; // ^6.1.3
import { expect, jest, describe, beforeAll, afterAll, beforeEach, afterEach, it } from '@jest/globals'; // ^29.0.0
import Stripe from 'stripe'; // ^8.191.0

import { TransactionController } from '../../src/api/controllers/transaction.controller';
import { ITransaction, TransactionStatus, PaymentMethod } from '../../interfaces/transaction.interface';
import { BuyShieldStatus, VerificationStatus } from '../../interfaces/buyshield.interface';
import { TRANSACTION_ERRORS, ERROR_MESSAGES } from '../../constants/error.constants';
import { logger } from '../../utils/logger.util';

// Test configuration
const TEST_TIMEOUT = 30000;
const SECURITY_CONFIG = {
  encryption: 'AES-256-GCM',
  rateLimit: 100,
  timeout: 72 // hours
};

describe('Transaction Integration Tests', () => {
  let app: Express.Application;
  let testBuyer: IUser;
  let testSeller: IUser;
  let testListing: IListing;
  let stripeTestClient: Stripe;
  let testTransactionId: string;

  beforeAll(async () => {
    // Initialize test environment
    app = await setupTestServer();
    stripeTestClient = new Stripe(process.env.STRIPE_TEST_SECRET_KEY!, {
      apiVersion: '2023-10-16'
    });

    // Create test data
    const testData = await setupTestData();
    testBuyer = testData.buyer;
    testSeller = testData.seller;
    testListing = testData.listing;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Transaction Creation', () => {
    it('should create a standard marketplace transaction successfully', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: 100.00,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          isLocalPickup: false
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        status: TransactionStatus.PAYMENT_PENDING,
        buyerId: testBuyer.id,
        sellerId: testSeller.id,
        amount: 100.00
      });

      testTransactionId = response.body.data.id;
    });

    it('should create a BuyShield protected local transaction', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: 150.00,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          isLocalPickup: true
        });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        status: TransactionStatus.PAYMENT_PENDING,
        isLocalPickup: true,
        verificationRequired: true
      });
      expect(response.body.data.buyShield).toBeDefined();
    });

    it('should enforce rate limiting on transaction creation', async () => {
      const requests = Array(SECURITY_CONFIG.rateLimit + 1).fill(null);
      
      const responses = await Promise.all(
        requests.map(() => 
          request(app)
            .post('/api/transactions')
            .set('Authorization', `Bearer ${testBuyer.token}`)
            .send({
              listingId: testListing.id,
              sellerId: testSeller.id,
              amount: 100.00
            })
        )
      );

      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.status).toBe(429);
    });
  });

  describe('BuyShield Protection', () => {
    let buyShieldTransactionId: string;

    beforeEach(async () => {
      // Create a test BuyShield transaction
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: 200.00,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          isLocalPickup: true
        });

      buyShieldTransactionId = response.body.data.id;
    });

    it('should process BuyShield escrow payment successfully', async () => {
      const response = await request(app)
        .post(`/api/transactions/${buyShieldTransactionId}/escrow`)
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          paymentMethodId: 'pm_test_card'
        });

      expect(response.status).toBe(200);
      expect(response.body.data.buyShield.status).toBe(BuyShieldStatus.ACTIVE);
      expect(response.body.data.status).toBe(TransactionStatus.ESCROW_HOLD);
    });

    it('should verify BuyShield photo submission', async () => {
      const response = await request(app)
        .post(`/api/transactions/${buyShieldTransactionId}/verify`)
        .set('Authorization', `Bearer ${testSeller.token}`)
        .attach('photo', Buffer.from('mock-image'), 'verification.jpg');

      expect(response.status).toBe(200);
      expect(response.body.data.buyShield.verificationStatus).toBe(VerificationStatus.SUBMITTED);
    });

    it('should enforce 72-hour protection window', async () => {
      // Fast-forward time by 73 hours
      jest.useFakeTimers();
      jest.advanceTimersByTime(73 * 60 * 60 * 1000);

      const response = await request(app)
        .get(`/api/transactions/${buyShieldTransactionId}`)
        .set('Authorization', `Bearer ${testBuyer.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.buyShield.status).toBe(BuyShieldStatus.EXPIRED);
      expect(response.body.data.status).toBe(TransactionStatus.CANCELLED);

      jest.useRealTimers();
    });
  });

  describe('Transaction Completion', () => {
    it('should complete a standard transaction successfully', async () => {
      const response = await request(app)
        .post(`/api/transactions/${testTransactionId}/complete`)
        .set('Authorization', `Bearer ${testSeller.token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(TransactionStatus.COMPLETED);
      expect(response.body.data.completedAt).toBeDefined();
    });

    it('should complete a BuyShield transaction after verification', async () => {
      // Create and process BuyShield transaction
      const createResponse = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: 300.00,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          isLocalPickup: true
        });

      const transactionId = createResponse.body.data.id;

      // Submit verification
      await request(app)
        .post(`/api/transactions/${transactionId}/verify`)
        .set('Authorization', `Bearer ${testSeller.token}`)
        .attach('photo', Buffer.from('mock-image'), 'verification.jpg');

      // Complete transaction
      const completeResponse = await request(app)
        .post(`/api/transactions/${transactionId}/complete`)
        .set('Authorization', `Bearer ${testBuyer.token}`);

      expect(completeResponse.status).toBe(200);
      expect(completeResponse.body.data.status).toBe(TransactionStatus.COMPLETED);
      expect(completeResponse.body.data.buyShield.status).toBe(BuyShieldStatus.COMPLETED);
    });
  });

  describe('Transaction Cancellation', () => {
    it('should cancel a pending transaction with refund', async () => {
      const response = await request(app)
        .post(`/api/transactions/${testTransactionId}/cancel`)
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({ reason: 'Changed mind' });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(TransactionStatus.CANCELLED);
    });

    it('should handle BuyShield cancellation with escrow refund', async () => {
      // Create test BuyShield transaction
      const createResponse = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: 400.00,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          isLocalPickup: true
        });

      const transactionId = createResponse.body.data.id;

      // Cancel transaction
      const cancelResponse = await request(app)
        .post(`/api/transactions/${transactionId}/cancel`)
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({ reason: 'Seller not responding' });

      expect(cancelResponse.status).toBe(200);
      expect(cancelResponse.body.data.status).toBe(TransactionStatus.CANCELLED);
      expect(cancelResponse.body.data.buyShield.status).toBe(BuyShieldStatus.CANCELLED);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid transaction amounts', async () => {
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: -100,
          paymentMethod: PaymentMethod.CREDIT_CARD
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(TRANSACTION_ERRORS.INVALID_AMOUNT);
    });

    it('should handle payment processing failures', async () => {
      // Mock Stripe to simulate payment failure
      jest.spyOn(stripeTestClient.paymentIntents, 'create')
        .mockRejectedValueOnce(new Error('Payment failed'));

      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${testBuyer.token}`)
        .send({
          listingId: testListing.id,
          sellerId: testSeller.id,
          amount: 500.00,
          paymentMethod: PaymentMethod.CREDIT_CARD
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe(TRANSACTION_ERRORS.PAYMENT_FAILED);
    });
  });
});

/**
 * Helper function to setup test data
 */
async function setupTestData() {
  // Create test buyer with verified payment method
  const buyer = await createTestUser({
    email: 'buyer@test.com',
    stripeCustomerId: 'cus_test_buyer'
  });

  // Create test seller with escrow account
  const seller = await createTestUser({
    email: 'seller@test.com',
    stripeConnectId: 'acct_test_seller'
  });

  // Create test listing
  const listing = await createTestListing({
    userId: seller.id,
    price: 1000.00,
    title: 'Test Item'
  });

  return { buyer, seller, listing };
}

/**
 * Helper function to cleanup test data
 */
async function cleanupTestData() {
  await Promise.all([
    deleteTestUsers(),
    deleteTestListings(),
    deleteTestTransactions()
  ]);
}