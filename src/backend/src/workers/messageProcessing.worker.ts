import { MessagingAIService } from '../services/ai/messagingAI.service';
import { RabbitMQService } from '../services/queue/rabbitmq.service';
import { IMessage } from '../interfaces/message.interface';
import { logger } from '../utils/logger.util';
import CloudWatch from 'aws-sdk/clients/cloudwatch'; // ^2.1.0

/**
 * @class MessageProcessingWorker
 * @description Background worker that processes messages using AI capabilities for sentiment analysis,
 * fraud detection, and automated response generation. Implements comprehensive error handling,
 * performance monitoring, and graceful shutdown mechanisms.
 * @version 1.0.0
 */
export class MessageProcessingWorker {
    private static instance: MessageProcessingWorker;
    private readonly aiService: MessagingAIService;
    private readonly queueService: RabbitMQService;
    private readonly cloudWatch: CloudWatch;
    private readonly processingTimeout: number = 30000; // 30 seconds
    private isShuttingDown: boolean = false;

    private readonly metrics = {
        processedMessages: 0,
        failedMessages: 0,
        averageProcessingTime: 0,
        totalProcessingTime: 0,
        lastProcessedTimestamp: Date.now()
    };

    /**
     * Private constructor implementing singleton pattern
     */
    private constructor() {
        this.aiService = MessagingAIService.getInstance();
        this.queueService = RabbitMQService.getInstance();
        this.cloudWatch = new CloudWatch({
            region: process.env.AWS_REGION,
            apiVersion: '2010-08-01'
        });

        // Register shutdown handlers
        process.on('SIGTERM', this.gracefulShutdown.bind(this));
        process.on('SIGINT', this.gracefulShutdown.bind(this));
    }

    /**
     * Gets singleton instance of MessageProcessingWorker
     */
    public static getInstance(): MessageProcessingWorker {
        if (!MessageProcessingWorker.instance) {
            MessageProcessingWorker.instance = new MessageProcessingWorker();
        }
        return MessageProcessingWorker.instance;
    }

    /**
     * Starts the message processing worker with monitoring and error handling
     */
    public async start(): Promise<void> {
        try {
            logger.info('Starting message processing worker');

            // Initialize RabbitMQ connection
            await this.queueService.initialize();

            // Set up message consumer
            await this.queueService.consumeMessage(
                'message_processing_queue',
                this.processMessage.bind(this),
                {
                    noAck: false,
                    prefetch: 10
                }
            );

            // Start metrics reporting
            this.startMetricsReporting();

            logger.info('Message processing worker started successfully');
        } catch (error) {
            logger.error('Failed to start message processing worker', { error });
            throw error;
        }
    }

    /**
     * Processes a single message using AI service with error handling and monitoring
     */
    private async processMessage(message: IMessage): Promise<void> {
        const startTime = Date.now();
        const messageId = message.id;

        try {
            logger.debug('Processing message', { messageId });

            // Process message with timeout
            const aiMetadata = await Promise.race([
                this.aiService.processMessage(message),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Processing timeout')), this.processingTimeout)
                )
            ]);

            // Update message with AI metadata
            message.aiMetadata = aiMetadata;
            message.aiProcessed = true;

            // Update metrics
            this.updateMetrics(startTime);

            logger.info('Message processed successfully', {
                messageId,
                processingTime: Date.now() - startTime,
                sentiment: aiMetadata.sentiment,
                fraudScore: aiMetadata.fraudScore
            });

        } catch (error) {
            await this.handleError(error, message);
        }
    }

    /**
     * Handles errors during message processing with retry logic
     */
    private async handleError(error: Error, message: IMessage): Promise<void> {
        this.metrics.failedMessages++;

        logger.error('Error processing message', {
            error,
            messageId: message.id,
            retryCount: message.processingErrors?.length || 0
        });

        // Update CloudWatch metrics
        await this.publishErrorMetrics(message.id);

        // Add error to message processing history
        if (!message.processingErrors) {
            message.processingErrors = [];
        }
        message.processingErrors.push({
            timestamp: new Date(),
            error: error.message,
            stack: error.stack
        });
    }

    /**
     * Updates processing metrics and publishes to CloudWatch
     */
    private updateMetrics(startTime: number): void {
        const processingTime = Date.now() - startTime;
        this.metrics.processedMessages++;
        this.metrics.totalProcessingTime += processingTime;
        this.metrics.averageProcessingTime = 
            this.metrics.totalProcessingTime / this.metrics.processedMessages;
        this.metrics.lastProcessedTimestamp = Date.now();
    }

    /**
     * Starts periodic metrics reporting to CloudWatch
     */
    private startMetricsReporting(): void {
        setInterval(async () => {
            try {
                await this.cloudWatch.putMetricData({
                    Namespace: 'EchoList/MessageProcessing',
                    MetricData: [
                        {
                            MetricName: 'ProcessedMessages',
                            Value: this.metrics.processedMessages,
                            Unit: 'Count'
                        },
                        {
                            MetricName: 'FailedMessages',
                            Value: this.metrics.failedMessages,
                            Unit: 'Count'
                        },
                        {
                            MetricName: 'AverageProcessingTime',
                            Value: this.metrics.averageProcessingTime,
                            Unit: 'Milliseconds'
                        }
                    ]
                }).promise();
            } catch (error) {
                logger.error('Failed to publish CloudWatch metrics', { error });
            }
        }, 60000); // Report every minute
    }

    /**
     * Publishes error metrics to CloudWatch
     */
    private async publishErrorMetrics(messageId: string): Promise<void> {
        try {
            await this.cloudWatch.putMetricData({
                Namespace: 'EchoList/MessageProcessing',
                MetricData: [
                    {
                        MetricName: 'ProcessingErrors',
                        Value: 1,
                        Unit: 'Count',
                        Dimensions: [
                            {
                                Name: 'MessageId',
                                Value: messageId
                            }
                        ]
                    }
                ]
            }).promise();
        } catch (error) {
            logger.error('Failed to publish error metrics', { error });
        }
    }

    /**
     * Implements graceful shutdown with cleanup
     */
    public async gracefulShutdown(): Promise<void> {
        if (this.isShuttingDown) return;

        this.isShuttingDown = true;
        logger.info('Initiating graceful shutdown of message processing worker');

        try {
            // Stop consuming new messages
            await this.queueService.closeConnection();

            // Publish final metrics
            await this.cloudWatch.putMetricData({
                Namespace: 'EchoList/MessageProcessing',
                MetricData: [
                    {
                        MetricName: 'WorkerShutdown',
                        Value: 1,
                        Unit: 'Count'
                    }
                ]
            }).promise();

            logger.info('Message processing worker shutdown complete', {
                processedMessages: this.metrics.processedMessages,
                failedMessages: this.metrics.failedMessages
            });

            process.exit(0);
        } catch (error) {
            logger.error('Error during worker shutdown', { error });
            process.exit(1);
        }
    }
}

export default MessageProcessingWorker.getInstance();