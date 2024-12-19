/**
 * @fileoverview Stripe payment processing service implementation for EchoList platform.
 * Handles payment intents, escrow payments, refunds and customer management with
 * comprehensive error handling and logging.
 * @version 1.0.0
 */

import { injectable } from 'inversify';
import Stripe from 'stripe'; // v8.0.0
import { Logger } from 'winston'; // v3.0.0
import { IPayment, PaymentStatus } from '../../interfaces/payment.interface';

/**
 * Error types for Stripe operations
 */
enum StripeErrorType {
  VALIDATION = 'VALIDATION',
  API = 'API',
  AUTHENTICATION = 'AUTHENTICATION',
  RATE_LIMIT = 'RATE_LIMIT',
  IDEMPOTENCY = 'IDEMPOTENCY',
}

/**
 * Configuration interface for Stripe service
 */
interface StripeServiceConfig {
  webhookSecret: string;
  apiVersion: string;
  maxRetryAttempts: number;
  retryDelayMs: number;
}

/**
 * @class StripeService
 * @description Service class handling all Stripe payment processing operations
 * with comprehensive error handling and logging
 */
@injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly logger: Logger;
  private readonly ESCROW_HOLD_DURATION_HOURS = 72;
  private readonly MAX_RETRY_ATTEMPTS: number;
  private readonly RETRY_DELAY_MS: number;

  private readonly errorMessages = {
    [StripeErrorType.VALIDATION]: 'Invalid payment data provided',
    [StripeErrorType.API]: 'Stripe API error occurred',
    [StripeErrorType.AUTHENTICATION]: 'Invalid API key or authentication error',
    [StripeErrorType.RATE_LIMIT]: 'Rate limit exceeded',
    [StripeErrorType.IDEMPOTENCY]: 'Idempotency key conflict',
  };

  /**
   * Creates an instance of StripeService
   * @param {string} apiKey - Stripe secret API key
   * @param {StripeServiceConfig} config - Service configuration
   */
  constructor(
    apiKey: string,
    private readonly config: StripeServiceConfig,
    logger: Logger
  ) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Valid Stripe API key is required');
    }

    this.stripe = new Stripe(apiKey, {
      apiVersion: config.apiVersion || '2023-10-16',
      typescript: true,
    });

    this.logger = logger.child({ service: 'StripeService' });
    this.MAX_RETRY_ATTEMPTS = config.maxRetryAttempts || 3;
    this.RETRY_DELAY_MS = config.retryDelayMs || 1000;
  }

  /**
   * Creates a new payment intent for standard transactions
   * @param {IPayment} paymentData - Payment details
   * @param {Object} options - Additional options
   * @returns {Promise<{ clientSecret: string, paymentIntentId: string }>}
   */
  public async createPaymentIntent(
    paymentData: IPayment,
    options: { idempotencyKey?: string } = {}
  ): Promise<{ clientSecret: string; paymentIntentId: string }> {
    try {
      this.validatePaymentData(paymentData);

      const paymentIntent = await this.retryOperation(() =>
        this.stripe.paymentIntents.create(
          {
            amount: paymentData.amount,
            currency: paymentData.currency.toLowerCase(),
            metadata: {
              transactionId: paymentData.transactionId,
              type: 'standard',
            },
            capture_method: 'automatic',
          },
          {
            idempotencyKey: options.idempotencyKey,
          }
        )
      );

      this.logger.info('Payment intent created', {
        paymentIntentId: paymentIntent.id,
        amount: paymentData.amount,
        currency: paymentData.currency,
      });

      return {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      this.handleStripeError(error as Stripe.StripeError, 'createPaymentIntent');
      throw error;
    }
  }

  /**
   * Creates a payment intent with hold for BuyShield escrow transactions
   * @param {IPayment} paymentData - Payment details
   * @param {Object} escrowOptions - Escrow-specific options
   * @returns {Promise<{ clientSecret: string, paymentIntentId: string, holdExpiresAt: Date }>}
   */
  public async createEscrowPayment(
    paymentData: IPayment,
    escrowOptions: { buyShieldId: string }
  ): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    holdExpiresAt: Date;
  }> {
    try {
      this.validatePaymentData(paymentData);

      const holdExpiresAt = new Date();
      holdExpiresAt.setHours(
        holdExpiresAt.getHours() + this.ESCROW_HOLD_DURATION_HOURS
      );

      const paymentIntent = await this.retryOperation(() =>
        this.stripe.paymentIntents.create({
          amount: paymentData.amount,
          currency: paymentData.currency.toLowerCase(),
          capture_method: 'manual',
          metadata: {
            transactionId: paymentData.transactionId,
            buyShieldId: escrowOptions.buyShieldId,
            type: 'escrow',
            holdExpiresAt: holdExpiresAt.toISOString(),
          },
        })
      );

      this.logger.info('Escrow payment intent created', {
        paymentIntentId: paymentIntent.id,
        buyShieldId: escrowOptions.buyShieldId,
        holdExpiresAt,
      });

      return {
        clientSecret: paymentIntent.client_secret!,
        paymentIntentId: paymentIntent.id,
        holdExpiresAt,
      };
    } catch (error) {
      this.handleStripeError(error as Stripe.StripeError, 'createEscrowPayment');
      throw error;
    }
  }

  /**
   * Captures a previously authorized payment
   * @param {string} paymentIntentId - ID of the payment intent to capture
   * @param {Object} captureOptions - Capture options
   * @returns {Promise<{ success: boolean, transactionId: string }>}
   */
  public async capturePayment(
    paymentIntentId: string,
    captureOptions: { amount?: number } = {}
  ): Promise<{ success: boolean; transactionId: string }> {
    try {
      const paymentIntent = await this.retryOperation(() =>
        this.stripe.paymentIntents.capture(paymentIntentId, {
          amount_to_capture: captureOptions.amount,
        })
      );

      this.logger.info('Payment captured successfully', {
        paymentIntentId,
        amount: captureOptions.amount || paymentIntent.amount,
      });

      return {
        success: true,
        transactionId: paymentIntent.metadata.transactionId,
      };
    } catch (error) {
      this.handleStripeError(error as Stripe.StripeError, 'capturePayment');
      throw error;
    }
  }

  /**
   * Process refund for a payment
   * @param {string} paymentIntentId - ID of the payment to refund
   * @param {Object} refundOptions - Refund options
   * @returns {Promise<{ refundId: string, status: string }>}
   */
  public async createRefund(
    paymentIntentId: string,
    refundOptions: { amount?: number; reason?: string } = {}
  ): Promise<{ refundId: string; status: string }> {
    try {
      const refund = await this.retryOperation(() =>
        this.stripe.refunds.create({
          payment_intent: paymentIntentId,
          amount: refundOptions.amount,
          reason: refundOptions.reason as Stripe.RefundCreateParams.Reason,
        })
      );

      this.logger.info('Refund processed', {
        paymentIntentId,
        refundId: refund.id,
        amount: refundOptions.amount,
      });

      return {
        refundId: refund.id,
        status: refund.status,
      };
    } catch (error) {
      this.handleStripeError(error as Stripe.StripeError, 'createRefund');
      throw error;
    }
  }

  /**
   * Creates or updates Stripe customer record
   * @param {Object} customerData - Customer information
   * @param {Object} options - Additional options
   * @returns {Promise<{ customerId: string, created: boolean }>}
   */
  public async createCustomer(
    customerData: {
      email: string;
      name?: string;
      metadata?: Record<string, string>;
    },
    options: { idempotencyKey?: string } = {}
  ): Promise<{ customerId: string; created: boolean }> {
    try {
      const customer = await this.retryOperation(() =>
        this.stripe.customers.create(
          {
            email: customerData.email,
            name: customerData.name,
            metadata: customerData.metadata,
          },
          {
            idempotencyKey: options.idempotencyKey,
          }
        )
      );

      this.logger.info('Customer created', {
        customerId: customer.id,
        email: customerData.email,
      });

      return {
        customerId: customer.id,
        created: true,
      };
    } catch (error) {
      this.handleStripeError(error as Stripe.StripeError, 'createCustomer');
      throw error;
    }
  }

  /**
   * Validates payment data completeness
   * @private
   * @param {IPayment} paymentData - Payment data to validate
   */
  private validatePaymentData(paymentData: IPayment): void {
    if (!paymentData.amount || paymentData.amount <= 0) {
      throw new Error('Invalid payment amount');
    }
    if (!paymentData.currency || paymentData.currency.length !== 3) {
      throw new Error('Invalid currency code');
    }
    if (!paymentData.transactionId) {
      throw new Error('Transaction ID is required');
    }
  }

  /**
   * Handles Stripe API errors with proper logging and classification
   * @private
   * @param {Stripe.StripeError} error - Stripe error object
   * @param {string} operation - Operation that caused the error
   */
  private handleStripeError(error: Stripe.StripeError, operation: string): void {
    const errorType = this.classifyStripeError(error);
    const errorMessage = this.errorMessages[errorType];

    this.logger.error(`Stripe ${operation} error`, {
      type: errorType,
      message: errorMessage,
      code: error.code,
      decline_code: (error as any).decline_code,
      stripeMessage: error.message,
    });
  }

  /**
   * Classifies Stripe errors into internal error types
   * @private
   * @param {Stripe.StripeError} error - Stripe error object
   * @returns {StripeErrorType}
   */
  private classifyStripeError(error: Stripe.StripeError): StripeErrorType {
    if (error.type === 'StripeCardError') {
      return StripeErrorType.VALIDATION;
    }
    if (error.type === 'StripeAuthenticationError') {
      return StripeErrorType.AUTHENTICATION;
    }
    if (error.type === 'StripeRateLimitError') {
      return StripeErrorType.RATE_LIMIT;
    }
    if (error.type === 'StripeIdempotencyError') {
      return StripeErrorType.IDEMPOTENCY;
    }
    return StripeErrorType.API;
  }

  /**
   * Retries an operation with exponential backoff
   * @private
   * @param {Function} operation - Operation to retry
   * @returns {Promise<T>}
   */
  private async retryOperation<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (!this.isRetryableError(error as Stripe.StripeError)) {
          throw error;
        }
        if (attempt < this.MAX_RETRY_ATTEMPTS) {
          await this.delay(this.RETRY_DELAY_MS * attempt);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Checks if an error is retryable
   * @private
   * @param {Stripe.StripeError} error - Stripe error object
   * @returns {boolean}
   */
  private isRetryableError(error: Stripe.StripeError): boolean {
    return (
      error.type === 'StripeConnectionError' ||
      error.type === 'StripeRateLimitError' ||
      error.code === 'lock_timeout'
    );
  }

  /**
   * Delay helper for retry mechanism
   * @private
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}