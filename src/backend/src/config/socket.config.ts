import { ServerOptions } from 'socket.io';
import { ProcessEnv } from '../types/environment';

/**
 * Interface defining comprehensive Socket.io server configuration options
 * with enhanced security, monitoring, and connection management capabilities.
 */
interface SocketConfig extends ServerOptions {
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    healthCheckPath: string;
  };
  security: {
    rateLimiting: {
      enabled: boolean;
      maxConnections: number;
      timeWindow: number;
    };
    connectionValidation: boolean;
    tokenValidation: boolean;
  };
  maxRetries: number;
  retryDelay: number;
}

/**
 * Base Socket.io configuration with production-ready settings
 * and comprehensive security measures.
 */
const BASE_SOCKET_CONFIG: SocketConfig = {
  // CORS Configuration
  cors: {
    origin: [process.env.CLIENT_URL || ''],
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 86400, // 24 hours
  },

  // Connection Settings
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000, // 25 seconds
  upgradeTimeout: 10000, // 10 seconds
  maxHttpBufferSize: 1e6, // 1MB
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  connectTimeout: 45000, // 45 seconds

  // Retry Configuration
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds

  // Monitoring Configuration
  monitoring: {
    enabled: true,
    metricsInterval: 60000, // 60 seconds
    healthCheckPath: '/socket.io/health',
  },

  // Security Configuration
  security: {
    rateLimiting: {
      enabled: true,
      maxConnections: 1000,
      timeWindow: 60000, // 60 seconds
    },
    connectionValidation: true,
    tokenValidation: true,
  },
};

/**
 * Returns environment-specific Socket.io configuration with enhanced
 * security and monitoring settings based on the current NODE_ENV.
 * 
 * @returns {SocketConfig} Environment-specific Socket.io configuration
 */
function getSocketConfig(): SocketConfig {
  const env = process.env.NODE_ENV || 'development';
  const config: SocketConfig = { ...BASE_SOCKET_CONFIG };

  switch (env) {
    case 'production':
      // Production-specific settings
      config.cors.origin = [process.env.CLIENT_URL || ''];
      config.security.rateLimiting.maxConnections = 1000;
      config.maxHttpBufferSize = 1e6; // 1MB
      config.monitoring.metricsInterval = 30000; // 30 seconds
      break;

    case 'staging':
      // Staging-specific settings
      config.cors.origin = [process.env.CLIENT_URL || ''];
      config.security.rateLimiting.maxConnections = 500;
      config.maxHttpBufferSize = 2e6; // 2MB
      config.monitoring.metricsInterval = 45000; // 45 seconds
      break;

    case 'development':
      // Development-specific settings
      config.cors.origin = ['http://localhost:3000', 'http://localhost:19006'];
      config.security.rateLimiting.enabled = false;
      config.maxHttpBufferSize = 5e6; // 5MB
      config.monitoring.metricsInterval = 60000; // 60 seconds
      break;
  }

  // Validate configuration
  validateConfig(config);

  return config;
}

/**
 * Validates the Socket.io configuration to ensure all required
 * settings are properly defined.
 * 
 * @param {SocketConfig} config - Socket.io configuration object
 * @throws {Error} If configuration validation fails
 */
function validateConfig(config: SocketConfig): void {
  if (!config.cors?.origin?.length) {
    throw new Error('Socket.io configuration: CORS origin must be defined');
  }

  if (config.maxHttpBufferSize <= 0) {
    throw new Error('Socket.io configuration: Invalid maxHttpBufferSize');
  }

  if (config.pingTimeout <= 0 || config.pingInterval <= 0) {
    throw new Error('Socket.io configuration: Invalid ping settings');
  }
}

// Export the configuration getter for use in Socket.io server initialization
export const socketConfig = getSocketConfig();

// Export individual configuration sections for granular access
export const {
  cors,
  monitoring,
  security
} = socketConfig;