import winston, { format, transports } from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import { ProcessEnv } from '../types/environment';

/**
 * @version 1.0.0
 * @description Advanced logging configuration for EchoList backend with environment-specific settings,
 * security filtering, and integration with CloudWatch and ELK Stack.
 */

// Define log levels with numeric priorities
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define color scheme for console output
const LOG_COLORS = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Sensitive fields to be filtered from logs
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'creditCard',
  'ssn',
  'accessKey',
  'secretKey',
];

/**
 * Creates Winston format configuration with security filtering and performance optimization
 * @param formatOptions - Options for customizing log format
 * @returns Configured Winston format
 */
const createLogFormat = (formatOptions: any = {}) => {
  const { timestamp = true, colorize = false, json = false } = formatOptions;

  // Create format array with base formatters
  const formatArray = [
    format.errors({ stack: true }),
    format.splat(),
    format.metadata({
      fillExcept: ['message', 'level', 'timestamp', 'label'],
    }),
  ];

  // Add timestamp formatter if enabled
  if (timestamp) {
    formatArray.push(
      format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS ZZ',
      })
    );
  }

  // Add security filter to remove sensitive information
  formatArray.push(
    format((info) => {
      const filtered = { ...info };
      SENSITIVE_FIELDS.forEach((field) => {
        if (filtered[field]) filtered[field] = '[FILTERED]';
        if (filtered.metadata?.[field]) filtered.metadata[field] = '[FILTERED]';
      });
      return filtered;
    })()
  );

  // Add performance metrics
  formatArray.push(
    format((info) => ({
      ...info,
      performance: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
      },
    }))()
  );

  // Add colorization for development environment
  if (colorize) {
    formatArray.push(format.colorize({ colors: LOG_COLORS }));
  }

  // Add JSON formatting for production environment
  if (json) {
    formatArray.push(format.json());
  } else {
    formatArray.push(
      format.printf((info) => {
        const { timestamp, level, message, metadata, stack } = info;
        let output = `${timestamp} [${level}]: ${message}`;
        
        if (Object.keys(metadata).length > 0) {
          output += ` | metadata: ${JSON.stringify(metadata)}`;
        }
        
        if (stack) {
          output += `\n${stack}`;
        }
        
        return output;
      })
    );
  }

  return format.combine(...formatArray);
};

/**
 * Returns an array of Winston transports based on the current environment
 * @param env - Current environment (development/staging/production)
 * @param options - Additional transport configuration options
 * @returns Array of configured Winston transports
 */
const getTransports = (env: string, options: any = {}) => {
  const transportArray: any[] = [];

  // Console transport - available in all environments with environment-specific settings
  transportArray.push(
    new transports.Console({
      level: process.env.LOG_LEVEL || 'info',
      format: createLogFormat({
        timestamp: true,
        colorize: env === 'development',
        json: env === 'production',
      }),
    })
  );

  // File transport - development environment only
  if (env === 'development') {
    transportArray.push(
      new transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
        format: createLogFormat({ json: true }),
      })
    );
  }

  // CloudWatch transport - staging and production environments
  if (env === 'staging' || env === 'production') {
    transportArray.push(
      new WinstonCloudWatch({
        logGroupName: `echolist-${env}`,
        logStreamName: `${new Date().toISOString().split('T')[0]}-application`,
        awsRegion: process.env.AWS_REGION,
        jsonMessage: true,
        messageFormatter: ({ level, message, metadata }) =>
          JSON.stringify({ level, message, ...metadata }),
        retentionInDays: env === 'production' ? 30 : 7,
        batchSize: 100,
        awsOptions: {
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          },
        },
      })
    );
  }

  // Elasticsearch transport - production environment only
  if (env === 'production') {
    transportArray.push(
      new ElasticsearchTransport({
        level: 'info',
        index: 'echolist-logs',
        clientOpts: {
          node: options.elasticsearchNode || 'http://localhost:9200',
          auth: options.elasticsearchAuth,
        },
        bufferLimit: 100,
        flushInterval: 5000,
        format: createLogFormat({ json: true }),
      })
    );
  }

  return transportArray;
};

// Export logger configuration
export const loggerConfig = {
  levels: LOG_LEVELS,
  colors: LOG_COLORS,
  transports: getTransports(process.env.NODE_ENV || 'development'),
  format: createLogFormat(),
  exitOnError: false,
  silent: process.env.NODE_ENV === 'test',
  
  // Performance optimization options
  performanceOptions: {
    batchSize: 100,
    retryLimit: 3,
    bufferSize: '100mb',
    flushInterval: '5s',
  },
  
  // Security filter configuration
  securityFilters: SENSITIVE_FIELDS,
};

// Add colors to Winston
winston.addColors(LOG_COLORS);