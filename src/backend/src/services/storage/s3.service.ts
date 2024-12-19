import * as AWS from 'aws-sdk'; // aws-sdk v2.1000.0
import * as mime from 'mime-types'; // mime-types v2.1.35
import { getS3Client, getCloudFrontClient, S3_BUCKET_NAME, CLOUDFRONT_DOMAIN } from '../../config/aws.config';
import { createCustomError } from '../../utils/error.util';
import { logger } from '../../utils/logger.util';
import { SYSTEM_ERRORS } from '../../constants/error.constants';

// Global constants
const PRESIGNED_URL_EXPIRY = 3600;
const MAX_FILE_SIZE = 10485760; // 10MB
const ALLOWED_FILE_TYPES = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  document: ['pdf', 'doc', 'docx']
};
const CACHE_CONTROL_SETTINGS = {
  public: 'public, max-age=31536000',
  private: 'private, no-cache'
};

/**
 * Enhanced S3 Storage Service for EchoList platform
 * Handles file operations with advanced security, monitoring, and CDN integration
 */
export class S3StorageService {
  private readonly s3Client: AWS.S3;
  private readonly cloudFrontClient: AWS.CloudFront;
  private readonly bucketName: string;

  constructor() {
    this.s3Client = getS3Client();
    this.cloudFrontClient = getCloudFrontClient();
    this.bucketName = S3_BUCKET_NAME;
  }

  /**
   * Uploads a file to S3 with enhanced security and optimization
   * @param fileBuffer - File data buffer
   * @param fileName - Original file name
   * @param contentType - File MIME type
   * @param options - Upload options (public, metadata)
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string,
    options: {
      isPublic?: boolean;
      metadata?: Record<string, string>;
    } = {}
  ): Promise<{ url: string; key: string; metadata: Record<string, any> }> {
    try {
      // Validate file size
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw createCustomError(
          SYSTEM_ERRORS.INTERNAL_SERVER_ERROR,
          'File size exceeds maximum limit'
        );
      }

      // Validate file type
      const fileExtension = mime.extension(contentType)?.toLowerCase();
      if (!this.isValidFileType(fileExtension)) {
        throw createCustomError(
          SYSTEM_ERRORS.INTERNAL_SERVER_ERROR,
          'Invalid file type'
        );
      }

      // Generate unique file key
      const key = this.generateUniqueFileKey(fileName);

      // Prepare upload parameters
      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        CacheControl: options.isPublic ? CACHE_CONTROL_SETTINGS.public : CACHE_CONTROL_SETTINGS.private,
        Metadata: {
          originalName: fileName,
          uploadTimestamp: new Date().toISOString(),
          ...options.metadata
        }
      };

      // Upload file to S3
      await this.s3Client.putObject(uploadParams).promise();

      // Generate CloudFront URL if public
      const url = options.isPublic
        ? `https://${CLOUDFRONT_DOMAIN}/${key}`
        : await this.generateSignedUrl(key);

      logger.info('File uploaded successfully', {
        key,
        size: fileBuffer.length,
        contentType,
        isPublic: options.isPublic
      });

      return {
        url,
        key,
        metadata: uploadParams.Metadata
      };
    } catch (error) {
      logger.error('File upload failed', { error, fileName });
      throw this.handleStorageError(error);
    }
  }

  /**
   * Deletes a file from S3 and invalidates CDN cache
   * @param key - File key in S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      // Delete file from S3
      await this.s3Client.deleteObject({
        Bucket: this.bucketName,
        Key: key
      }).promise();

      // Invalidate CloudFront cache
      await this.cloudFrontClient.createInvalidation({
        DistributionId: CLOUDFRONT_DOMAIN,
        InvalidationBatch: {
          CallerReference: Date.now().toString(),
          Paths: {
            Quantity: 1,
            Items: [`/${key}`]
          }
        }
      }).promise();

      logger.info('File deleted successfully', { key });
    } catch (error) {
      logger.error('File deletion failed', { error, key });
      throw this.handleStorageError(error);
    }
  }

  /**
   * Generates a signed URL for temporary file access
   * @param key - File key in S3
   * @param expirySeconds - URL expiration time in seconds
   */
  async generateSignedUrl(
    key: string,
    expirySeconds: number = PRESIGNED_URL_EXPIRY
  ): Promise<string> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Expires: expirySeconds
      };

      return this.s3Client.getSignedUrlPromise('getObject', params);
    } catch (error) {
      logger.error('Signed URL generation failed', { error, key });
      throw this.handleStorageError(error);
    }
  }

  /**
   * Gets a public CloudFront URL for a file
   * @param key - File key in S3
   */
  getFileUrl(key: string): string {
    return `https://${CLOUDFRONT_DOMAIN}/${key}`;
  }

  /**
   * Validates file type against allowed extensions
   * @param extension - File extension
   */
  private isValidFileType(extension?: string): boolean {
    if (!extension) return false;
    return Object.values(ALLOWED_FILE_TYPES).some(types => 
      types.includes(extension.toLowerCase())
    );
  }

  /**
   * Generates a unique file key with timestamp and random string
   * @param originalName - Original file name
   */
  private generateUniqueFileKey(originalName: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = originalName.split('.').pop()?.toLowerCase();
    return `uploads/${timestamp}-${randomString}.${extension}`;
  }

  /**
   * Handles and transforms storage-related errors
   * @param error - Original error
   */
  private handleStorageError(error: any): Error {
    if (error instanceof Error) {
      return createCustomError(
        SYSTEM_ERRORS.INTERNAL_SERVER_ERROR,
        error.message,
        { originalError: error.name }
      );
    }
    return createCustomError(
      SYSTEM_ERRORS.INTERNAL_SERVER_ERROR,
      'Storage operation failed'
    );
  }
}

export default new S3StorageService();