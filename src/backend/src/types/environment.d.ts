declare namespace NodeJS {
  /**
   * Extension of ProcessEnv interface to provide strict typing for EchoList backend environment variables.
   * Ensures type safety and validation across all system components.
   */
  interface ProcessEnv {
    // Application Environment
    readonly NODE_ENV: 'development' | 'staging' | 'production';
    readonly PORT: string;
    readonly LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';

    // Database Configuration
    readonly DATABASE_URL: string;
    readonly DATABASE_POOL_SIZE: string;

    // Redis Cache Configuration
    readonly REDIS_URL: string;
    readonly REDIS_TTL: string;

    // AWS Configuration
    readonly AWS_REGION: string;
    readonly AWS_ACCESS_KEY_ID: string;
    readonly AWS_SECRET_ACCESS_KEY: string;

    // S3 and CloudFront Configuration
    readonly S3_BUCKET_NAME: string;
    readonly S3_BUCKET_REGION: string;
    readonly CLOUDFRONT_DOMAIN: string;

    // Authentication and Security
    readonly JWT_SECRET: string;
    readonly JWT_EXPIRATION: string;
    readonly JWT_REFRESH_SECRET: string;

    // Stripe Payment Configuration
    readonly STRIPE_SECRET_KEY: string;
    readonly STRIPE_WEBHOOK_SECRET: string;
    readonly STRIPE_CONNECT_CLIENT_ID: string;

    // eBay API Configuration
    readonly EBAY_APP_ID: string;
    readonly EBAY_CERT_ID: string;
    readonly EBAY_DEV_ID: string;

    // Amazon Marketplace Configuration
    readonly AMAZON_ACCESS_KEY: string;
    readonly AMAZON_SECRET_KEY: string;
    readonly AMAZON_SELLER_ID: string;

    // Walmart API Configuration
    readonly WALMART_CLIENT_ID: string;
    readonly WALMART_CLIENT_SECRET: string;

    // USPS Shipping Configuration
    readonly USPS_USER_ID: string;
    readonly USPS_API_KEY: string;

    // Message Queue Configuration
    readonly RABBITMQ_URL: string;
    readonly RABBITMQ_QUEUE_PREFIX: string;

    // Error Tracking Configuration
    readonly SENTRY_DSN: string;
    readonly SENTRY_ENVIRONMENT: string;

    // API Rate Limiting
    readonly API_RATE_LIMIT: string;
    readonly API_RATE_WINDOW: string;
  }
}