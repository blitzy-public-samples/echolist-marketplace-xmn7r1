import { jest } from '@jest/globals';
import { faker } from '@faker-js/faker';
import { ListingService } from '../../../src/services/listing/listing.service';
import { ImageRecognitionService } from '../../../src/services/ai/imageRecognition.service';
import { S3StorageService } from '../../../src/services/storage/s3.service';
import { IListing, IListingCreationAttributes, Dimensions } from '../../../src/interfaces/listing.interface';
import { LISTING_STATUS, SYNC_STATUS } from '../../../src/constants/status.constants';
import { MARKETPLACE_ERRORS, AI_SERVICE_ERRORS } from '../../../src/constants/error.constants';
import Redis from 'ioredis';
import { logger } from '../../../src/utils/logger.util';

// Mock external services
jest.mock('../../../src/services/ai/imageRecognition.service');
jest.mock('../../../src/services/storage/s3.service');
jest.mock('ioredis');
jest.mock('../../../src/utils/logger.util');

describe('ListingService', () => {
  let listingService: ListingService;
  let mockImageRecognitionService: jest.Mocked<ImageRecognitionService>;
  let mockS3Service: jest.Mocked<S3StorageService>;
  let mockRedisClient: jest.Mocked<Redis>;

  // Test data generators
  const createTestDimensions = (): Dimensions => ({
    length: faker.number.float({ min: 1, max: 100 }),
    width: faker.number.float({ min: 1, max: 100 }),
    height: faker.number.float({ min: 1, max: 100 }),
    unit: 'in'
  });

  const createTestListingData = (): IListingCreationAttributes => ({
    userId: faker.string.uuid(),
    title: faker.commerce.productName(),
    description: faker.commerce.productDescription(),
    price: faker.number.float({ min: 1, max: 1000 }),
    images: [faker.image.url(), faker.image.url()],
    dimensions: createTestDimensions(),
    enableAutoSync: true,
    targetMarketplaces: ['EBAY', 'AMAZON']
  });

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Initialize mocked services
    mockImageRecognitionService = {
      analyzeImage: jest.fn(),
      estimateDimensions: jest.fn(),
      categorizeItem: jest.fn()
    } as any;

    mockS3Service = {
      uploadFile: jest.fn(),
      downloadImage: jest.fn()
    } as any;

    mockRedisClient = {
      setex: jest.fn(),
      get: jest.fn(),
      del: jest.fn()
    } as any;

    // Create listing service instance with mocked dependencies
    listingService = new ListingService(
      mockImageRecognitionService,
      mockS3Service,
      mockRedisClient,
      logger
    );
  });

  describe('createListing', () => {
    it('should create a listing with AI-enhanced data', async () => {
      // Arrange
      const testListingData = createTestListingData();
      const mockImageAnalysis = {
        labels: [{ name: 'Electronics', confidence: 0.95 }],
        dimensions: createTestDimensions(),
        quality: { score: 0.9, issues: [] }
      };

      mockImageRecognitionService.analyzeImage.mockResolvedValue(mockImageAnalysis);
      mockImageRecognitionService.estimateDimensions.mockResolvedValue(testListingData.dimensions!);

      // Act
      const result = await listingService.createListing(testListingData);

      // Assert
      expect(result).toBeDefined();
      expect(result.title).toBe(testListingData.title);
      expect(result.status).toBe(LISTING_STATUS.ACTIVE);
      expect(mockImageRecognitionService.analyzeImage).toHaveBeenCalled();
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('should handle image processing errors gracefully', async () => {
      // Arrange
      const testListingData = createTestListingData();
      mockImageRecognitionService.analyzeImage.mockRejectedValue(new Error('Image processing failed'));

      // Act & Assert
      await expect(listingService.createListing(testListingData))
        .rejects
        .toThrow(AI_SERVICE_ERRORS.IMAGE_PROCESSING_FAILED);
    });

    it('should sync with specified marketplaces', async () => {
      // Arrange
      const testListingData = createTestListingData();
      const mockImageAnalysis = {
        labels: [{ name: 'Electronics', confidence: 0.95 }],
        dimensions: createTestDimensions(),
        quality: { score: 0.9, issues: [] }
      };

      mockImageRecognitionService.analyzeImage.mockResolvedValue(mockImageAnalysis);

      // Act
      const result = await listingService.createListing(testListingData);

      // Assert
      expect(result.marketplaceSyncs).toBeDefined();
      expect(result.marketplaceSyncs.length).toBe(testListingData.targetMarketplaces.length);
      expect(result.marketplaceSyncs[0].status).toBe(SYNC_STATUS.SYNCED);
    });
  });

  describe('updateListing', () => {
    it('should update existing listing with new data', async () => {
      // Arrange
      const existingListing = {
        id: faker.string.uuid(),
        ...createTestListingData(),
        status: LISTING_STATUS.ACTIVE
      };

      const updateData = {
        title: faker.commerce.productName(),
        price: faker.number.float({ min: 1, max: 1000 })
      };

      // Act
      const result = await listingService.updateListing(
        existingListing.id,
        updateData
      );

      // Assert
      expect(result).toBeDefined();
      expect(result.title).toBe(updateData.title);
      expect(result.price).toBe(updateData.price);
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('should handle non-existent listing updates', async () => {
      // Arrange
      const nonExistentId = faker.string.uuid();
      const updateData = { title: faker.commerce.productName() };

      // Act & Assert
      await expect(listingService.updateListing(nonExistentId, updateData))
        .rejects
        .toThrow(MARKETPLACE_ERRORS.INVALID_LISTING);
    });
  });

  describe('processListingImages', () => {
    it('should process multiple images with AI analysis', async () => {
      // Arrange
      const imageUrls = [faker.image.url(), faker.image.url()];
      const mockAnalysis = {
        labels: [{ name: 'Electronics', confidence: 0.95 }],
        quality: { score: 0.9, issues: [] }
      };

      mockImageRecognitionService.analyzeImage.mockResolvedValue(mockAnalysis);
      mockS3Service.downloadImage.mockResolvedValue(Buffer.from('test-image'));

      // Act
      const result = await listingService.processListingImages(imageUrls);

      // Assert
      expect(result).toBeDefined();
      expect(mockImageRecognitionService.analyzeImage).toHaveBeenCalledTimes(imageUrls.length);
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('should use cached analysis when available', async () => {
      // Arrange
      const imageUrls = [faker.image.url()];
      const cachedAnalysis = {
        labels: [{ name: 'Electronics', confidence: 0.95 }],
        quality: { score: 0.9, issues: [] }
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(cachedAnalysis));

      // Act
      const result = await listingService.processListingImages(imageUrls);

      // Assert
      expect(result).toBeDefined();
      expect(mockImageRecognitionService.analyzeImage).not.toHaveBeenCalled();
      expect(mockRedisClient.get).toHaveBeenCalled();
    });
  });

  describe('syncWithMarketplaces', () => {
    it('should sync listing with multiple platforms', async () => {
      // Arrange
      const testListing = {
        id: faker.string.uuid(),
        ...createTestListingData()
      };

      // Act
      await listingService.syncWithMarketplaces(
        testListing as IListing,
        ['EBAY', 'AMAZON'],
        true
      );

      // Assert
      expect(mockRedisClient.setex).toHaveBeenCalled();
    });

    it('should handle platform sync failures', async () => {
      // Arrange
      const testListing = {
        id: faker.string.uuid(),
        ...createTestListingData()
      };

      // Mock a failed sync
      jest.spyOn(listingService as any, 'updateListingRecord')
        .mockRejectedValue(new Error('Sync failed'));

      // Act & Assert
      await expect(listingService.syncWithMarketplaces(
        testListing as IListing,
        ['EBAY'],
        true
      )).rejects.toThrow();
    });
  });
});