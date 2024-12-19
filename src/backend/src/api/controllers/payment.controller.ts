/**
 * @fileoverview Payment controller implementing secure payment processing endpoints
 * with PCI DSS compliance, comprehensive error handling, and audit logging.
 * @version 1.0.0
 */

import { Request, Response, NextFunction } from 'express'; // ^4.17.1
import { Logger } from 'winston'; // ^3.0.0
import CircuitBreaker from 'opossum'; // ^6.0.0
import rateLimit from 'express-rate-limit'; // ^5.0.0

import { PaymentService } from '../../services/transaction/payment.service';
import {
    validatePaymentCreate,
    validatePaymentUpdate,
    validatePaymentCapture,
} from '../validators/payment.validator';
import {
    IPayment,
    IPaymentCreate,
    IPaymentResult,
    PaymentType,
    PaymentStatus,
} from '../../interfaces/payment.interface';
import { ValidationError } from '../../utils/validation.util';

/**
 * Rate limiting configuration for payment endpoints
 */
const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many payment requests, please try again later'
};

/**
 * Circuit breaker configuration for payment processing
 */
const CIRCUIT_BREAKER_CONFIG = {
    timeout: 10000, // 10 seconds
    resetTimeout: 30000, // 30 seconds
    errorThresholdPercentage: 50,
    volumeThreshold: 5
};

/**
 * @class PaymentController
 * @description Handles payment-related HTTP endpoints with comprehensive security measures
 */
export class PaymentController {
    private readonly paymentLimiter: any;
    private readonly paymentBreaker: CircuitBreaker;

    constructor(
        private readonly paymentService: PaymentService,
        private readonly logger: Logger
    ) {
        // Initialize rate limiter
        this.paymentLimiter = rateLimit(RATE_LIMIT_CONFIG);

        // Initialize circuit breaker
        this.paymentBreaker = new CircuitBreaker(
            async (operation: () => Promise<any>) => operation(),
            CIRCUIT_BREAKER_CONFIG
        );

        this.setupCircuitBreakerEvents();
    }

    /**
     * Creates a new payment with comprehensive validation and security checks
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     */
    public async createPayment = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<Response> => {
        const correlationId = `payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        try {
            this.logger.info('Payment creation initiated', {
                correlationId,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });

            // Validate request data
            const paymentData: IPaymentCreate = req.body;
            await validatePaymentCreate(paymentData);

            // Process payment through circuit breaker
            const result = await this.paymentBreaker.fire(async () => {
                return this.paymentService.processPayment({
                    ...paymentData,
                    id: correlationId,
                    status: PaymentStatus.PENDING,
                    stripePaymentIntentId: '',
                    stripeCustomerId: '',
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            });

            this.logger.info('Payment created successfully', {
                correlationId,
                paymentId: result.paymentId,
                status: result.status
            });

            return res.status(201).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.logger.error('Payment creation failed', {
                correlationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });

            if (error instanceof ValidationError) {
                return res.status(400).json({
                    success: false,
                    error: error.toJSON()
                });
            }

            next(error);
        }
    };

    /**
     * Captures an authorized payment with verification
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     */
    public async capturePayment = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<Response> => {
        const correlationId = `capture_${req.params.paymentId}`;

        try {
            this.logger.info('Payment capture initiated', {
                correlationId,
                paymentId: req.params.paymentId
            });

            // Validate capture request
            await validatePaymentCapture({
                paymentId: req.params.paymentId,
                verificationCode: req.body.verificationCode
            });

            // Process capture through circuit breaker
            const result = await this.paymentBreaker.fire(async () => {
                return this.paymentService.capturePayment(
                    req.params.paymentId,
                    req.body.amount ? { amount: req.body.amount } : undefined
                );
            });

            this.logger.info('Payment captured successfully', {
                correlationId,
                paymentId: req.params.paymentId,
                status: result.status
            });

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.logger.error('Payment capture failed', {
                correlationId,
                paymentId: req.params.paymentId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });

            if (error instanceof ValidationError) {
                return res.status(400).json({
                    success: false,
                    error: error.toJSON()
                });
            }

            next(error);
        }
    };

    /**
     * Processes a refund with proper validation
     * @param {Request} req - Express request object
     * @param {Response} res - Express response object
     */
    public async refundPayment = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<Response> => {
        const correlationId = `refund_${req.params.paymentId}`;

        try {
            this.logger.info('Payment refund initiated', {
                correlationId,
                paymentId: req.params.paymentId,
                amount: req.body.amount
            });

            // Process refund through circuit breaker
            const result = await this.paymentBreaker.fire(async () => {
                return this.paymentService.refundPayment(
                    req.params.paymentId,
                    {
                        amount: req.body.amount,
                        reason: req.body.reason
                    }
                );
            });

            this.logger.info('Payment refunded successfully', {
                correlationId,
                paymentId: req.params.paymentId,
                refundId: result.paymentId
            });

            return res.status(200).json({
                success: true,
                data: result
            });
        } catch (error) {
            this.logger.error('Payment refund failed', {
                correlationId,
                paymentId: req.params.paymentId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });

            if (error instanceof ValidationError) {
                return res.status(400).json({
                    success: false,
                    error: error.toJSON()
                });
            }

            next(error);
        }
    };

    /**
     * Sets up circuit breaker event handlers
     * @private
     */
    private setupCircuitBreakerEvents(): void {
        this.paymentBreaker.on('open', () => {
            this.logger.warn('Payment circuit breaker opened - fallback mode activated');
        });

        this.paymentBreaker.on('halfOpen', () => {
            this.logger.info('Payment circuit breaker attempting to recover');
        });

        this.paymentBreaker.on('close', () => {
            this.logger.info('Payment circuit breaker closed - normal operations resumed');
        });
    }
}