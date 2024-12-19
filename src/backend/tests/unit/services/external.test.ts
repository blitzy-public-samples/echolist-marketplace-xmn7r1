/**
 * @fileoverview Unit test suite for external service integrations
 * Tests Amazon, eBay, Stripe marketplace APIs and payment processing
 * @version 1.0.0
 */

import { AmazonService } from '../../../src/services/external/amazon.service';
import { EbayService } from '../../../src/services/external/ebay.service';
import { StripeService } from '../../../src/services/external/stripe.service';
import { RabbitMQService } from '../../../src/services/queue/rabbitmq.service';
import { SYNC_STATUS } from '../../../src/constants/status.constants';
import { logger } from '../../../src/utils/logger.util';
import { IMarketplaceSync } from '../../../src/interfaces/marketplace.interface';
import { IListing } from '../../../src/interfaces/listing.interface';
import { PaymentStatus } from '../../../src/interfaces/payment.interface';

// Mock external dependencies
jest.mock('../../../src/services/queue/rabbitmq.service');
jest.mock('stripe');
jest.mock('amazon-mws');
jest.mock('ebay-api-node');

describe('External Service Integration Tests', () => {
  let amazonService: AmazonService;
  let ebayService: EbayService;
  let stripeService: StripeService;
  let queueService: jest.Mocked<RabbitMQService>;

  beforeEach(() => {
    // Initialize mocked queue service
    queueService = new RabbitMQService() as jest.Mocked<RabbitMQService>;
    
    // Initialize services with mocked dependencies
    amazonService = new AmazonService(queueService, logger);
    ebayService = new EbayService(queueService);
    stripeService = new StripeService(
      'test_stripe_key',
      {
        webhookSecret: 'test_webhook_secret',
        apiVersion: '2023-10-16',
        maxRetryAttempts: 3,
        retryDelayMs: 100
      },
      logger
    );
  });

  describe('AmazonService', () => {
    const mockCredentials = {
      platform: 'AMAZON',
      apiKey: 'test_api_key',
      secretKey: 'test_secret_key',
      sellerId: 'test_seller_id',
      marketplaceId: 'test_marketplace_id'
    };

    const mockListing: Partial<IListing> = {
      id: 'test_listing_id',
      title: 'Test Product',
      description: 'Test Description',
      price: 9999,
      images: ['image1.jpg', 'image2.jpg']
    };

    test('should authenticate with Amazon MWS successfully', async () => {
      const result = await amazonService.authenticate(mockCredentials);
      expect(result).toBe(true);
      expect(queueService.publishMessage).toHaveBeenCalledTimes(0);
    });

    test('should create listing on Amazon with retry mechanism', async () => {
      const expectedSync: IMarketplaceSync = {
        listingId: mockListing.id!,
        externalId: 'amazon_product_id',
        status: SYNC_STATUS.SYNCED,
        lastSyncTime: expect.any(Date),
        errors: []
      };

      const result = await amazonService.createListing(mockListing.id!, mockListing);
      expect(result).toEqual(expectedSync);
      expect(queueService.publishMessage).toHaveBeenCalledWith(
        'marketplace_sync',
        'sync.listing',
        expect.any(Buffer)
      );
    });

    test('should handle rate limits during listing creation', async () => {
      // Mock rate limit error
      jest.spyOn(amazonService as any, 'executeApiCall')
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({ productId: 'amazon_product_id' });

      const result = await amazonService.createListing(mockListing.id!, mockListing);
      expect(result.status).toBe(SYNC_STATUS.SYNCED);
    });
  });

  describe('EbayService', () => {
    const mockListing: Partial<IListing> = {
      id: 'test_listing_id',
      title: 'Test Product',
      description: 'Test Description',
      price: 9999,
      images: ['image1.jpg']
    };

    test('should authenticate with eBay OAuth successfully', async () => {
      await ebayService.authenticateEbay();
      expect(queueService.publishMessage).toHaveBeenCalledTimes(0);
    });

    test('should create listing on eBay with validation', async () => {
      const expectedSync: IMarketplaceSync = {
        listingId: mockListing.id!,
        platform: 'EBAY',
        externalId: 'ebay_item_id',
        status: SYNC_STATUS.SYNCED,
        lastSyncAttempt: expect.any(Date),
        syncErrors: []
      };

      const result = await ebayService.createEbayListing(mockListing as IListing);
      expect(result).toEqual(expectedSync);
      expect(queueService.publishMessage).toHaveBeenCalledWith(
        'marketplace_sync',
        'sync.listing',
        expect.any(Buffer)
      );
    });

    test('should handle conflicts during inventory sync', async () => {
      await expect(ebayService.syncInventory('ebay_item_id', 5))
        .resolves.not.toThrow();
    });
  });

  describe('StripeService', () => {
    const mockPayment = {
      amount: 9999,
      currency: 'USD',
      transactionId: 'test_transaction_id'
    };

    test('should create payment intent with proper validation', async () => {
      const result = await stripeService.createPaymentIntent(mockPayment);
      expect(result).toEqual({
        clientSecret: expect.any(String),
        paymentIntentId: expect.any(String)
      });
    });

    test('should create escrow payment for BuyShield protection', async () => {
      const result = await stripeService.createEscrowPayment(mockPayment, {
        buyShieldId: 'test_buyshield_id'
      });

      expect(result).toEqual({
        clientSecret: expect.any(String),
        paymentIntentId: expect.any(String),
        holdExpiresAt: expect.any(Date)
      });
    });

    test('should capture authorized payment successfully', async () => {
      const result = await stripeService.capturePayment('test_payment_intent_id');
      expect(result).toEqual({
        success: true,
        transactionId: expect.any(String)
      });
    });

    test('should process refund with proper validation', async () => {
      const result = await stripeService.createRefund('test_payment_intent_id', {
        amount: 9999,
        reason: 'requested_by_customer'
      });

      expect(result).toEqual({
        refundId: expect.any(String),
        status: expect.any(String)
      });
    });

    test('should retry failed payment operations', async () => {
      // Mock temporary API failure
      jest.spyOn(stripeService as any, 'retryOperation')
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({
          id: 'test_payment_intent_id',
          client_secret: 'test_client_secret'
        });

      const result = await stripeService.createPaymentIntent(mockPayment);
      expect(result.paymentIntentId).toBe('test_payment_intent_id');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});