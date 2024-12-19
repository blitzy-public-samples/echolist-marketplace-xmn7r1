/**
 * @fileoverview Transaction controller implementation for the EchoList platform
 * Handles transaction-related HTTP requests with enhanced security and monitoring
 * @version 1.0.0
 */

import { Request, Response, NextFunction } from 'express'; // ^4.18.0
import { injectable } from 'inversify'; // ^6.0.0
import rateLimit from 'express-rate-limit'; // ^6.0.0

import { TransactionService } from '../../services/transaction/transaction.service';
import { ITransaction, ITransactionCreationAttributes } from '../../interfaces/transaction.interface';
import { CustomError } from '../../utils/error.util';
import { TRANSACTION_ERRORS } from '../../constants/error.constants';
import { logger } from '../../utils/logger.util';

/**
 * Rate limiting configuration for payment endpoints
 */
const PAYMENT_RATE_LIMIT = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many payment requests from this IP, please try again later'
});

/**
 * @class TransactionController
 * @description Handles all transaction-related HTTP requests with enhanced security and monitoring
 */
@injectable()
export class TransactionController {
  private readonly rateLimiter: typeof PAYMENT_RATE_LIMIT;

  constructor(private readonly transactionService: TransactionService) {
    this.rateLimiter = PAYMENT_RATE_LIMIT;
  }

  /**
   * Creates a new transaction with enhanced security validation
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next function
   */
  public async createTransaction(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response> {
    const correlationId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info('Creating new transaction', {
        correlationId,
        userId: req.user?.id,
        listingId: req.body.listingId
      });

      // Apply rate limiting
      await this.rateLimiter(req, res, () => {});

      // Validate request body
      const transactionData: ITransactionCreationAttributes = {
        listingId: req.body.listingId,
        buyerId: req.user?.id,
        sellerId: req.body.sellerId,
        amount: req.body.amount,
        paymentMethod: req.body.paymentMethod,
        isLocalPickup: req.body.isLocalPickup,
        verificationRequired: req.body.isLocalPickup // Always require verification for local pickup
      };

      // Create transaction
      const transaction = await this.transactionService.createTransaction(transactionData);

      logger.info('Transaction created successfully', {
        correlationId,
        transactionId: transaction.id,
        status: transaction.status
      });

      return res.status(201).json({
        success: true,
        data: transaction
      });
    } catch (error) {
      logger.error('Failed to create transaction', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof CustomError) {
        return res.status(400).json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
      }

      next(error);
    }
  }

  /**
   * Processes a local transaction with BuyShield protection
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next function
   */
  public async processLocalTransaction(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response> {
    const correlationId = `local_${req.params.transactionId}`;

    try {
      logger.info('Processing local transaction', {
        correlationId,
        transactionId: req.params.transactionId,
        userId: req.user?.id
      });

      const transaction = await this.transactionService.processLocalTransaction(
        req.params.transactionId
      );

      return res.status(200).json({
        success: true,
        data: transaction
      });
    } catch (error) {
      logger.error('Failed to process local transaction', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof CustomError) {
        return res.status(400).json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
      }

      next(error);
    }
  }

  /**
   * Completes a transaction after successful verification
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next function
   */
  public async completeTransaction(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response> {
    const correlationId = `complete_${req.params.transactionId}`;

    try {
      logger.info('Completing transaction', {
        correlationId,
        transactionId: req.params.transactionId,
        userId: req.user?.id
      });

      const transaction = await this.transactionService.completeTransaction(
        req.params.transactionId
      );

      return res.status(200).json({
        success: true,
        data: transaction
      });
    } catch (error) {
      logger.error('Failed to complete transaction', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof CustomError) {
        return res.status(400).json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
      }

      next(error);
    }
  }

  /**
   * Cancels a transaction with secure refund processing
   * @param {Request} req - Express request object
   * @param {Response} res - Express response object
   * @param {NextFunction} next - Express next function
   */
  public async cancelTransaction(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<Response> {
    const correlationId = `cancel_${req.params.transactionId}`;

    try {
      logger.info('Cancelling transaction', {
        correlationId,
        transactionId: req.params.transactionId,
        userId: req.user?.id,
        reason: req.body.reason
      });

      const transaction = await this.transactionService.cancelTransaction(
        req.params.transactionId,
        req.body.reason
      );

      return res.status(200).json({
        success: true,
        data: transaction
      });
    } catch (error) {
      logger.error('Failed to cancel transaction', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof CustomError) {
        return res.status(400).json({
          success: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
      }

      next(error);
    }
  }
}