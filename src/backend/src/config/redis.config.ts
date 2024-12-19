/**
 * Redis Configuration for Amazon ElastiCache
 * @module config/redis
 * @description Production-grade Redis configuration implementing secure connection handling,
 * robust retry policies, and optimized performance settings for EchoList's caching layer
 * @version 1.0.0
 */

import { RedisOptions } from 'ioredis';
import { TlsOptions } from 'tls';
import { ProcessEnv } from '../types/environment';

/**
 * Comprehensive interface for Redis configuration including security and cluster settings
 */
interface RedisConfigOptions extends RedisOptions {
  url: string;
  retryAttempts: number;
  retryDelay: number;
  keyPrefix: string;
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
  enableOfflineQueue: boolean;
  connectTimeout: number;
  disconnectTimeout: number;
  keepAlive: number;
  noDelay: boolean;
  autoResubscribe: boolean;
  maxLoadingRetryTime: number;
  enableTls: boolean;
  tls?: TlsOptions;
  enableClusterMode: boolean;
  clusterRetryStrategy: number;
  maxRedirections: number;
}

/**
 * Environment-specific Redis configuration factory
 * @returns {RedisConfigOptions} Configuration object for Redis client
 */
const getRedisConfig = (): RedisConfigOptions => {
  const isProduction = process.env.NODE_ENV === 'production';
  const enableTls = process.env.REDIS_SSL_ENABLED === 'true' || isProduction;

  // Base configuration for all environments
  const baseConfig: RedisConfigOptions = {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    retryAttempts: 10,
    retryDelay: 3000,
    keyPrefix: `echolist:${process.env.NODE_ENV}:`,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    connectTimeout: 10000,
    disconnectTimeout: 5000,
    keepAlive: 30000,
    noDelay: true,
    autoResubscribe: true,
    maxLoadingRetryTime: 5000,
    enableTls,
    enableClusterMode: isProduction,
    clusterRetryStrategy: 3000,
    maxRedirections: 16,
    
    // Connection monitoring and events
    lazyConnect: true,
    reconnectOnError: (err: Error) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    },
    
    // Performance optimizations
    commandTimeout: 5000,
    enableAutoPipelining: true,
    maxScriptsCaching: 100,
    
    // Security settings
    password: process.env.REDIS_AUTH_TOKEN,
    showFriendlyErrorStack: !isProduction,
  };

  // Production-specific configurations
  if (isProduction) {
    baseConfig.tls = {
      // TLS/SSL Configuration for AWS ElastiCache
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      sessionTimeout: 3600,
      ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384',
      secureProtocol: 'TLSv1_2_method'
    };

    // Cluster mode settings for production
    baseConfig.clusterRetryStrategy = (times: number) => {
      const delay = Math.min(times * 500, 5000);
      return delay;
    };

    // Production performance tuning
    baseConfig.connectTimeout = 20000;
    baseConfig.maxRetriesPerRequest = 5;
    baseConfig.retryAttempts = 20;
  }

  return baseConfig;
};

/**
 * Exported Redis configuration object
 * @constant
 * @type {RedisConfigOptions}
 */
export const redisConfig: RedisConfigOptions = getRedisConfig();

/**
 * Redis error codes and their descriptions
 * @constant
 * @type {Record<string, string>}
 */
export const REDIS_ERROR_CODES = {
  ECONNREFUSED: 'Redis server connection refused',
  ECONNRESET: 'Redis connection reset by peer',
  ETIMEDOUT: 'Redis connection timed out',
  ENOTFOUND: 'Redis host not found',
  EAUTH: 'Redis authentication failed',
} as const;

/**
 * Redis operation timeouts in milliseconds
 * @constant
 * @type {Record<string, number>}
 */
export const REDIS_TIMEOUTS = {
  CONNECT: 10000,
  COMMAND: 5000,
  DISCONNECT: 5000,
  KEEPALIVE: 30000,
} as const;

/**
 * Redis retry strategies
 * @constant
 * @type {Record<string, number>}
 */
export const REDIS_RETRY = {
  MAX_ATTEMPTS: 10,
  INITIAL_DELAY: 3000,
  MAX_DELAY: 30000,
  FACTOR: 1.5,
} as const;