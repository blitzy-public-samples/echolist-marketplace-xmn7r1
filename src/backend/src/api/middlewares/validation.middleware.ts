import { Request, Response, NextFunction, RequestHandler } from 'express'; // ^4.17.1
import * as Joi from 'joi'; // ^17.6.0
import { v4 as uuidv4 } from 'uuid'; // ^8.3.2

import { 
  ValidationError, 
  validateSchema, 
  ValidationCache 
} from '../../utils/validation.util';
import { 
  CustomError, 
  formatErrorResponse, 
  ErrorLogger 
} from '../../utils/error.util';
import { 
  AUTH_ERRORS, 
  VALIDATION_ERRORS 
} from '../../constants/error.constants';

/**
 * Enhanced type for request validation locations
 */
export type ValidationLocation = 'body' | 'query' | 'params' | 'headers';

/**
 * Extended Express Request type with validated data
 */
export interface ValidatedRequest extends Request {
  validatedData?: any;
  correlationId: string;
  validationMetadata?: {
    timestamp: number;
    duration: number;
    schema: string;
    location: ValidationLocation;
  };
}

/**
 * Configuration options for validation middleware
 */
export interface ValidationOptions {
  useCache?: boolean;
  stripUnknown?: boolean;
  timeoutMs?: number;
  severity?: 'error' | 'warn';
}

// Initialize validation cache
const validationCache = new ValidationCache();

// Default validation options
const DEFAULT_OPTIONS: Required<ValidationOptions> = {
  useCache: true,
  stripUnknown: true,
  timeoutMs: 5000,
  severity: 'error'
};

/**
 * Enhanced Express middleware factory function that validates incoming request data
 * against a Joi schema with caching and performance optimization
 */
export function validateRequest(
  schema: Joi.Schema,
  location: ValidationLocation,
  options: ValidationOptions = {}
): RequestHandler {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  return async (req: ValidatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const startTime = Date.now();
    
    try {
      // Generate correlation ID for request tracking
      req.correlationId = req.headers['x-correlation-id'] as string || uuidv4();

      // Extract data to validate based on location
      const dataToValidate = req[location];
      
      // Generate cache key if caching is enabled
      let cacheKey: string | undefined;
      if (mergedOptions.useCache) {
        cacheKey = `${req.method}-${req.path}-${location}-${JSON.stringify(dataToValidate)}`;
        const cachedResult = validationCache.get(cacheKey);
        if (cachedResult) {
          req.validatedData = cachedResult;
          return next();
        }
      }

      // Validate data with timeout
      const validationPromise = validateSchema(schema, dataToValidate, {
        stripUnknown: mergedOptions.stripUnknown,
        abortEarly: false
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Validation timeout'));
        }, mergedOptions.timeoutMs);
      });

      const validatedData = await Promise.race([validationPromise, timeoutPromise]);

      // Cache successful validation result
      if (mergedOptions.useCache && cacheKey) {
        validationCache.set(cacheKey, validatedData);
      }

      // Attach validated data and metadata to request
      req.validatedData = validatedData;
      req.validationMetadata = {
        timestamp: startTime,
        duration: Date.now() - startTime,
        schema: schema.describe().type,
        location
      };

      next();
    } catch (error) {
      const duration = Date.now() - startTime;

      // Handle validation errors
      if (error instanceof ValidationError) {
        const errorResponse = formatErrorResponse(
          new CustomError(
            AUTH_ERRORS.INVALID_CREDENTIALS,
            'Validation failed',
            {
              errors: error.errors,
              location,
              duration
            }
          )
        );

        // Log validation error with context
        ErrorLogger.log({
          level: mergedOptions.severity,
          message: 'Request validation failed',
          correlationId: req.correlationId,
          metadata: {
            path: req.path,
            method: req.method,
            location,
            duration,
            errors: error.errors
          }
        });

        return res.status(400).json(errorResponse);
      }

      // Handle timeout and other errors
      const errorResponse = formatErrorResponse(
        new CustomError(
          VALIDATION_ERRORS.VALIDATION_FAILED,
          'Validation processing error',
          {
            message: error.message,
            location,
            duration
          }
        )
      );

      ErrorLogger.log({
        level: 'error',
        message: 'Validation processing error',
        correlationId: req.correlationId,
        error,
        metadata: {
          path: req.path,
          method: req.method,
          location,
          duration
        }
      });

      return res.status(500).json(errorResponse);
    }
  };
}

/**
 * Enhanced convenience middleware for validating request body data
 */
export function validateRequestBody(
  schema: Joi.Schema,
  options?: ValidationOptions
): RequestHandler {
  return validateRequest(schema, 'body', options);
}

/**
 * Enhanced convenience middleware for validating request query parameters
 */
export function validateRequestQuery(
  schema: Joi.Schema,
  options?: ValidationOptions
): RequestHandler {
  return validateRequest(schema, 'query', options);
}

/**
 * Enhanced convenience middleware for validating request parameters
 */
export function validateRequestParams(
  schema: Joi.Schema,
  options?: ValidationOptions
): RequestHandler {
  return validateRequest(schema, 'params', options);
}

/**
 * Enhanced convenience middleware for validating request headers
 */
export function validateRequestHeaders(
  schema: Joi.Schema,
  options?: ValidationOptions
): RequestHandler {
  return validateRequest(schema, 'headers', options);
}

export default {
  validateRequest,
  validateRequestBody,
  validateRequestQuery,
  validateRequestParams,
  validateRequestHeaders
};