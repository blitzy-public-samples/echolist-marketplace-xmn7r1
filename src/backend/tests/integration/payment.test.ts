/**
 * @fileoverview Integration tests for payment processing functionality
 * Tests payment flows including standard marketplace payments and BuyShield protected transactions
 * @version 1.0.0
 */

import { describe, beforeAll, beforeEach, afterAll, it, expect, jest } from '@jest/globals';
import { PaymentService } from '../../src/services/transaction/payment.service';
import { StripeService } from '../../src/services/external/stripe.service';
import { PaymentStatus, PaymentType, PaymentMethod } from '../../interfaces/payment.interface';
import { BuyShieldStatus, VerificationStatus } from '../../interfaces/buyshield.interface';
import { TRANSACTION_STATUS } from '../../constants/status.constants';
import StripeMock from 'stripe-mock';

// Test timeout configuration
jest.setTimeout(30000);

describe('PaymentService Integration Tests', () => {
    let paymentService: PaymentService;
    let stripeService: StripeService;
    let stripeMock: StripeMock;

    // Test data
    const testPayment = {
        id: 'test_payment_123',
        transactionId: 'test_transaction_123',
        amount: 10000, // $100.00
        currency: 'USD',
        status: PaymentStatus.PENDING,
        type: PaymentType.MARKETPLACE,
        method: PaymentMethod.CREDIT_CARD,
        stripePaymentIntentId: '',
        stripeCustomerId: 'cus_test123',
        createdAt: new Date(),
        updatedAt: new Date()
    };

    const testBuyShieldPayment = {
        ...testPayment,
        id: 'test_buyshield_123',
        type: PaymentType.LOCAL,
        metadata: {
            buyerId: 'buyer_123',
            sellerId: 'seller_123'
        }
    };

    beforeAll(async () => {
        // Initialize Stripe mock server
        stripeMock = new StripeMock({
            port: 12111,
            host: 'localhost'
        });
        await stripeMock.start();

        // Initialize services with test configuration
        stripeService = new StripeService(
            'sk_test_123',
            {
                webhookSecret: 'whsec_test123',
                apiVersion: '2023-10-16',
                maxRetryAttempts: 2,
                retryDelayMs: 100
            },
            {
                info: jest.fn(),
                error: jest.fn(),
                warn: jest.fn(),
                child: () => ({
                    info: jest.fn(),
                    error: jest.fn(),
                    warn: jest.fn()
                })
            }
        );

        paymentService = new PaymentService(
            stripeService,
            {
                info: jest.fn(),
                error: jest.fn(),
                warn: jest.fn()
            }
        );
    });

    beforeEach(() => {
        jest.clearAllMocks();
        stripeMock.clearRequests();
    });

    afterAll(async () => {
        await stripeMock.stop();
    });

    describe('Standard Payment Processing', () => {
        it('should successfully create a payment intent', async () => {
            const result = await paymentService.processPayment(testPayment);

            expect(result).toMatchObject({
                success: true,
                paymentId: testPayment.id,
                status: PaymentStatus.PENDING,
                stripeClientSecret: expect.any(String)
            });

            // Verify Stripe API calls
            const stripeRequests = stripeMock.getRequests();
            expect(stripeRequests).toContainEqual(
                expect.objectContaining({
                    method: 'POST',
                    path: '/v1/payment_intents',
                    body: expect.objectContaining({
                        amount: testPayment.amount,
                        currency: testPayment.currency.toLowerCase()
                    })
                })
            );
        });

        it('should successfully capture a payment', async () => {
            const paymentIntentId = 'pi_test123';
            const result = await paymentService.capturePayment(paymentIntentId);

            expect(result).toMatchObject({
                success: true,
                paymentId: expect.any(String),
                status: PaymentStatus.CAPTURED
            });

            // Verify capture request
            const stripeRequests = stripeMock.getRequests();
            expect(stripeRequests).toContainEqual(
                expect.objectContaining({
                    method: 'POST',
                    path: `/v1/payment_intents/${paymentIntentId}/capture`
                })
            );
        });

        it('should process refunds correctly', async () => {
            const paymentIntentId = 'pi_test123';
            const refundAmount = 5000; // $50.00

            const result = await paymentService.refundPayment(paymentIntentId, {
                amount: refundAmount,
                reason: 'requested_by_customer'
            });

            expect(result).toMatchObject({
                success: true,
                paymentId: expect.any(String),
                status: PaymentStatus.REFUNDED
            });

            // Verify refund request
            const stripeRequests = stripeMock.getRequests();
            expect(stripeRequests).toContainEqual(
                expect.objectContaining({
                    method: 'POST',
                    path: '/v1/refunds',
                    body: expect.objectContaining({
                        payment_intent: paymentIntentId,
                        amount: refundAmount
                    })
                })
            );
        });
    });

    describe('BuyShield Protected Payments', () => {
        it('should create protected payment with escrow hold', async () => {
            const result = await paymentService.processPayment(testBuyShieldPayment);

            expect(result).toMatchObject({
                success: true,
                paymentId: testBuyShieldPayment.id,
                status: PaymentStatus.AUTHORIZED,
                escrowId: expect.any(String)
            });

            // Verify escrow payment intent creation
            const stripeRequests = stripeMock.getRequests();
            expect(stripeRequests).toContainEqual(
                expect.objectContaining({
                    method: 'POST',
                    path: '/v1/payment_intents',
                    body: expect.objectContaining({
                        amount: testBuyShieldPayment.amount,
                        capture_method: 'manual',
                        metadata: expect.objectContaining({
                            type: 'escrow'
                        })
                    })
                })
            );
        });

        it('should enforce 72-hour hold period', async () => {
            const result = await paymentService.processPayment(testBuyShieldPayment);
            const escrowId = result.escrowId;

            // Attempt immediate capture (should fail)
            await expect(
                paymentService.capturePayment(escrowId)
            ).rejects.toThrow(/Hold period not expired/);
        });

        it('should verify transaction photo before release', async () => {
            const escrowId = 'pi_escrow_test123';
            const verificationPhoto = 'https://example.com/photo.jpg';

            // Submit verification photo
            const verificationResult = await paymentService.verifyBuyShieldTransaction(
                escrowId,
                { verificationPhoto }
            );

            expect(verificationResult).toMatchObject({
                success: true,
                status: VerificationStatus.SUBMITTED,
                timeRemaining: expect.any(Number)
            });
        });

        it('should handle expired protections correctly', async () => {
            // Create expired protection
            const expiredPayment = {
                ...testBuyShieldPayment,
                createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000) // 73 hours ago
            };

            const result = await paymentService.processPayment(expiredPayment);
            expect(result.status).toBe(PaymentStatus.REFUNDED);
        });
    });

    describe('Security and Error Handling', () => {
        it('should handle network failures with retries', async () => {
            // Simulate network failure
            stripeMock.setNextResponse(500);

            const result = await paymentService.processPayment(testPayment);
            expect(stripeMock.getRequestCount()).toBeGreaterThan(1); // Verify retry attempts
        });

        it('should validate payment data', async () => {
            const invalidPayment = {
                ...testPayment,
                amount: -100 // Invalid amount
            };

            await expect(
                paymentService.processPayment(invalidPayment)
            ).rejects.toThrow(/Invalid payment amount/);
        });

        it('should handle idempotency correctly', async () => {
            // Make two identical requests
            const result1 = await paymentService.processPayment(testPayment);
            const result2 = await paymentService.processPayment(testPayment);

            expect(result1.paymentId).toBe(result2.paymentId);
            expect(stripeMock.getRequestCount()).toBe(1); // Only one request should be made
        });
    });
});