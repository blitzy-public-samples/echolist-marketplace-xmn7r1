import { RabbitMQService } from '../services/queue/rabbitmq.service';
import { logger } from '../utils/logger.util';
import AWS from 'aws-sdk'; // ^2.1.0
import { Server as SocketServer } from 'socket.io'; // ^4.5.0
import * as admin from 'firebase-admin'; // ^11.0.0
import { CircuitBreaker } from 'circuit-breaker-ts'; // ^1.0.0
import { RateLimiterMemory } from 'rate-limiter-flexible'; // ^2.3.0

/**
 * Notification message types
 */
interface NotificationMessage {
  type: 'push' | 'email' | 'socket';
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  priority?: number;
  ttl?: number;
}

/**
 * @class NotificationSenderWorker
 * @description Worker service that handles asynchronous notification sending through various channels
 * with enhanced error handling, rate limiting, and circuit breaker patterns.
 * @version 1.0.0
 */
export class NotificationSenderWorker {
  private readonly queueService: RabbitMQService;
  private readonly sesClient: AWS.SES;
  private readonly fcmClient: admin.messaging.Messaging;
  private readonly socketServer: SocketServer;
  private readonly retryCount: Map<string, number> = new Map();
  private readonly maxRetries: number = 3;

  // Circuit breakers for external services
  private readonly circuitBreakers = {
    email: new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 60000,
    }),
    push: new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 30000,
    }),
  };

  // Rate limiters for different channels
  private readonly rateLimiters = {
    email: new RateLimiterMemory({
      points: 100,
      duration: 60,
    }),
    push: new RateLimiterMemory({
      points: 1000,
      duration: 60,
    }),
    socket: new RateLimiterMemory({
      points: 2000,
      duration: 60,
    }),
  };

  constructor() {
    this.queueService = RabbitMQService.getInstance();
    
    // Initialize AWS SES client
    this.sesClient = new AWS.SES({
      region: process.env.AWS_REGION,
      apiVersion: '2010-12-01',
    });

    // Initialize Firebase Admin
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
    this.fcmClient = admin.messaging();

    // Initialize Socket.io server
    this.socketServer = new SocketServer({
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });
  }

  /**
   * Starts the notification worker service
   */
  public async start(): Promise<void> {
    try {
      logger.info('Starting NotificationSenderWorker...');

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      // Start socket server
      this.socketServer.listen(parseInt(process.env.SOCKET_PORT || '3001'));

      // Initialize queue consumer
      await this.queueService.consumeMessage(
        'notifications_queue',
        this.processNotification.bind(this),
        {
          noAck: false,
        }
      );

      logger.info('NotificationSenderWorker started successfully');
    } catch (error) {
      logger.error('Failed to start NotificationSenderWorker', { error });
      throw error;
    }
  }

  /**
   * Processes incoming notification messages
   */
  private async processNotification(message: any): Promise<void> {
    try {
      const notification: NotificationMessage = JSON.parse(message.content.toString());
      const messageId = message.properties.messageId;

      logger.debug('Processing notification', { messageId, notification });

      // Check retry count
      const retries = this.retryCount.get(messageId) || 0;
      if (retries >= this.maxRetries) {
        logger.warn('Max retries reached for notification', { messageId });
        return;
      }

      // Route to appropriate sender based on notification type
      switch (notification.type) {
        case 'push':
          await this.sendPushNotification(notification);
          break;
        case 'email':
          await this.sendEmailNotification(notification);
          break;
        case 'socket':
          await this.sendSocketNotification(notification);
          break;
        default:
          throw new Error(`Unknown notification type: ${notification.type}`);
      }

      logger.info('Notification processed successfully', { messageId });
    } catch (error) {
      logger.error('Error processing notification', { error });
      this.handleNotificationError(message);
    }
  }

  /**
   * Sends push notifications via Firebase Cloud Messaging
   */
  private async sendPushNotification(notification: NotificationMessage): Promise<void> {
    await this.rateLimiters.push.consume(notification.userId);

    await this.circuitBreakers.push.execute(async () => {
      const message: admin.messaging.Message = {
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data,
        android: {
          priority: notification.priority === 1 ? 'high' : 'normal',
          ttl: notification.ttl || 3600 * 1000,
        },
        token: notification.userId,
      };

      await this.fcmClient.send(message);
    });
  }

  /**
   * Sends email notifications via AWS SES
   */
  private async sendEmailNotification(notification: NotificationMessage): Promise<void> {
    await this.rateLimiters.email.consume(notification.userId);

    await this.circuitBreakers.email.execute(async () => {
      const params = {
        Destination: {
          ToAddresses: [notification.userId],
        },
        Message: {
          Body: {
            Html: {
              Data: notification.body,
            },
          },
          Subject: {
            Data: notification.title,
          },
        },
        Source: process.env.SES_FROM_EMAIL,
      };

      await this.sesClient.sendEmail(params).promise();
    });
  }

  /**
   * Sends real-time notifications via Socket.io
   */
  private async sendSocketNotification(notification: NotificationMessage): Promise<void> {
    await this.rateLimiters.socket.consume(notification.userId);

    this.socketServer.to(notification.userId).emit('notification', {
      title: notification.title,
      body: notification.body,
      data: notification.data,
      timestamp: Date.now(),
    });
  }

  /**
   * Handles notification processing errors
   */
  private handleNotificationError(message: any): void {
    const messageId = message.properties.messageId;
    const currentRetries = this.retryCount.get(messageId) || 0;
    this.retryCount.set(messageId, currentRetries + 1);

    if (currentRetries < this.maxRetries) {
      // Requeue the message
      this.queueService.publishMessage(
        'notifications',
        '',
        message.content,
        {
          headers: {
            'x-retry-count': currentRetries + 1,
          },
        }
      );
    } else {
      // Move to dead letter queue
      this.queueService.publishMessage(
        'dlx.notifications',
        'dead.notification',
        message.content,
        {
          headers: {
            'x-death-reason': 'max-retries-exceeded',
          },
        }
      );
    }
  }

  /**
   * Sets up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      logger.info('Shutting down NotificationSenderWorker...');
      
      // Close socket server
      this.socketServer.close();
      
      // Close queue connection
      await this.queueService.closeConnection();
      
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

export default new NotificationSenderWorker();