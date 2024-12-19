import amqplib from 'amqplib'; // ^0.10.0
import { queueConfig } from '../../config/queue.config';
import { logger } from '../../utils/logger.util';

/**
 * @class RabbitMQService
 * @description Singleton service class that manages RabbitMQ message queue connections and operations
 * with enhanced reliability features, connection pooling, and comprehensive monitoring.
 * @version 1.0.0
 */
export class RabbitMQService {
  private static instance: RabbitMQService;
  private connection: amqplib.Connection | null = null;
  private channel: amqplib.Channel | null = null;
  private channelPool: Map<string, amqplib.Channel> = new Map();
  private isInitialized: boolean = false;
  private reconnectAttempts: number = 0;
  private heartbeatInterval: NodeJS.Timer | null = null;
  
  private metrics = {
    publishedMessages: 0,
    consumedMessages: 0,
    failedPublishes: 0,
    reconnections: 0,
    lastHeartbeat: Date.now()
  };

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    process.on('SIGTERM', async () => {
      await this.gracefulShutdown();
    });
  }

  /**
   * Gets the singleton instance of RabbitMQService
   * @returns {RabbitMQService} Singleton instance
   */
  public static getInstance(): RabbitMQService {
    if (!RabbitMQService.instance) {
      RabbitMQService.instance = new RabbitMQService();
    }
    return RabbitMQService.instance;
  }

  /**
   * Initializes RabbitMQ connection with enhanced error handling and monitoring
   * @returns {Promise<void>}
   */
  public async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        logger.warn('RabbitMQ service is already initialized');
        return;
      }

      // Create connection with SSL/TLS options
      this.connection = await amqplib.connect(queueConfig.url, {
        ...queueConfig.options.connection,
        heartbeat: queueConfig.options.connection.heartbeat
      });

      // Set up connection event handlers
      this.connection.on('error', this.handleConnectionError.bind(this));
      this.connection.on('close', this.handleConnectionClose.bind(this));

      // Create main channel
      this.channel = await this.connection.createChannel();
      await this.channel.prefetch(
        queueConfig.options.channel.prefetch,
        queueConfig.options.channel.globalPrefetch
      );

      // Assert exchanges
      await this.assertExchanges();

      // Assert queues
      await this.assertQueues();

      // Initialize channel pool
      await this.initializeChannelPool();

      // Start heartbeat monitoring
      this.startHeartbeatMonitoring();

      this.isInitialized = true;
      logger.info('RabbitMQ service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RabbitMQ service', { error });
      throw error;
    }
  }

  /**
   * Publishes a message to specified exchange with enhanced reliability
   * @param {string} exchange - Exchange name
   * @param {string} routingKey - Routing key
   * @param {Buffer} content - Message content
   * @param {amqplib.Options.Publish} options - Publish options
   * @returns {Promise<boolean>} Success status
   */
  public async publishMessage(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: amqplib.Options.Publish = {}
  ): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        throw new Error('RabbitMQ service not initialized');
      }

      const channel = await this.getPublishChannel(exchange);
      
      const publishResult = await new Promise<boolean>((resolve) => {
        const published = channel.publish(
          exchange,
          routingKey,
          content,
          {
            persistent: true,
            ...options,
            timestamp: Date.now(),
            messageId: Math.random().toString(36).substring(2, 15)
          }
        );
        resolve(published);
      });

      if (publishResult) {
        this.metrics.publishedMessages++;
        logger.debug('Message published successfully', { exchange, routingKey });
      } else {
        this.metrics.failedPublishes++;
        logger.warn('Failed to publish message', { exchange, routingKey });
      }

      return publishResult;
    } catch (error) {
      this.metrics.failedPublishes++;
      logger.error('Error publishing message', { error, exchange, routingKey });
      throw error;
    }
  }

  /**
   * Sets up message consumer with comprehensive error handling
   * @param {string} queue - Queue name
   * @param {Function} callback - Message handler callback
   * @param {amqplib.Options.Consume} options - Consumer options
   */
  public async consumeMessage(
    queue: string,
    callback: (msg: amqplib.ConsumeMessage | null) => Promise<void>,
    options: amqplib.Options.Consume = {}
  ): Promise<void> {
    try {
      if (!this.isInitialized) {
        throw new Error('RabbitMQ service not initialized');
      }

      const channel = await this.getConsumeChannel(queue);
      
      await channel.consume(
        queue,
        async (msg) => {
          try {
            if (msg) {
              await callback(msg);
              channel.ack(msg);
              this.metrics.consumedMessages++;
            }
          } catch (error) {
            logger.error('Error processing message', { error, queue });
            if (msg) {
              const retryCount = (parseInt(msg.properties.headers?.retryCount) || 0) + 1;
              if (retryCount <= queueConfig.options.retry.maxAttempts) {
                channel.nack(msg, false, true);
              } else {
                channel.reject(msg, false);
              }
            }
          }
        },
        {
          noAck: false,
          ...options
        }
      );

      logger.info('Consumer set up successfully', { queue });
    } catch (error) {
      logger.error('Error setting up consumer', { error, queue });
      throw error;
    }
  }

  /**
   * Gracefully closes RabbitMQ connection with cleanup
   */
  public async closeConnection(): Promise<void> {
    try {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      // Close all channels in the pool
      for (const [, channel] of this.channelPool) {
        await channel.close();
      }
      this.channelPool.clear();

      // Close main channel and connection
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.isInitialized = false;
      logger.info('RabbitMQ connection closed successfully');
    } catch (error) {
      logger.error('Error closing RabbitMQ connection', { error });
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async assertExchanges(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    for (const exchange of Object.values(queueConfig.exchanges)) {
      await this.channel.assertExchange(
        exchange.name,
        exchange.type,
        exchange.options
      );
      
      // Assert dead letter exchange if specified
      if (exchange.options.alternateExchange) {
        await this.channel.assertExchange(
          exchange.options.alternateExchange,
          'direct',
          { durable: true }
        );
      }
    }
  }

  private async assertQueues(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    for (const queue of Object.values(queueConfig.queues)) {
      await this.channel.assertQueue(queue.name, queue.options);
      
      for (const binding of queue.bindings) {
        await this.channel.bindQueue(
          queue.name,
          binding.exchange,
          binding.routingKey,
          binding.arguments
        );
      }
    }
  }

  private async initializeChannelPool(): Promise<void> {
    if (!this.connection) throw new Error('Connection not initialized');

    // Create dedicated channels for each exchange
    for (const exchange of Object.values(queueConfig.exchanges)) {
      const channel = await this.connection.createChannel();
      await channel.prefetch(queueConfig.options.channel.prefetch);
      this.channelPool.set(exchange.name, channel);
    }
  }

  private async getPublishChannel(exchange: string): Promise<amqplib.Channel> {
    const channel = this.channelPool.get(exchange) || this.channel;
    if (!channel) throw new Error('No available channel');
    return channel;
  }

  private async getConsumeChannel(queue: string): Promise<amqplib.Channel> {
    if (!this.connection) throw new Error('Connection not initialized');
    const channel = await this.connection.createChannel();
    await channel.prefetch(queueConfig.options.channel.prefetch);
    return channel;
  }

  private async handleConnectionError(error: any): Promise<void> {
    logger.error('RabbitMQ connection error', { error });
    await this.attemptReconnection();
  }

  private async handleConnectionClose(): Promise<void> {
    logger.warn('RabbitMQ connection closed');
    await this.attemptReconnection();
  }

  private async attemptReconnection(): Promise<void> {
    if (this.reconnectAttempts < queueConfig.options.retry.maxAttempts) {
      this.reconnectAttempts++;
      this.metrics.reconnections++;
      
      const delay = Math.min(
        queueConfig.options.retry.initialDelay * Math.pow(
          queueConfig.options.retry.backoffMultiplier,
          this.reconnectAttempts - 1
        ),
        queueConfig.options.retry.maxDelay
      );

      logger.info(`Attempting reconnection in ${delay}ms`, {
        attempt: this.reconnectAttempts
      });

      setTimeout(async () => {
        try {
          await this.initialize();
          this.reconnectAttempts = 0;
        } catch (error) {
          logger.error('Reconnection attempt failed', { error });
        }
      }, delay);
    } else {
      logger.error('Max reconnection attempts reached');
    }
  }

  private startHeartbeatMonitoring(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.connection?.heartbeat) {
        this.metrics.lastHeartbeat = Date.now();
        logger.debug('RabbitMQ heartbeat', this.metrics);
      }
    }, queueConfig.options.connection.heartbeat * 1000);
  }

  private async gracefulShutdown(): Promise<void> {
    logger.info('Initiating graceful shutdown of RabbitMQ service');
    await this.closeConnection();
    process.exit(0);
  }
}

export default RabbitMQService.getInstance();