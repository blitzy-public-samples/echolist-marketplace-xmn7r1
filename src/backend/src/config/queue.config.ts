import { Options } from 'amqplib';
import { ProcessEnv } from '../types/environment';

/**
 * RabbitMQ Queue Configuration
 * Defines comprehensive message queue settings for the EchoList platform
 * @version 1.0.0
 */

/**
 * Interface for Exchange configuration
 */
interface ExchangeConfig {
  name: string;
  type: 'direct' | 'fanout' | 'topic' | 'headers';
  options: {
    durable: boolean;
    autoDelete: boolean;
    internal: boolean;
    alternateExchange?: string;
  };
}

/**
 * Interface for Queue Binding configuration
 */
interface QueueBinding {
  exchange: string;
  routingKey: string;
  arguments?: Record<string, any>;
}

/**
 * Interface for Queue configuration
 */
interface QueueConfig {
  name: string;
  options: {
    durable: boolean;
    deadLetterExchange?: string;
    deadLetterRoutingKey?: string;
    messageTtl?: number;
    maxLength?: number;
    maxPriority?: number;
  };
  bindings: QueueBinding[];
}

/**
 * Comprehensive RabbitMQ configuration for the EchoList platform
 * Includes settings for exchanges, queues, dead letter exchanges, and connection options
 */
export const queueConfig = {
  // RabbitMQ connection URL from environment variables
  url: process.env.RABBITMQ_URL as string,

  // Exchange definitions for different message types
  exchanges: {
    // Image processing exchange for handling item photos and AI analysis
    image_processing: {
      name: 'image_processing',
      type: 'direct',
      options: {
        durable: true,
        autoDelete: false,
        internal: false,
        alternateExchange: 'dlx.image_processing'
      }
    },
    
    // Marketplace synchronization exchange for listing management
    marketplace_sync: {
      name: 'marketplace_sync',
      type: 'direct',
      options: {
        durable: true,
        autoDelete: false,
        internal: false,
        alternateExchange: 'dlx.marketplace_sync'
      }
    },
    
    // Message processing exchange for AI intervention and filtering
    message_processing: {
      name: 'message_processing',
      type: 'direct',
      options: {
        durable: true,
        autoDelete: false,
        internal: false,
        alternateExchange: 'dlx.message_processing'
      }
    },
    
    // Notifications exchange for system-wide notifications
    notifications: {
      name: 'notifications',
      type: 'fanout',
      options: {
        durable: true,
        autoDelete: false,
        internal: false,
        alternateExchange: 'dlx.notifications'
      }
    }
  },

  // Queue definitions with their bindings and options
  queues: {
    // Image processing queue configuration
    image_processing: {
      name: 'image_processing_queue',
      options: {
        durable: true,
        deadLetterExchange: 'dlx.image_processing',
        deadLetterRoutingKey: 'dead.image',
        messageTtl: 3600000, // 1 hour
        maxLength: 10000,
        maxPriority: 10
      },
      bindings: [
        {
          exchange: 'image_processing',
          routingKey: 'process.image',
          arguments: {
            'x-priority': 5
          }
        }
      ]
    },

    // Marketplace synchronization queue configuration
    marketplace_sync: {
      name: 'marketplace_sync_queue',
      options: {
        durable: true,
        deadLetterExchange: 'dlx.marketplace_sync',
        deadLetterRoutingKey: 'dead.sync',
        messageTtl: 7200000, // 2 hours
        maxLength: 50000,
        maxPriority: 5
      },
      bindings: [
        {
          exchange: 'marketplace_sync',
          routingKey: 'sync.listing',
          arguments: {
            'x-priority': 3
          }
        }
      ]
    },

    // Message processing queue configuration
    message_processing: {
      name: 'message_processing_queue',
      options: {
        durable: true,
        deadLetterExchange: 'dlx.message_processing',
        deadLetterRoutingKey: 'dead.message',
        messageTtl: 1800000, // 30 minutes
        maxLength: 20000,
        maxPriority: 3
      },
      bindings: [
        {
          exchange: 'message_processing',
          routingKey: 'process.message',
          arguments: {
            'x-priority': 2
          }
        }
      ]
    },

    // Notifications queue configuration
    notifications: {
      name: 'notifications_queue',
      options: {
        durable: true,
        deadLetterExchange: 'dlx.notifications',
        deadLetterRoutingKey: 'dead.notification',
        messageTtl: 86400000, // 24 hours
        maxLength: 100000,
        maxPriority: 2
      },
      bindings: [
        {
          exchange: 'notifications',
          routingKey: '',
          arguments: {
            'x-priority': 1
          }
        }
      ]
    }
  },

  // Global RabbitMQ connection and channel options
  options: {
    connection: {
      heartbeat: 60,
      reconnectTimeoutMillis: 5000,
      socketOptions: {
        keepAlive: true,
        tcpNoDelay: true
      },
      ssl: {
        enabled: true,
        verify: true
      },
      timeout: 30000
    },
    channel: {
      prefetch: 10,
      globalPrefetch: false
    },
    retry: {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2
    }
  }
} as const;

// Type assertion to ensure configuration immutability
export type QueueConfiguration = typeof queueConfig;