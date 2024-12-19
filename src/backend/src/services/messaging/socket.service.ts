import { Server, Socket } from 'socket.io'; // ^4.7.0
import { Metrics } from 'prom-client'; // ^14.0.0
import { CircuitBreaker } from 'opossum'; // ^6.0.0
import { socketConfig } from '../../config/socket.config';
import { IMessage, MessageStatus, MessageType } from '../../interfaces/message.interface';
import { MessagingAIService } from '../ai/messagingAI.service';
import { logger } from '../../utils/logger.util';

/**
 * @class SocketService
 * @description Manages WebSocket connections and real-time messaging with comprehensive
 * monitoring, security features, and AI integration for the EchoList platform.
 * @version 1.0.0
 */
export class SocketService {
    private static instance: SocketService;
    private io: Server;
    private connectedUsers: Map<string, Socket>;
    private metrics: Metrics;
    private aiServiceBreaker: CircuitBreaker;
    private readonly messageAIService: MessagingAIService;

    /**
     * Private constructor implementing singleton pattern with enhanced initialization
     */
    private constructor() {
        this.connectedUsers = new Map();
        this.messageAIService = MessagingAIService.getInstance();
        this.initializeServer();
        this.initializeCircuitBreaker();
        this.initializeMetrics();
    }

    /**
     * Returns singleton instance of SocketService
     */
    public static getInstance(): SocketService {
        if (!SocketService.instance) {
            SocketService.instance = new SocketService();
        }
        return SocketService.instance;
    }

    /**
     * Initializes Socket.io server with enhanced security and monitoring
     */
    private initializeServer(): void {
        this.io = new Server({
            cors: socketConfig.cors,
            pingTimeout: socketConfig.pingTimeout,
            transports: socketConfig.transports,
        });

        this.io.use(this.authenticate);
        this.io.on('connection', this.handleConnection.bind(this));

        logger.info('Socket.io server initialized');
    }

    /**
     * Initializes circuit breaker for AI service calls
     */
    private initializeCircuitBreaker(): void {
        this.aiServiceBreaker = new CircuitBreaker(
            async (message: IMessage) => {
                return await this.messageAIService.processMessage(message);
            },
            {
                timeout: 5000,
                errorThresholdPercentage: 50,
                resetTimeout: 30000,
            }
        );

        this.aiServiceBreaker.on('open', () => {
            logger.warn('AI service circuit breaker opened');
        });

        this.aiServiceBreaker.on('halfOpen', () => {
            logger.info('AI service circuit breaker half-opened');
        });

        this.aiServiceBreaker.on('close', () => {
            logger.info('AI service circuit breaker closed');
        });
    }

    /**
     * Initializes Prometheus metrics for monitoring
     */
    private initializeMetrics(): void {
        this.metrics = new Metrics();
        
        // Connection metrics
        this.metrics.gauge({
            name: 'socket_connected_users',
            help: 'Number of connected users'
        });

        // Message metrics
        this.metrics.counter({
            name: 'socket_messages_total',
            help: 'Total number of messages processed'
        });

        // AI processing metrics
        this.metrics.histogram({
            name: 'ai_processing_duration',
            help: 'AI message processing duration'
        });
    }

