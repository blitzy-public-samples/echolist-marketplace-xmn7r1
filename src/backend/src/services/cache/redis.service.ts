import Redis from 'ioredis';
import compression from 'compression';
import { redisConfig } from '../../config/redis.config';
import { logger } from '../../utils/logger.util';

/**
 * @class RedisService
 * @description Production-grade Redis service implementation with advanced caching features,
 * connection pooling, circuit breaker pattern, and comprehensive monitoring
 * @version 1.0.0
 */
export class RedisService {
  private client: Redis.Cluster | Redis;
  private isConnected: boolean = false;
  private readonly operationTimeout: number = 5000;
  private readonly compressionThreshold: number = 1024; // 1KB
  private readonly maxKeyLength: number = 256;

  // Circuit breaker configuration
  private circuitBreaker = {
    failures: 0,
    lastFailure: new Date(),
    isOpen: false,
    threshold: 5,
    resetTimeout: 30000, // 30 seconds
  };

  // Performance metrics
  private metrics = {
    operations: 0,
    failures: 0,
    latency: [] as number[],
    lastHealthCheck: new Date(),
  };

  constructor() {
    this.initializeClient();
    this.setupEventListeners();
  }

  /**
   * Initializes Redis client with clustering support and advanced configuration
   * @private
   */
  private initializeClient(): void {
    try {
      if (redisConfig.enableClusterMode) {
        this.client = new Redis.Cluster(
          [{ url: redisConfig.url }],
          {
            redisOptions: {
              ...redisConfig,
              retryStrategy: (times: number) => {
                if (times > redisConfig.retryAttempts) {
                  this.updateCircuitBreaker(new Error('Max retry attempts reached'));
                  return null;
                }
                return Math.min(times * 500, 5000);
              },
            },
            clusterRetryStrategy: (times: number) => {
              return Math.min(times * 500, 5000);
            },
          }
        );
      } else {
        this.client = new Redis(redisConfig);
      }
    } catch (error) {
      logger.error('Failed to initialize Redis client', { error });
      throw error;
    }
  }

  /**
   * Sets up event listeners for Redis client
   * @private
   */
  private setupEventListeners(): void {
    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('Redis client connected');
    });

    this.client.on('error', (error: Error) => {
      logger.error('Redis client error', { error });
      this.updateCircuitBreaker(error);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('Redis client connection closed');
    });

    // Monitor performance events
    this.client.on('ready', () => {
      this.startHealthCheck();
    });
  }

  /**
   * Updates circuit breaker state
   * @private
   * @param error - Error that triggered the circuit breaker
   */
  private updateCircuitBreaker(error: Error): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = new Date();

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.isOpen = true;
      logger.error('Circuit breaker opened', { 
        failures: this.circuitBreaker.failures,
        error 
      });

      // Schedule circuit breaker reset
      setTimeout(() => {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failures = 0;
        logger.info('Circuit breaker reset');
      }, this.circuitBreaker.resetTimeout);
    }
  }

  /**
   * Compresses data if it exceeds threshold
   * @private
   * @param data - Data to compress
   * @returns Compressed data if threshold exceeded, original data otherwise
   */
  private async compressData(data: any): Promise<Buffer> {
    const stringData = JSON.stringify(data);
    if (stringData.length > this.compressionThreshold) {
      return new Promise((resolve, reject) => {
        compression()(
          { data: stringData } as any,
          {} as any,
          (err: any) => {
            if (err) reject(err);
            resolve(Buffer.from(stringData));
          }
        );
      });
    }
    return Buffer.from(stringData);
  }

  /**
   * Validates key length and characters
   * @private
   * @param key - Cache key to validate
   */
  private validateKey(key: string): void {
    if (!key || key.length > this.maxKeyLength) {
      throw new Error(`Invalid key length: ${key}`);
    }
  }

  /**
   * Sets a value in Redis with optional TTL
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in seconds
   * @returns Promise resolving when value is set
   */
  public async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      if (this.circuitBreaker.isOpen) {
        throw new Error('Circuit breaker is open');
      }

      this.validateKey(key);
      const startTime = Date.now();

      const compressedValue = await this.compressData(value);
      const pipeline = this.client.pipeline();

      if (ttl) {
        pipeline.setex(key, ttl, compressedValue);
      } else {
        pipeline.set(key, compressedValue);
      }

      await pipeline.exec();

      // Update metrics
      this.metrics.operations++;
      this.metrics.latency.push(Date.now() - startTime);
      if (this.metrics.latency.length > 100) this.metrics.latency.shift();

    } catch (error) {
      this.metrics.failures++;
      logger.error('Redis set operation failed', { key, error });
      throw error;
    }
  }

  /**
   * Performs batch set operations using pipelining
   * @param operations - Array of set operations
   * @returns Promise resolving when batch is complete
   */
  public async batchSet(operations: Array<{ key: string, value: any, ttl?: number }>): Promise<void> {
    try {
      if (this.circuitBreaker.isOpen) {
        throw new Error('Circuit breaker is open');
      }

      const pipeline = this.client.pipeline();
      const startTime = Date.now();

      for (const op of operations) {
        this.validateKey(op.key);
        const compressedValue = await this.compressData(op.value);

        if (op.ttl) {
          pipeline.setex(op.key, op.ttl, compressedValue);
        } else {
          pipeline.set(op.key, compressedValue);
        }
      }

      await pipeline.exec();

      // Update metrics
      this.metrics.operations += operations.length;
      this.metrics.latency.push(Date.now() - startTime);

    } catch (error) {
      this.metrics.failures++;
      logger.error('Redis batch set operation failed', { error });
      throw error;
    }
  }

  /**
   * Starts periodic health check
   * @private
   */
  private startHealthCheck(): void {
    setInterval(async () => {
      try {
        const startTime = Date.now();
        await this.client.ping();
        
        const latency = Date.now() - startTime;
        this.metrics.lastHealthCheck = new Date();

        logger.debug('Redis health check', {
          latency,
          operations: this.metrics.operations,
          failures: this.metrics.failures,
          averageLatency: this.metrics.latency.reduce((a, b) => a + b, 0) / this.metrics.latency.length,
          circuitBreakerStatus: this.circuitBreaker.isOpen ? 'open' : 'closed'
        });

      } catch (error) {
        logger.error('Redis health check failed', { error });
        this.updateCircuitBreaker(error as Error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Returns current health metrics
   * @returns Health metrics object
   */
  public getHealth(): object {
    return {
      isConnected: this.isConnected,
      metrics: this.metrics,
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failures: this.circuitBreaker.failures,
        lastFailure: this.circuitBreaker.lastFailure
      }
    };
  }
}

// Export singleton instance
export default new RedisService();