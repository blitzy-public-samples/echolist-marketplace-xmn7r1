import * as tf from '@tensorflow/tfjs-node'; // ^4.1.0
import natural from 'natural'; // ^6.2.0
import { IMessage, IMessageAIMetadata } from '../../interfaces/message.interface';
import { RabbitMQService } from '../queue/rabbitmq.service';
import { logger } from '../../utils/logger.util';

/**
 * @class MessagingAIService
 * @description Singleton service for AI-powered message processing with built-in
 * performance monitoring, error handling, and graceful degradation
 * @version 1.0.0
 */
export class MessagingAIService {
    private static instance: MessagingAIService;
    private sentimentModel: tf.LayersModel | null = null;
    private fraudModel: tf.LayersModel | null = null;
    private readonly modelVersion: string = '1.0.0';
    private isModelHealthy: boolean = false;
    private readonly tokenizer: natural.WordTokenizer;
    private readonly maxSequenceLength: number = 100;
    private readonly confidenceThreshold: number = 0.7;

    private performanceMetrics = {
        totalProcessed: 0,
        averageLatency: 0,
        errorRate: 0,
        modelLoadTime: 0,
        lastHealthCheck: Date.now()
    };

    /**
     * Private constructor implementing singleton pattern with model initialization
     */
    private constructor() {
        this.tokenizer = new natural.WordTokenizer();
        this.initializeModels().catch(error => {
            logger.error('Failed to initialize AI models', { error });
            this.isModelHealthy = false;
        });

        // Set up periodic health checks
        setInterval(() => this.performHealthCheck(), 300000); // 5 minutes
    }

    /**
     * Returns singleton instance with lazy loading and health check
     */
    public static getInstance(): MessagingAIService {
        if (!MessagingAIService.instance) {
            MessagingAIService.instance = new MessagingAIService();
        }
        return MessagingAIService.instance;
    }

    /**
     * Processes message content using AI models with retry mechanism
     * @param message Message to be processed
     * @returns AI analysis results
     */
    public async processMessage(message: IMessage): Promise<IMessageAIMetadata> {
        const startTime = Date.now();
        try {
            if (!this.isModelHealthy) {
                await this.initializeModels();
            }

            const preprocessedText = this.preprocessText(message.content);
            
            const [sentiment, fraudScore] = await Promise.all([
                this.analyzeSentiment(preprocessedText),
                this.detectFraud(preprocessedText)
            ]);

            const suggestedResponse = await this.generateResponse(
                preprocessedText,
                sentiment,
                fraudScore
            );

            const metadata: IMessageAIMetadata = {
                sentiment,
                fraudScore,
                suggestedResponse,
                contentFlags: this.generateContentFlags(preprocessedText, fraudScore),
                moderationStatus: this.determineModerationStatus(fraudScore),
                processingTime: Date.now() - startTime,
                confidenceScore: this.calculateConfidenceScore(sentiment, fraudScore)
            };

            // Update performance metrics
            this.updatePerformanceMetrics(startTime);

            // Publish metrics to monitoring queue
            await this.publishMetrics(metadata);

            return metadata;

        } catch (error) {
            logger.error('Error processing message with AI', { error, messageId: message.id });
            return this.getFallbackMetadata();
        }
    }

    /**
     * Initializes and loads TensorFlow models from storage
     */
    private async initializeModels(): Promise<void> {
        const startTime = Date.now();
        try {
            // Enable memory management for TensorFlow
            tf.enableProdMode();
            tf.engine().startScope();

            // Load models in parallel
            [this.sentimentModel, this.fraudModel] = await Promise.all([
                tf.loadLayersModel('s3://echolist-ai-models/sentiment/model.json'),
                tf.loadLayersModel('s3://echolist-ai-models/fraud/model.json')
            ]);

            this.performanceMetrics.modelLoadTime = Date.now() - startTime;
            this.isModelHealthy = true;
            logger.info('AI models initialized successfully', {
                modelVersion: this.modelVersion,
                loadTime: this.performanceMetrics.modelLoadTime
            });

        } catch (error) {
            logger.error('Failed to initialize AI models', { error });
            this.isModelHealthy = false;
            throw error;
        } finally {
            tf.engine().endScope();
        }
    }

    /**
     * Analyzes text sentiment with enhanced accuracy
     */
    private async analyzeSentiment(content: string): Promise<number> {
        try {
            if (!this.sentimentModel || !this.isModelHealthy) {
                throw new Error('Sentiment model not available');
            }

            const tokenized = this.tokenizeAndPad(content);
            const tensor = tf.tensor2d([tokenized], [1, this.maxSequenceLength]);
            
            const prediction = await this.sentimentModel.predict(tensor) as tf.Tensor;
            const score = (await prediction.data())[0];
            
            // Cleanup tensors
            tensor.dispose();
            prediction.dispose();

            return this.normalizeSentimentScore(score);

        } catch (error) {
            logger.error('Sentiment analysis failed', { error });
            return 0; // Neutral sentiment as fallback
        }
    }

