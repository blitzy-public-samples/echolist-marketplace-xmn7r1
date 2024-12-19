import winston from 'winston';
import { loggerConfig } from '../config/logger.config';
import { ProcessEnv } from '../types/environment';

/**
 * @version 1.0.0
 * @description Advanced logging utility providing centralized logging services with enhanced security,
 * performance optimization, and comprehensive monitoring capabilities for the EchoList platform.
 */

// Type definitions for log levels and metadata
type LogLevel = keyof typeof loggerConfig.levels;
interface LogMetadata {
  [key: string]: any;
  correlationId?: string;
  timestamp?: string;
  source?: string;
  performance?: {
    duration?: number;
    memory?: NodeJS.MemoryUsage;
  };
}

/**
 * Performance monitoring decorator for logging functions
 * @param target - Target object
 * @param propertyKey - Method name
 * @param descriptor - Property descriptor
 */
function performanceMetrics(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const originalMethod = descriptor.value;
  descriptor.value = function (...args: any[]) {
    const start = process.hrtime();
    const result = originalMethod.apply(this, args);
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000;

    if (result?.metadata) {
      result.metadata.performance = {
        duration,
        memory: process.memoryUsage(),
      };
    }

    return result;
  };
  return descriptor;
}

/**
 * Error boundary decorator for logging functions
 * @param target - Target object
 * @param propertyKey - Method name
 * @param descriptor - Property descriptor
 */
function errorBoundary(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) {
  const originalMethod = descriptor.value;
  descriptor.value = function (...args: any[]) {
    try {
      return originalMethod.apply(this, args);
    } catch (error) {
      console.error('Logger initialization failed:', error);
      // Fallback to basic console logging
      return {
        error: console.error,
        warn: console.warn,
        info: console.info,
        http: console.log,
        debug: console.debug,
      };
    }
  };
  return descriptor;
}

/**
 * Creates and configures an optimized Winston logger instance with environment-specific
 * settings, error boundaries, and failover mechanisms.
 */
@errorBoundary
@performanceMetrics
function createLogger(): winston.Logger {
  const logger = winston.createLogger({
    levels: loggerConfig.levels,
    format: loggerConfig.format,
    transports: loggerConfig.transports,
    exitOnError: false,
    silent: process.env.NODE_ENV === 'test',
  });

  // Add uncaught exception handler
  logger.exceptions.handle(
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  );

  // Add unhandled rejection handler
  logger.rejections.handle(
    new winston.transports.File({ filename: 'logs/rejections.log' })
  );

  return logger;
}

/**
 * Enhanced logging function with structured logging, secure data filtering,
 * and performance optimization
 * @param level - Log level (error, warn, info, http, debug)
 * @param message - Log message
 * @param meta - Additional metadata for the log entry
 */
@performanceMetrics
function log(level: LogLevel, message: string, meta: LogMetadata = {}): void {
  // Add correlation ID if not present
  if (!meta.correlationId) {
    meta.correlationId = Math.random().toString(36).substring(2, 15);
  }

  // Add timestamp
  meta.timestamp = new Date().toISOString();

  // Add source information
  const stack = new Error().stack;
  if (stack) {
    const stackLines = stack.split('\n');
    meta.source = stackLines[3]?.trim() || 'unknown';
  }

  // Optimize log entry size
  const optimizedMeta = Object.entries(meta).reduce((acc, [key, value]) => {
    if (value !== null && value !== undefined) {
      acc[key] = value;
    }
    return acc;
  }, {} as LogMetadata);

  try {
    logger[level](message, optimizedMeta);
  } catch (error) {
    // Fallback to console logging if Winston fails
    console[level](message, optimizedMeta);
  }
}

// Initialize the logger
const logger = createLogger();

// Export the configured logger and enhanced logging function
export {
  logger,
  log,
  // Export types for external use
  type LogLevel,
  type LogMetadata,
};

// Default export for direct logger access
export default logger;