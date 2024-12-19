import { Request, Response, NextFunction } from 'express';
import { HttpError } from 'http-errors';
import {
  formatErrorResponse,
  logError,
  CustomError,
  ErrorCode,
  ErrorCategory
} from '../../utils/error.util';
import { logger, MetricsTracker } from '../../utils/logger.util';

/**
 * @version 1.0.0
 * @description Enterprise-grade error handling middleware for the EchoList platform.
 * Provides centralized error processing, logging, and response formatting with
 * enhanced security, monitoring, and caching capabilities.
 */

// Cache for frequent errors to optimize performance
const errorCache = new Map<string, { count: number; lastOccurrence: number }>();
const ERROR_CACHE_TTL = parseInt(process.env.ERROR_CACHE_TTL || '300', 10); // 5 minutes default

/**
 * Generates a unique error correlation ID
 */
const generateCorrelationId = (): string => {
  return `err_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Checks if an error is occurring frequently
 * @param errorKey - Unique identifier for the error
 * @returns boolean indicating if error is frequent
 */
const isFrequentError = (errorKey: string): boolean => {
  const cached = errorCache.get(errorKey);
  if (!cached) return false;

  const now = Date.now();
  if (now - cached.lastOccurrence > ERROR_CACHE_TTL * 1000) {
    errorCache.delete(errorKey);
    return false;
  }

  return cached.count >= 5; // Consider frequent if occurs 5+ times within TTL
};

/**
 * Updates error occurrence cache
 * @param errorKey - Unique identifier for the error
 */
const updateErrorCache = (errorKey: string): void => {
  const now = Date.now();
  const cached = errorCache.get(errorKey);

  if (cached) {
    cached.count += 1;
    cached.lastOccurrence = now;
  } else {
    errorCache.set(errorKey, { count: 1, lastOccurrence: now });
  }
};

/**
 * Main error handling middleware
 * Processes errors and sends formatted responses with enhanced security and monitoring
 */
export const errorHandler = (
  error: Error | CustomError | HttpError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Start performance tracking
  const startTime = process.hrtime();
  
  // Generate correlation ID for error tracking
  const correlationId = generateCorrelationId();

  // Determine error type and extract details
  let statusCode = 500;
  let errorCode = 9003; // Default to INTERNAL_SERVER_ERROR
  let errorCategory = 'SYSTEM';

  if ('status' in error) {
    statusCode = (error as HttpError).status;
  }
  if ('code' in error) {
    errorCode = (error as CustomError).code;
    // Determine category based on error code range
    if (errorCode >= 1000 && errorCode <= 1999) errorCategory = 'AUTH';
    else if (errorCode >= 2000 && errorCode <= 2999) errorCategory = 'TRANSACTION';
    else if (errorCode >= 3000 && errorCode <= 3999) errorCategory = 'MARKETPLACE';
    else if (errorCode >= 4000 && errorCode <= 4999) errorCategory = 'SHIPPING';
    else if (errorCode >= 5000 && errorCode <= 5999) errorCategory = 'AI_SERVICE';
  }

  // Create error context for logging
  const errorContext = {
    correlationId,
    requestId: req.headers['x-request-id'] as string,
    userId: req.headers['x-user-id'] as string,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };

  // Check for frequent errors
  const errorKey = `${errorCode}_${req.path}`;
  const isFrequent = isFrequentError(errorKey);
  updateErrorCache(errorKey);

  // Log error with appropriate context
  logError(error, {
    ...errorContext,
    isFrequent,
    category: errorCategory,
  });

  // Track error metrics
  const [seconds, nanoseconds] = process.hrtime(startTime);
  const duration = seconds * 1000 + nanoseconds / 1000000;

  // Format error response based on environment
  const formattedError = formatErrorResponse(error, {
    includeStack: process.env.NODE_ENV === 'development',
    includeMeta: process.env.NODE_ENV !== 'production',
    sanitize: process.env.NODE_ENV === 'production',
    cache: !isFrequent,
  });

  // Add correlation ID to response headers
  res.setHeader('X-Error-ID', correlationId);

  // Send response
  res.status(statusCode).json({
    ...formattedError,
    correlationId,
    timestamp: new Date().toISOString(),
  });
};

/**
 * 404 Not Found handler middleware
 * Handles undefined routes with enhanced logging
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const correlationId = generateCorrelationId();

  // Log 404 occurrence
  logger.warn('Route not found', {
    correlationId,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Create not found error
  const notFoundError = new CustomError(
    404,
    `Route ${req.path} not found`,
    {
      method: req.method,
      path: req.path,
    }
  );

  // Pass to main error handler
  next(notFoundError);
};