    /**
     * Detects potential fraud in messages
     */
    private async detectFraud(content: string): Promise<number> {
        try {
            if (!this.fraudModel || !this.isModelHealthy) {
                throw new Error('Fraud model not available');
            }

            const tokenized = this.tokenizeAndPad(content);
            const tensor = tf.tensor2d([tokenized], [1, this.maxSequenceLength]);
            
            const prediction = await this.fraudModel.predict(tensor) as tf.Tensor;
            const score = (await prediction.data())[0];
            
            // Cleanup tensors
            tensor.dispose();
            prediction.dispose();

            return score;

        } catch (error) {
            logger.error('Fraud detection failed', { error });
            return 0.5; // Moderate risk as fallback
        }
    }

    /**
     * Generates contextual automated responses
     */
    private async generateResponse(
        content: string,
        sentiment: number,
        fraudScore: number
    ): Promise<string | null> {
        try {
            if (fraudScore > 0.8) {
                return 'This message has been flagged for review. Please be cautious.';
            }

            if (sentiment < -0.5) {
                return 'Please keep communications respectful and professional.';
            }

            // Additional response generation logic here
            return null;

        } catch (error) {
            logger.error('Response generation failed', { error });
            return null;
        }
    }

    /**
     * Helper methods for text processing and model management
     */
    private preprocessText(text: string): string {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .trim();
    }

    private tokenizeAndPad(text: string): number[] {
        const tokens = this.tokenizer.tokenize(text) || [];
        const padded = tokens.slice(0, this.maxSequenceLength);
        return padded.concat(Array(this.maxSequenceLength - padded.length).fill(0));
    }

    private normalizeSentimentScore(score: number): number {
        return Math.max(-1, Math.min(1, (score * 2) - 1));
    }

    private calculateConfidenceScore(sentiment: number, fraudScore: number): number {
        return Math.min(1, (Math.abs(sentiment) + (1 - Math.abs(fraudScore - 0.5))) / 2);
    }

    private generateContentFlags(content: string, fraudScore: number): string[] {
        const flags: string[] = [];
        if (fraudScore > 0.8) flags.push('HIGH_FRAUD_RISK');
        if (fraudScore > 0.6) flags.push('MODERATE_FRAUD_RISK');
        if (content.length > 1000) flags.push('LONG_MESSAGE');
        return flags;
    }

    private determineModerationStatus(fraudScore: number): string {
        if (fraudScore > 0.8) return 'BLOCKED';
        if (fraudScore > 0.6) return 'FLAGGED';
        return 'APPROVED';
    }

    private getFallbackMetadata(): IMessageAIMetadata {
        return {
            sentiment: 0,
            fraudScore: 0.5,
            suggestedResponse: null,
            contentFlags: [],
            moderationStatus: 'PENDING_REVIEW',
            processingTime: 0,
            confidenceScore: 0
        };
    }

    private updatePerformanceMetrics(startTime: number): void {
        const latency = Date.now() - startTime;
        this.performanceMetrics.totalProcessed++;
        this.performanceMetrics.averageLatency = 
            (this.performanceMetrics.averageLatency * (this.performanceMetrics.totalProcessed - 1) + latency) 
            / this.performanceMetrics.totalProcessed;
    }

    private async publishMetrics(metadata: IMessageAIMetadata): Promise<void> {
        try {
            const mqService = RabbitMQService.getInstance();
            await mqService.publishMessage(
                'message_processing',
                'metrics.ai',
                Buffer.from(JSON.stringify({
                    timestamp: Date.now(),
                    metrics: this.performanceMetrics,
                    metadata
                }))
            );
        } catch (error) {
            logger.error('Failed to publish AI metrics', { error });
        }
    }

    private async performHealthCheck(): Promise<void> {
        try {
            const sampleText = 'This is a test message for health check.';
            await this.analyzeSentiment(sampleText);
            await this.detectFraud(sampleText);
            
            this.isModelHealthy = true;
            this.performanceMetrics.lastHealthCheck = Date.now();
            
            logger.info('AI model health check passed', {
                metrics: this.performanceMetrics
            });
        } catch (error) {
            this.isModelHealthy = false;
            logger.error('AI model health check failed', { error });
        }
    }
}

export default MessagingAIService.getInstance();