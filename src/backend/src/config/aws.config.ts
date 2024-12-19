// aws-sdk v2.1000.0 - AWS SDK for JavaScript/TypeScript
import * as AWS from 'aws-sdk';
// dotenv v16.0.0 - Environment variable management
import * as dotenv from 'dotenv';
// winston v3.8.0 - Logging infrastructure
import * as winston from 'winston';

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'aws-errors.log', level: 'error' })
  ]
});

// Global AWS configuration constants
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
export const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
export const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

// Singleton instances for AWS clients
let s3Client: AWS.S3 | null = null;
let cloudFrontClient: AWS.CloudFront | null = null;

/**
 * Validates required AWS configuration parameters
 * @throws Error if configuration is invalid
 * @returns boolean True if configuration is valid
 */
const validateAWSConfig = (): boolean => {
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'S3_BUCKET_NAME',
    'CLOUDFRONT_DOMAIN'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    const error = `Missing required AWS configuration: ${missingVars.join(', ')}`;
    logger.error(error);
    throw new Error(error);
  }

  return true;
};

/**
 * Configures global AWS SDK settings and credentials
 * @throws Error if configuration fails
 */
export const configureAWS = (): void => {
  try {
    // Load environment variables
    dotenv.config();

    // Validate configuration
    validateAWSConfig();

    // Configure AWS SDK
    AWS.config.update({
      region: AWS_REGION,
      credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
      }),
      maxRetries: 3,
      httpOptions: {
        timeout: 5000,
        connectTimeout: 3000
      }
    });

    logger.info('AWS SDK configured successfully', { region: AWS_REGION });
  } catch (error) {
    handleAWSError(error as Error, 'AWS Configuration');
    throw error;
  }
};

/**
 * Returns a singleton S3 client instance
 * @returns AWS.S3 Configured S3 client instance
 */
export const getS3Client = (): AWS.S3 => {
  if (!s3Client) {
    try {
      s3Client = new AWS.S3({
        apiVersion: '2006-03-01',
        params: { Bucket: S3_BUCKET_NAME },
        signatureVersion: 'v4',
        useAccelerateEndpoint: true
      });
      logger.info('S3 client initialized successfully');
    } catch (error) {
      handleAWSError(error as Error, 'S3 Client Initialization');
      throw error;
    }
  }
  return s3Client;
};

/**
 * Returns a singleton CloudFront client instance
 * @returns AWS.CloudFront Configured CloudFront client instance
 */
export const getCloudFrontClient = (): AWS.CloudFront => {
  if (!cloudFrontClient) {
    try {
      cloudFrontClient = new AWS.CloudFront({
        apiVersion: '2020-05-31',
        region: AWS_REGION
      });
      logger.info('CloudFront client initialized successfully');
    } catch (error) {
      handleAWSError(error as Error, 'CloudFront Client Initialization');
      throw error;
    }
  }
  return cloudFrontClient;
};

/**
 * Centralized error handler for AWS operations
 * @param error Error object
 * @param operation Operation description
 */
export const handleAWSError = (error: Error, operation: string): void => {
  const awsError = error as AWS.AWSError;
  
  const errorDetails = {
    operation,
    errorCode: awsError.code,
    message: awsError.message,
    requestId: awsError.requestId,
    statusCode: awsError.statusCode,
    time: new Date().toISOString()
  };

  // Log error with context
  logger.error('AWS Operation Error', errorDetails);

  // Handle specific error types
  if (awsError.code === 'CredentialsError') {
    throw new Error('AWS Credentials validation failed');
  }

  if (awsError.code === 'NetworkingError') {
    throw new Error('AWS Network connectivity issue');
  }

  if (awsError.retryable) {
    logger.warn('Retryable AWS error occurred', errorDetails);
  }

  // Rethrow error for handling by calling code
  throw error;
};

// Initialize AWS configuration on module load
try {
  configureAWS();
} catch (error) {
  logger.error('Failed to initialize AWS configuration', { error });
  throw error;
}