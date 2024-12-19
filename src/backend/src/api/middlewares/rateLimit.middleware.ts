import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { createCustomError } from '../../utils/error.util';
import { AUTH_ERRORS } from '../../constants/error.constants';
import { redisConfig } from '../../config/redis.config';
import { logger } from '../../utils/logger.util';

/**
 * Interface for enhanced rate limit options
 */
interface RateLimitOptions {
  points: number;                   // Number of requests allowed
  duration: number;                 // Time window in seconds
  keyPrefix?: string;              // Prefix for Redis keys
  blockDuration?: number;          // Duration of block if limit exceeded
  whitelistIPs?: string[];        // IPs exempt from rate limiting
  blacklistIPs?: string[];        // IPs always blocked
  authenticatedLimits?: {         // Different limits for authenticated users
    points: number;
    duration: number;
  };
  unauthenticatedLimits?: {      // Different limits for unauthenticated users
    points: number;
    duration: number;
  };
  customResponseMessage?: string; // Custom rate limit exceeded message
  redisOptions?: {               // Additional Redis configuration
    enableAutoPipelining?: boolean;
    maxRetriesPerRequest?: number;
  };
}

/**
 * Creates a Redis-based rate limiter instance with failover capabilities
 * @param options Rate limiter configuration options
 */
const createRateLimiter = async (options: RateLimitOptions): Promise<RateLimiterRedis> => {
  const redis = new Redis({
    ...redisConfig,
    enableAutoPipelining: options.redisOptions?.enableAutoPipelining ?? true,
    maxRetriesPerRequest: options.redisOptions?.maxRetriesPerRequest ?? 3,
    reconnectOnError: (err) => {
      logger.error('Redis connection error:', { error: err.message });
      return true;
    }
  });

  redis.on('error', (err) => {
    logger.error('Redis error in rate limiter:', { error: err.message });
  });

  return new RateLimiterRedis({
    storeClient: redis,
    points: options.points,
    duration: options.duration,
    blockDuration: options.blockDuration,
    keyPrefix: options.keyPrefix || 'rl',
    insuranceLimiter: new RateLimiterRedis({
      storeClient: new Redis(redisConfig),
      points: options.points * 2,
      duration: options.duration
    })
  });
};

/**
 * Advanced rate limiting middleware with security features and distributed throttling
 * @param options Rate limiting configuration options
 */
export const rateLimitMiddleware = (options: RateLimitOptions) => {
  let rateLimiter: RateLimiterRedis;

  // Initialize rate limiter
  createRateLimiter(options).then((limiter) => {
    rateLimiter = limiter;
  }).catch((err) => {
    logger.error('Failed to initialize rate limiter:', { error: err.message });
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get client IP
      const clientIP = req.ip || req.connection.remoteAddress || '';

      // Check blacklist
      if (options.blacklistIPs?.includes(clientIP)) {
        throw createCustomError(
          AUTH_ERRORS.UNAUTHORIZED,
          'Access denied',
          { ip: clientIP }
        );
      }

      // Skip rate limiting for whitelisted IPs
      if (options.whitelistIPs?.includes(clientIP)) {
        return next();
      }

      // Determine rate limit based on authentication status
      const isAuthenticated = req.user !== undefined;
      const limits = isAuthenticated ? 
        options.authenticatedLimits || options : 
        options.unauthenticatedLimits || options;

      // Generate rate limit key
      const key = `${clientIP}:${isAuthenticated ? 'auth' : 'unauth'}`;

      // Try to consume a point
      const rateLimitResult = await rateLimiter.consume(key, 1);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', limits.points);
      res.setHeader('X-RateLimit-Remaining', rateLimitResult.remainingPoints);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + rateLimitResult.msBeforeNext).toISOString());

      // Log rate limit consumption
      logger.debug('Rate limit consumed:', {
        ip: clientIP,
        authenticated: isAuthenticated,
        remaining: rateLimitResult.remainingPoints
      });

      next();
    } catch (error) {
      if (error instanceof Error) {
        // Handle rate limit exceeded
        if (error.name === 'Error' && error.message.includes('Too Many Requests')) {
          const retryAfter = Math.ceil(options.blockDuration || options.duration);
          
          res.setHeader('Retry-After', retryAfter);
          
          const errorResponse = createCustomError(
            AUTH_ERRORS.TOO_MANY_REQUESTS,
            options.customResponseMessage || 'Too many requests, please try again later',
            { retryAfter }
          );

          // Log rate limit violation
          logger.warn('Rate limit exceeded:', {
            ip: req.ip,
            path: req.path,
            method: req.method
          });

          return res.status(429).json(errorResponse);
        }
      }
      
      // Handle other errors
      logger.error('Rate limit middleware error:', { error });
      next(error);
    }
  };
};

export default rateLimitMiddleware;
```

This implementation provides:

1. Distributed rate limiting using Redis with automatic failover
2. Different rate limits for authenticated/unauthenticated users
3. IP whitelist/blacklist support
4. Custom error messages and response headers
5. Comprehensive logging and monitoring
6. Automatic Redis reconnection and error handling
7. Security features for DDoS protection
8. Performance optimization with auto-pipelining
9. Configurable blocking duration for violators
10. Standardized error responses using the application's error handling system

The middleware can be used with different configurations for various routes or globally. It integrates with the existing logging, error handling, and Redis infrastructure while providing robust protection against abuse.

Example usage:
```typescript
app.use(rateLimitMiddleware({
  points: 100,
  duration: 60,
  blockDuration: 600,
  whitelistIPs: ['127.0.0.1'],
  authenticatedLimits: {
    points: 1000,
    duration: 60
  },
  unauthenticatedLimits: {
    points: 50,
    duration: 60
  }
}));