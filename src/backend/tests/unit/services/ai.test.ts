import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { MockInstance } from 'jest-mock';
import { ImageRecognitionService } from '../../../src/services/ai/imageRecognition.service';
import { MessagingAIService } from '../../../src/services/ai/messagingAI.service';
import { PriceAnalysisService } from '../../../src/services/ai/priceAnalysis.service';
import { S3StorageService } from '../../../src/services/storage/s3.service';
import { RabbitMQService } from '../../../src/services/queue/rabbitmq.service';
import { IListing } from '../../../src/interfaces/listing.interface';
import { IMessage } from '../../../src/interfaces/message.interface';
import { AI_SERVICE_ERRORS } from '../../../src/constants/error.constants';

// Mock external services
jest.mock('../../../src/services/storage/s3.service');
jest.mock('../../../src/services/queue/rabbitmq.service');

describe('ImageRecognitionService', () => {
  let imageRecognitionService: ImageRecognitionService;
  let s3ServiceMock: jest.Mocked<S3StorageService>;

  const sampleImage = Buffer.from('mock-image-data');
  const validContentType = 'image/jpeg';

  beforeEach(() => {
    s3ServiceMock = new S3StorageService() as jest.Mocked<S3StorageService>;
    imageRecognitionService = new ImageRecognitionService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeImage', () => {
    test('should successfully analyze a valid image', async () => {
      const result = await imageRecognitionService.analyzeImage(sampleImage, validContentType, {
        estimateDimensions: true,
        requireHighQuality: true
      });

      expect(result).toHaveProperty('labels');
      expect(result).toHaveProperty('categories');
      expect(result).toHaveProperty('dimensions');
      expect(result).toHaveProperty('quality');
      expect(result.quality.score).toBeGreaterThan(0);
    });

    test('should reject invalid image formats', async () => {
      await expect(
        imageRecognitionService.analyzeImage(sampleImage, 'image/invalid')
      ).rejects.toThrow(AI_SERVICE_ERRORS.IMAGE_PROCESSING_FAILED);
    });

    test('should handle AI model errors gracefully', async () => {
      // Simulate model failure
      jest.spyOn(imageRecognitionService as any, 'initializeDimensionModel')
        .mockRejectedValueOnce(new Error('Model failed'));

      await expect(
        imageRecognitionService.analyzeImage(sampleImage, validContentType)
      ).rejects.toThrow(AI_SERVICE_ERRORS.MODEL_ERROR);
    });

    test('should enforce quality thresholds when required', async () => {
      jest.spyOn(imageRecognitionService as any, 'assessImageQuality')
        .mockResolvedValueOnce({ score: 0.5, issues: ['Low resolution'] });

      await expect(
        imageRecognitionService.analyzeImage(sampleImage, validContentType, { requireHighQuality: true })
      ).rejects.toThrow('Image quality below required threshold');
    });
  });

  describe('estimateDimensions', () => {
    test('should accurately estimate item dimensions', async () => {
      const dimensions = await imageRecognitionService.estimateDimensions(sampleImage);

      expect(dimensions).toHaveProperty('length');
      expect(dimensions).toHaveProperty('width');
      expect(dimensions).toHaveProperty('height');
      expect(dimensions).toHaveProperty('confidence');
      expect(dimensions.unit).toBe('in');
    });

    test('should apply calibration when reference object provided', async () => {
      const calibrationData = {
        referenceObject: {
          type: 'creditCard',
          knownDimensions: { length: 3.37, width: 2.125 }
        }
      };

      const dimensions = await imageRecognitionService.estimateDimensions(sampleImage, calibrationData);
      expect(dimensions.confidence).toBeGreaterThan(0.8);
    });
  });
});

