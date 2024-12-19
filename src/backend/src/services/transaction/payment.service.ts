/**
 * @fileoverview Payment service implementation for the EchoList platform
 * Handles secure payment processing for both marketplace and BuyShield protected transactions
 * @version 1.0.0
 */

import { injectable } from 'inversify';
import { Logger } from 'winston'; // v3.0.0
import CircuitBreaker from 'opossum'; // v6.0.0

import { 
    IPayment, 
    PaymentStatus, 
    PaymentType,
    IPaymentResult 
} from '../../interfaces/payment.interface';
import { StripeService } from '../external/stripe.service';
import { EscrowService } from '../buyshield/escrow.service';
import { TRANSACTION_STATUS } from '../../constants/status.constants';

/**
 * Configuration for the payment circuit breaker
 */
const PAYMENT_CIRCUIT_BREAKER_CONFIG = {
    timeout: 10000,           // 10 seconds
    resetTimeout: 30000,      // 30 seconds
    errorThresholdPercentage: 50,
    volumeThreshold: 5
};

/**
 * @class PaymentService
 * @description Handles all payment processing operations with comprehensive security measures
 */
@injectable()
export class PaymentService {
    private readonly paymentBreaker: CircuitBreaker;
    private readonly maxRetries = 3;
    private readonly retryDelay = 1000; // milliseconds

    constructor(
        private readonly stripeService: StripeService,
        private readonly escrowService: EscrowService,
        private readonly logger: Logger
    ) {
        // Initialize circuit breaker for payment operations
        this.paymentBreaker = new CircuitBreaker(
            async (operation: () => Promise<any>) => operation(),
            PAYMENT_CIRCUIT_BREAKER_CONFIG
        );

        this.setupCircuitBreakerEvents();
    }

    /**
     * Processes a new payment with comprehensive validation and error handling
     * @param {IPayment} paymentData - Payment details
     * @returns {Promise<IPaymentResult>} Payment processing result
     */
    public async processPayment(paymentData: IPayment): Promise<IPaymentResult> {
        const correlationId = `payment_${paymentData.id}`;

        try {
            this.logger.info('Initiating payment processing', {
                correlationId,
                paymentId: paymentData.id,
                type: paymentData.type
            });

            // Determine payment processing strategy based on type
            if (paymentData.type === PaymentType.LOCAL) {
                return this.processBuyShieldPayment(paymentData);
            }

            // Process standard marketplace payment
            const result = await this.paymentBreaker.fire(async () => {
                const { clientSecret, paymentIntentId } = await this.stripeService.createPaymentIntent(
                    paymentData,
                    { idempotencyKey: correlationId }
                );

                return {
                    success: true,
                    paymentId: paymentData.id,
                    status: PaymentStatus.PENDING,
                    message: 'Payment intent created successfully',
                    stripeClientSecret: clientSecret,
                    paymentIntentId
                };
            });

            this.logger.info('Payment processed successfully', {
                correlationId,
                paymentId: paymentData.id,
                status: result.status
            });

            return result;
        } catch (error) {
            this.logger.error('Payment processing failed', {
                correlationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                paymentId: paymentData.id
            });
            throw error;
        }
    }

    /**
     * Processes a BuyShield protected payment with escrow
     * @param {IPayment} paymentData - Payment details
     * @returns {Promise<IPaymentResult>} BuyShield payment result
     */
    private async processBuyShieldPayment(paymentData: IPayment): Promise<IPaymentResult> {
        const correlationId = `buyshield_${paymentData.id}`;

        try {
            this.logger.info('Initiating BuyShield payment', {
                correlationId,
                paymentId: paymentData.id
            });

            // Create escrow hold through circuit breaker
            const escrowId = await this.paymentBreaker.fire(async () => {
                return this.escrowService.createEscrowHold({
                    id: paymentData.id,
                    transactionId: paymentData.transactionId,
                    amount: paymentData.amount,
                    buyerId: paymentData.metadata.buyerId,
                    sellerId: paymentData.metadata.sellerId,
                    status: 'ACTIVE',
                    verificationStatus: 'PENDING',
                    verificationPhoto: '',
                    escrowId: '',
                    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            });

            return {
                success: true,
                paymentId: paymentData.id,
                status: PaymentStatus.AUTHORIZED,
                message: 'BuyShield protection activated',
                escrowId
            };
        } catch (error) {
            this.logger.error('BuyShield payment processing failed', {
                correlationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                paymentId: paymentData.id
            });
            throw error;
        }
    }

    /**
     * Captures an authorized payment
     * @param {string} paymentId - Payment ID to capture
     * @param {Object} captureDetails - Capture details
     * @returns {Promise<IPaymentResult>} Capture result
     */
    public async capturePayment(
        paymentId: string,
        captureDetails: { amount?: number } = {}
    ): Promise<IPaymentResult> {
        const correlationId = `capture_${paymentId}`;

        try {
            this.logger.info('Initiating payment capture', {
                correlationId,
                paymentId
            });

            const result = await this.retryOperation(async () => {
                const captureResult = await this.stripeService.capturePayment(
                    paymentId,
                    captureDetails
                );

                return {
                    success: captureResult.success,
                    paymentId,
                    status: PaymentStatus.CAPTURED,
                    message: 'Payment captured successfully',
                    transactionId: captureResult.transactionId
                };
            });

            this.logger.info('Payment captured successfully', {
                correlationId,
                paymentId,
                status: result.status
            });

            return result;
        } catch (error) {
            this.logger.error('Payment capture failed', {
                correlationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                paymentId
            });
            throw error;
        }
    }

    /**
     * Processes a refund with validation
     * @param {string} paymentId - Payment ID to refund
     * @param {Object} refundDetails - Refund details
     * @returns {Promise<IPaymentResult>} Refund result
     */
    public async refundPayment(
        paymentId: string,
        refundDetails: { amount?: number; reason?: string } = {}
    ): Promise<IPaymentResult> {
        const correlationId = `refund_${paymentId}`;

        try {
            this.logger.info('Initiating payment refund', {
                correlationId,
                paymentId,
                amount: refundDetails.amount
            });

            const result = await this.retryOperation(async () => {
                const refundResult = await this.stripeService.createRefund(
                    paymentId,
                    refundDetails
                );

                return {
                    success: true,
                    paymentId,
                    status: PaymentStatus.REFUNDED,
                    message: 'Payment refunded successfully',
                    refundId: refundResult.refundId
                };
            });

            this.logger.info('Payment refunded successfully', {
                correlationId,
                paymentId,
                refundId: result.refundId
            });

            return result;
        } catch (error) {
            this.logger.error('Payment refund failed', {
                correlationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                paymentId
            });
            throw error;
        }
    }

    /**
     * Sets up circuit breaker event handlers
     * @private
     */
    private setupCircuitBreakerEvents(): void {
        this.paymentBreaker.on('open', () => {
            this.logger.warn('Payment circuit breaker opened');
        });

        this.paymentBreaker.on('halfOpen', () => {
            this.logger.info('Payment circuit breaker attempting to recover');
        });

        this.paymentBreaker.on('close', () => {
            this.logger.info('Payment circuit breaker closed');
        });
    }

    /**
     * Retries an operation with exponential backoff
     * @private
     * @param {Function} operation - Operation to retry
     * @returns {Promise<T>} Operation result
     */
    private async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.retryDelay * attempt)
                    );
                    continue;
                }
                throw error;
            }
        }
        
        throw lastError;
    }
}