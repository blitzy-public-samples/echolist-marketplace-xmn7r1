import { ImageRecognitionService } from '../services/ai/imageRecognition.service';
import { RabbitMQService } from '../services/queue/rabbitmq.service';
import { S3StorageService } from '../services/storage/s3.service';
import { logger } from '../utils/logger.util';
import { AI_SERVICE_ERRORS } from '../constants/error.constants';
import sharp from 'sharp'; // sharp v0.32.0

// Queue configuration constants
const IMAGE_PROCESSING_QUEUE = 'image_processing_queue';
const RESULT_EXCHANGE = 'image_processing';
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
const MAX_CONCURRENT_JOBS = 5;

// Image processing job interface
interface IImageProcessingJob {
  imageUrl: string;
  jobType: 'listing' | 'verification';
  listingId?: string;
  transactionId?: string;
  options?: {
    estimateDimensions?: boolean;
    requireHighQuality?: boolean;
    categories?: string[];
  };
  retryCount?: number;
}

// Processing result interface
interface IProcessingResult {
  success: boolean;
  imageUrl: string;
  processedImageUrl?: string;
  aiAnalysis?: {
    labels: Array<{ name: string; confidence: number }>;
    categories: string[];
    dimensions?: {
      length: number;
      width: number;
      height: number;
      unit: 'in' | 'cm';
    };
    quality: {
      score: number;
      issues: string[];
    };
  };
  verificationResult?: {
    isAuthentic: boolean;
    qualityScore: number;
    verificationDetails: {
      timestamp: string;
      method: string;
      confidence: number;
    };
  };
  error?: {
    code: number;
    message: string;
  };
  metadata: {
    processingTime: number;
    originalSize: number;
    processedSize: number;
    format: string;
    dimensions: {
      width: number;
      height: number;
    };
  };
}

/**
 * ImageProcessingWorker class handles asynchronous image processing tasks
 */
export class ImageProcessingWorker {
  private imageRecognitionService: ImageRecognitionService;
  private queueService: RabbitMQService;
  private s3Service: S3StorageService;
  private processingMetrics: Map<string, number>;
  private activeJobs: number;

  constructor() {
    this.imageRecognitionService = new ImageRecognitionService();
    this.queueService = RabbitMQService.getInstance();
    this.s3Service = new S3StorageService();
    this.processingMetrics = new Map();
    this.activeJobs = 0;

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      await this.stop();
    });
  }

  /**
   * Starts the worker process
   */
  public async start(): Promise<void> {
    try {
      logger.info('Starting image processing worker...');

      // Initialize queue connection
      await this.queueService.initialize();

      // Set up consumer with concurrency control
      await this.queueService.consumeMessage(
        IMAGE_PROCESSING_QUEUE,
        async (msg) => {
          if (this.activeJobs >= MAX_CONCURRENT_JOBS) {
            // Requeue message if at capacity
            await this.queueService.channel?.nack(msg!, false, true);
            return;
          }

          this.activeJobs++;
          try {
            const job: IImageProcessingJob = JSON.parse(msg!.content.toString());
            const result = await this.processImage(job);
            
            // Publish results
            await this.queueService.publishMessage(
              RESULT_EXCHANGE,
              `result.${job.jobType}`,
              Buffer.from(JSON.stringify(result))
            );

            // Update metrics
            this.updateMetrics(job.jobType, result.success);
          } catch (error) {
            await this.handleProcessingError(error as Error, JSON.parse(msg!.content.toString()));
          } finally {
            this.activeJobs--;
          }
        },
        { noAck: false }
      );

      logger.info('Image processing worker started successfully');
    } catch (error) {
      logger.error('Failed to start image processing worker', { error });
      throw error;
    }
  }

  /**
   * Stops the worker process
   */
  public async stop(): Promise<void> {
    try {
      logger.info('Stopping image processing worker...');
      
      // Wait for active jobs to complete
      while (this.activeJobs > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Close queue connection
      await this.queueService.closeConnection();
      
      logger.info('Image processing worker stopped successfully');
    } catch (error) {
      logger.error('Error stopping image processing worker', { error });
      throw error;
    }
  }

  /**
   * Processes a single image
   */
  private async processImage(job: IImageProcessingJob): Promise<IProcessingResult> {
    const startTime = Date.now();
    let originalSize = 0;
    let processedSize = 0;

    try {
      // Download image from S3
      const imageBuffer = await this.s3Service.downloadImage(job.imageUrl);
      originalSize = imageBuffer.length;

      // Optimize image
      const optimizedBuffer = await sharp(imageBuffer)
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
      processedSize = optimizedBuffer.length;

      // Process based on job type
      if (job.jobType === 'listing') {
        const analysis = await this.imageRecognitionService.analyzeImage(
          optimizedBuffer,
          'image/jpeg',
          job.options
        );

        // Upload processed image
        const processedImageUrl = await this.s3Service.uploadFile(
          optimizedBuffer,
          `processed/${job.listingId}/${Date.now()}.jpg`,
          'image/jpeg',
          { isPublic: true }
        );

        return {
          success: true,
          imageUrl: job.imageUrl,
          processedImageUrl: processedImageUrl.url,
          aiAnalysis: {
            labels: analysis.labels,
            categories: analysis.categories,
            dimensions: analysis.dimensions,
            quality: analysis.quality
          },
          metadata: {
            processingTime: Date.now() - startTime,
            originalSize,
            processedSize,
            format: 'jpeg',
            dimensions: analysis.metadata.dimensions
          }
        };
      } else {
        // Verification processing
        const verificationResult = await this.imageRecognitionService.verifyImage(
          job.imageUrl,
          { minQualityScore: 0.7 }
        );

        return {
          success: true,
          imageUrl: job.imageUrl,
          verificationResult,
          metadata: {
            processingTime: Date.now() - startTime,
            originalSize,
            processedSize,
            format: 'jpeg',
            dimensions: verificationResult.metadata.dimensions
          }
        };
      }
    } catch (error) {
      logger.error('Image processing failed', { error, job });
      return {
        success: false,
        imageUrl: job.imageUrl,
        error: {
          code: AI_SERVICE_ERRORS.IMAGE_PROCESSING_FAILED,
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        metadata: {
          processingTime: Date.now() - startTime,
          originalSize,
          processedSize,
          format: 'unknown',
          dimensions: { width: 0, height: 0 }
        }
      };
    }
  }

  /**
   * Handles processing errors with retry logic
   */
  private async handleProcessingError(error: Error, job: IImageProcessingJob): Promise<void> {
    const retryCount = job.retryCount || 0;
    
    if (retryCount < MAX_RETRIES) {
      const delay = Math.pow(BACKOFF_MULTIPLIER, retryCount) * 1000;
      
      setTimeout(async () => {
        try {
          await this.queueService.publishMessage(
            IMAGE_PROCESSING_QUEUE,
            '',
            Buffer.from(JSON.stringify({ ...job, retryCount: retryCount + 1 }))
          );
        } catch (retryError) {
          logger.error('Failed to retry job', { error: retryError, job });
        }
      }, delay);
    } else {
      logger.error('Max retries exceeded for job', { error, job });
    }
  }

  /**
   * Updates processing metrics
   */
  private updateMetrics(jobType: string, success: boolean): void {
    const key = `${jobType}_${success ? 'success' : 'failure'}`;
    this.processingMetrics.set(key, (this.processingMetrics.get(key) || 0) + 1);
  }
}

export default new ImageProcessingWorker();