describe('MessagingAIService', () => {
  let messagingAIService: MessagingAIService;
  let mqServiceMock: jest.Mocked<RabbitMQService>;

  const sampleMessage: IMessage = {
    id: '123',
    content: 'Test message content',
    senderId: 'sender123',
    receiverId: 'receiver123',
    type: 'TEXT',
    status: 'SENT'
  } as IMessage;

  beforeEach(() => {
    mqServiceMock = RabbitMQService.getInstance() as jest.Mocked<RabbitMQService>;
    messagingAIService = MessagingAIService.getInstance();
  });

  describe('processMessage', () => {
    test('should analyze message sentiment and detect fraud', async () => {
      const result = await messagingAIService.processMessage(sampleMessage);

      expect(result).toHaveProperty('sentiment');
      expect(result).toHaveProperty('fraudScore');
      expect(result).toHaveProperty('suggestedResponse');
      expect(result).toHaveProperty('contentFlags');
      expect(result.confidenceScore).toBeGreaterThan(0);
    });

    test('should flag suspicious messages', async () => {
      const suspiciousMessage = {
        ...sampleMessage,
        content: 'Send money to this account immediately for verification'
      };

      const result = await messagingAIService.processMessage(suspiciousMessage);
      expect(result.fraudScore).toBeGreaterThan(0.8);
      expect(result.contentFlags).toContain('HIGH_FRAUD_RISK');
    });

    test('should generate appropriate responses for negative sentiment', async () => {
      const negativeMessage = {
        ...sampleMessage,
        content: 'This is terrible service and completely unacceptable!'
      };

      const result = await messagingAIService.processMessage(negativeMessage);
      expect(result.sentiment).toBeLessThan(-0.5);
      expect(result.suggestedResponse).toContain('respectful');
    });
  });
});

describe('PriceAnalysisService', () => {
  let priceAnalysisService: PriceAnalysisService;

  const sampleListing: IListing = {
    id: '123',
    title: 'Test Item',
    price: 99.99,
    condition: 'NEW'
  } as IListing;

  beforeEach(() => {
    priceAnalysisService = new PriceAnalysisService(
      {} as any, // Circuit breaker mock
      {} as any, // Redis mock
      {} as any  // Logger mock
    );
  });

  describe('analyzePricing', () => {
    test('should provide comprehensive price analysis', async () => {
      const analysis = await priceAnalysisService.analyzePricing(sampleListing);

      expect(analysis).toHaveProperty('suggestedPrice');
      expect(analysis).toHaveProperty('minMarketPrice');
      expect(analysis).toHaveProperty('maxMarketPrice');
      expect(analysis).toHaveProperty('confidenceScore');
      expect(analysis).toHaveProperty('marketTrend');
      expect(analysis.comparableListings.length).toBeGreaterThan(0);
    });

    test('should detect market trends accurately', async () => {
      const analysis = await priceAnalysisService.analyzePricing(sampleListing);
      
      expect(analysis.marketTrend).toHaveProperty('direction');
      expect(analysis.marketTrend).toHaveProperty('percentageChange');
      expect(analysis.marketTrend).toHaveProperty('volatility');
      expect(analysis.marketTrend).toHaveProperty('seasonalityFactor');
    });

    test('should handle outliers in market data', async () => {
      const analysisWithOutliers = await priceAnalysisService.analyzePricing({
        ...sampleListing,
        price: 999999 // Extreme price
      });

      expect(analysisWithOutliers.confidenceScore).toBeLessThan(0.5);
      expect(analysisWithOutliers.suggestedPrice).toBeLessThan(999999);
    });

    test('should utilize cache for repeated analyses', async () => {
      // First analysis
      const firstAnalysis = await priceAnalysisService.analyzePricing(sampleListing);
      
      // Second analysis of same listing
      const secondAnalysis = await priceAnalysisService.analyzePricing(sampleListing);

      expect(secondAnalysis).toEqual(firstAnalysis);
      expect(secondAnalysis.analysisTimestamp).toEqual(firstAnalysis.analysisTimestamp);
    });
  });
});