    /**
     * Authentication middleware for Socket.io connections
     */
    private authenticate = async (socket: Socket, next: (err?: Error) => void) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                throw new Error('Authentication token required');
            }

            // Validate token and rate limiting here
            // Implementation depends on your auth system

            next();
        } catch (error) {
            logger.error('Socket authentication failed', { error });
            next(new Error('Authentication failed'));
        }
    };

    /**
     * Handles new socket connections with enhanced monitoring
     */
    private handleConnection(socket: Socket): void {
        try {
            const userId = socket.handshake.auth.userId;
            this.connectedUsers.set(userId, socket);

            // Update metrics
            this.metrics.gauge('socket_connected_users').set(this.connectedUsers.size);

            logger.info('New socket connection established', { userId });

            // Set up event listeners
            this.setupEventListeners(socket, userId);

            // Handle disconnection
            socket.on('disconnect', () => {
                this.handleDisconnection(userId);
            });

        } catch (error) {
            logger.error('Error handling socket connection', { error });
            socket.disconnect(true);
        }
    }

    /**
     * Sets up event listeners for a connected socket
     */
    private setupEventListeners(socket: Socket, userId: string): void {
        // Message event handler
        socket.on('message', async (message: IMessage) => {
            await this.handleMessage(message, userId);
        });

        // Typing indicator handler
        socket.on('typing', (data: { recipientId: string }) => {
            this.emitToUser(data.recipientId, 'typing', { userId });
        });

        // Read receipt handler
        socket.on('message:read', (data: { messageId: string, senderId: string }) => {
            this.handleReadReceipt(data);
        });
    }

    /**
     * Handles incoming messages with AI processing and delivery tracking
     */
    private async handleMessage(message: IMessage, senderId: string): Promise<void> {
        const startTime = Date.now();

        try {
            // Validate message format
            if (!this.validateMessage(message)) {
                throw new Error('Invalid message format');
            }

            // Process message with AI service through circuit breaker
            const aiMetadata = await this.aiServiceBreaker.fire(message);

            // Update message with AI metadata and status
            const processedMessage: IMessage = {
                ...message,
                senderId,
                status: MessageStatus.SENT,
                aiProcessed: true,
                aiMetadata,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Emit message to recipient
            await this.emitToUser(
                message.receiverId,
                'message',
                processedMessage
            );

            // Update metrics
            this.metrics.counter('socket_messages_total').inc();
            this.metrics.histogram('ai_processing_duration')
                .observe(Date.now() - startTime);

            logger.info('Message processed and delivered', {
                messageId: message.id,
                processingTime: Date.now() - startTime
            });

        } catch (error) {
            logger.error('Error processing message', { error, messageId: message.id });
            this.emitToUser(senderId, 'message:error', {
                messageId: message.id,
                error: 'Failed to process message'
            });
        }
    }

    /**
     * Handles message read receipts
     */
    private handleReadReceipt(data: { messageId: string, senderId: string }): void {
        try {
            this.emitToUser(data.senderId, 'message:read', {
                messageId: data.messageId,
                timestamp: new Date()
            });
        } catch (error) {
            logger.error('Error handling read receipt', { error });
        }
    }

    /**
     * Handles socket disconnection
     */
    private handleDisconnection(userId: string): void {
        this.connectedUsers.delete(userId);
        this.metrics.gauge('socket_connected_users').set(this.connectedUsers.size);
        logger.info('Socket disconnected', { userId });
    }

    /**
     * Emits event to specific user
     */
    private emitToUser(userId: string, event: string, data: any): void {
        const userSocket = this.connectedUsers.get(userId);
        if (userSocket?.connected) {
            userSocket.emit(event, data);
        }
    }

    /**
     * Validates message format and content
     */
    private validateMessage(message: IMessage): boolean {
        return !!(
            message &&
            message.id &&
            message.content &&
            message.receiverId &&
            message.type in MessageType
        );
    }

    /**
     * Returns current metrics for monitoring
     */
    public getMetrics(): any {
        return this.metrics.getMetrics();
    }

    /**
     * Gracefully shuts down the socket server
     */
    public async shutdown(): Promise<void> {
        try {
            // Disconnect all clients
            this.connectedUsers.forEach((socket) => {
                socket.disconnect(true);
            });

            // Clear connected users
            this.connectedUsers.clear();

            // Close the server
            await new Promise<void>((resolve) => {
                this.io.close(() => resolve());
            });

            logger.info('Socket server shut down successfully');
        } catch (error) {
            logger.error('Error shutting down socket server', { error });
            throw error;
        }
    }
}

// Export singleton instance
export default SocketService.getInstance();