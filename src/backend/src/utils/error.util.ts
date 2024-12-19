import { logger } from './logger.util';
import {
  AUTH_ERRORS,
  TRANSACTION_ERRORS,
  MARKETPLACE_ERRORS,
  SHIPPING_ERRORS,
  AI_SERVICE_ERRORS,
  SYSTEM_ERRORS,
  ERROR_MESSAGES,
} from '../constants/error.constants';
import createHttpError from 'http-errors';
import { serializeError } from 'serialize-error';

/**
 * @version 1.0.0
 * @description Enhanced error handling utility providing standardized error handling,
 * custom error classes, error formatting, and logging functionality with security,
 * performance monitoring, and environment-specific behavior.
 */

// Cache for frequently occurring errors to optimize performance
const ERROR_CACHE = new Map<number, CustomError>();

// Valid error code ranges
const ERROR_RANGES = {
  AUTH: { min: 1000, max: 1999 },
  TRANSACTION: { min: 2000, max: 2999 },
  MARKETPLACE: { min: 3000, max: 3999 },
  SHIPPING: { min: 4000, max: 4999 },
  AI_SERVICE: { min: 5000, max: 5999 },
  SYSTEM: { min: 9000, max: 9999 },
};

// Interface for error response formatting options
interface ErrorFormatOptions {
  includeStack?: boolean;
  includeMeta?: boolean;
  sanitize?: boolean;
  cache?: boolean;
}

// Interface for error logging context
interface ErrorContext {
  requestId?: string;
  userId?: string;
  source?: string;
  metadata?: Record<string, any>;
}

/**
 * Enhanced custom error class with caching, serialization, and security features
 */
export class CustomError extends Error {
  public readonly code: number;
  public readonly details?: Record<string, any>;
  public readonly timestamp: number;
  public readonly requestId?: string;
  public readonly metadata: Record<string, any>;

  constructor(
    code: number,
    message: string,
    details?: Record<string, any>,
    metadata?: Record<string, any>
  ) {
    super(message);
    
    // Validate error code range
    if (!this.isValidErrorCode(code)) {
      throw new Error(`Invalid error code: ${code}`);
    }

    this.code = code;
    this.details = this.sanitizeDetails(details);
    this.timestamp = Date.now();
    this.metadata = metadata || {};
    
    // Capture stack trace with V8 engine
    Error.captureStackTrace(this, this.constructor);
    
    // Set prototype explicitly for instanceof checks
    Object.setPrototypeOf(this, CustomError.prototype);
  }

  /**
   * Validates if the error code falls within defined ranges
   */
  private isValidErrorCode(code: number): boolean {
    return Object.values(ERROR_RANGES).some(
      range => code >= range.min && code <= range.max
    );
  }

  /**
   * Sanitizes error details to remove sensitive information
   */
  private sanitizeDetails(details?: Record<string, any>): Record<string, any> | undefined {
    if (!details) return undefined;

    const sensitiveFields = ['password', 'token', 'secret', 'key', 'credentials'];
    return Object.entries(details).reduce((acc, [key, value]) => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        acc[key] = '[REDACTED]';
      } else {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, any>);
  }

  /**
   * Converts error to JSON format with environment-specific serialization
   */
  public toJSON(): Record<string, any> {
    const baseError = {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
    };

    // Add environment-specific details
    if (process.env.NODE_ENV === 'development') {
      return {
        ...baseError,
        details: this.details,
        stack: this.stack,
        metadata: this.metadata,
      };
    }

    return baseError;
  }
}

/**
 * Formats error responses based on environment and error type with enhanced security filtering
 */
export function formatErrorResponse(
  error: CustomError | Error,
  options: ErrorFormatOptions = {}
): Record<string, any> {
  const {
    includeStack = process.env.NODE_ENV === 'development',
    includeMeta = process.env.NODE_ENV !== 'production',
    sanitize = true,
    cache = true,
  } = options;

  // Handle non-CustomError instances
  if (!(error instanceof CustomError)) {
    const systemError = new CustomError(
      SYSTEM_ERRORS.INTERNAL_SERVER_ERROR,
      error.message || ERROR_MESSAGES[SYSTEM_ERRORS.INTERNAL_SERVER_ERROR]
    );
    return formatErrorResponse(systemError, options);
  }

  const response: Record<string, any> = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      timestamp: error.timestamp,
    },
  };

  // Add stack trace in development
  if (includeStack && error.stack) {
    response.error.stack = error.stack;
  }

  // Add metadata in non-production environments
  if (includeMeta && Object.keys(error.metadata).length > 0) {
    response.error.metadata = error.metadata;
  }

  // Add error details if available and sanitization is not required
  if (error.details && (!sanitize || process.env.NODE_ENV === 'development')) {
    response.error.details = error.details;
  }

  return response;
}

/**
 * Enhanced error logging with context, performance tracking, and pattern detection
 */
export function logError(
  error: Error | CustomError,
  context: ErrorContext = {},
  options: { silent?: boolean } = {}
): void {
  const { silent = false } = options;
  
  // Serialize error for logging
  const serializedError = serializeError(error);
  
  // Add context and metadata
  const logData = {
    ...context,
    error: serializedError,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    performance: {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    },
  };

  // Log error with appropriate severity
  if (!silent) {
    if (error instanceof CustomError && error.code >= 9000) {
      logger.error('System Error:', logData);
    } else {
      logger.warn('Application Error:', logData);
    }
  }

  // Debug logging in development
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Error Details:', { stack: error.stack });
  }
}

/**
 * Creates a cached or new CustomError instance with validation and security measures
 */
export function createCustomError(
  code: number,
  message?: string,
  details?: Record<string, any>,
  options: { cache?: boolean; metadata?: Record<string, any> } = {}
): CustomError {
  const { cache = true, metadata = {} } = options;

  // Check cache for existing error instance
  const cacheKey = `${code}-${message}`;
  if (cache && ERROR_CACHE.has(cacheKey)) {
    return ERROR_CACHE.get(cacheKey)!;
  }

  // Create new error instance
  const errorMessage = message || ERROR_MESSAGES[code] || 'Unknown error occurred';
  const error = new CustomError(code, errorMessage, details, metadata);

  // Cache error if enabled
  if (cache) {
    ERROR_CACHE.set(cacheKey, error);
  }

  return error;
}