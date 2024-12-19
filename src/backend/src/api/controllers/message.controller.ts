import { Request, Response, NextFunction } from 'express'; // ^4.18.0
import { IMessage, MessageType, MessageStatus } from '../../interfaces/message.interface';
import { SocketService } from '../../services/messaging/socket.service';
import { MessagingAIService } from '../../services/ai/messagingAI.service';
import { logger } from '../../utils/logger.util';
import { RabbitMQService } from '../../services/queue/rabbitmq.service';
import { Metrics } from 'prom-client'; // ^14.0.0
import { CircuitBreaker } from 'opossum'; // ^6.0.0

/**
 * @class MessageController
 * @description Controller handling message-related HTTP endpoints and WebSocket events
 * with AI-powered processing, real-time delivery, and comprehensive monitoring.
 * @version 1.0.0
 */
export class MessageController {
    private readonly socketService: SocketService;
    private readonly aiService: MessagingAIService;
    private readonly queueService: RabbitMQService;
    private readonly metrics: Metrics;
    private readonly messageBreaker: CircuitBreaker;

    constructor() {
        this.socketService = SocketService.getInstance();
        this.aiService = MessagingAIService.getInstance();
        this.queueService = RabbitMQService.getInstance();
        this.initializeMetrics();
        this.initializeCircuitBreaker();
    }

    /**
     * Initializes Prometheus metrics for monitoring message operations
     */
    private initializeMetrics(): void {
        this.metrics = new Metrics();
        
        // Message processing metrics
        this.metrics.counter({
            name: 'messages_processed_total',
            help: 'Total number of messages processed'
        });

        this.metrics.histogram({
            name: 'message_processing_duration',
            help: 'Message processing duration in milliseconds'
        });

        this.metrics.gauge({
            name: 'active_conversations',
            help: 'Number of active conversations'
        });
    }

    /**
     * Initializes circuit breaker for message processing
     */
    private initializeCircuitBreaker(): void {
        this.messageBreaker = new CircuitBreaker(
            async (message: IMessage) => {
                return await this.aiService.processMessage(message);
            },
            {
                timeout: 5000,
                errorThresholdPercentage: 50,
                resetTimeout: 30000
            }
        );

        this.messageBreaker.on('open', () => {
            logger.warn('Message processing circuit breaker opened');
        });
    }

    /**
     * Sends a new message with AI processing and real-time delivery
     * @param req Express request object
     * @param res Express response object
     */
    public async sendMessage(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<Response> {
        const startTime = Date.now();
        try {
            const { content, receiverId, listingId, type } = req.body;
            const senderId = req.user.id;

            // Validate request
            if (!content || !receiverId) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            // Create message object
            const message: IMessage = {
                id: crypto.randomUUID(),
                senderId,
                receiverId,
                listingId,
                content,
                type: type || MessageType.TEXT,
                status: MessageStatus.SENT,
                aiProcessed: false,
                aiMetadata: null,
                attachments: [],
                transactionId: null,
                offerAmount: null,
                systemMetadata: {},
                createdAt: new Date(),
                updatedAt: new Date(),
                deliveredAt: null,
                readAt: null
            };

            // Process message with AI service through circuit breaker
            const aiMetadata = await this.messageBreaker.fire(message);
            message.aiProcessed = true;
            message.aiMetadata = aiMetadata;

            // Check for fraud or content violations
            if (aiMetadata.fraudScore > 0.8) {
                return res.status(403).json({
                    success: false,
                    message: 'Message blocked due to suspicious content'
                });
            }

            // Publish message to queue for processing
            await this.queueService.publishMessage(
                'message_processing',
                'process.message',
                Buffer.from(JSON.stringify(message))
            );

            // Emit real-time message through WebSocket
            await this.socketService.emitEvent(
                receiverId,
                'message.new',
                message
            );

            // Update metrics
            this.metrics.counter('messages_processed_total').inc();
            this.metrics.histogram('message_processing_duration')
                .observe(Date.now() - startTime);

            // Log successful message delivery
            logger.info('Message processed and delivered', {
                messageId: message.id,
                processingTime: Date.now() - startTime,
                aiMetadata: {
                    fraudScore: aiMetadata.fraudScore,
                    sentiment: aiMetadata.sentiment
                }
            });

            return res.status(201).json({
                success: true,
                data: message
            });

        } catch (error) {
            logger.error('Error processing message', { error });
            return res.status(500).json({
                success: false,
                message: 'Failed to process message'
            });
        }
    }

    /**
     * Retrieves messages for a conversation with pagination
     * @param req Express request object
     * @param res Express response object
     */
    public async getMessages(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<Response> {
        try {
            const { conversationId } = req.params;
            const { page = 1, limit = 50 } = req.query;
            const userId = req.user.id;

            // Validate conversation access
            if (!await this.validateConversationAccess(userId, conversationId)) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this conversation'
                });
            }

            // Retrieve messages with pagination
            const messages = await this.retrieveMessages(
                conversationId,
                Number(page),
                Number(limit)
            );

            // Update read status for unread messages
            await this.updateReadStatus(messages, userId);

            // Broadcast read status to other participants
            await this.broadcastReadStatus(messages, userId);

            return res.status(200).json({
                success: true,
                data: messages
            });

        } catch (error) {
            logger.error('Error retrieving messages', { error });
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve messages'
            });
        }
    }

    /**
     * Helper method to validate conversation access
     */
    private async validateConversationAccess(
        userId: string,
        conversationId: string
    ): Promise<boolean> {
        // Implementation would check if user is a participant in the conversation
        return true; // Placeholder
    }

    /**
     * Helper method to retrieve messages with pagination
     */
    private async retrieveMessages(
        conversationId: string,
        page: number,
        limit: number
    ): Promise<IMessage[]> {
        // Implementation would fetch messages from database
        return []; // Placeholder
    }

    /**
     * Helper method to update read status for messages
     */
    private async updateReadStatus(
        messages: IMessage[],
        userId: string
    ): Promise<void> {
        // Implementation would update read status in database
    }

    /**
     * Helper method to broadcast read status to other participants
     */
    private async broadcastReadStatus(
        messages: IMessage[],
        userId: string
    ): Promise<void> {
        // Implementation would broadcast read status via WebSocket
    }
}

export default new MessageController();