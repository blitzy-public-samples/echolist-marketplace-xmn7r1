import { Sequelize, Options, ConnectionError } from 'sequelize';
import type { ProcessEnv } from '../types/environment';

/**
 * Database configuration constants for connection pooling, SSL, and query settings
 * @version 1.0.0
 */
const DB_CONFIG = {
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '5', 10),
    acquire: 60000, // Maximum time (ms) to acquire connection
    idle: 10000,    // Maximum time (ms) connection can be idle
  },
  ssl: {
    require: true,
    rejectUnauthorized: process.env.NODE_ENV === 'production',
  },
  retry: {
    max: 5,
    timeout: 3000,
    backoffFactor: 1.5,
  },
  query: {
    timeout: 30000, // Query timeout in milliseconds
    logging: process.env.NODE_ENV !== 'production',
  },
};

/**
 * Validates required environment variables for database configuration
 * @throws {Error} If required environment variables are missing or invalid
 */
const validateEnvironmentVariables = (): void => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  if (!['development', 'staging', 'production'].includes(process.env.NODE_ENV || '')) {
    throw new Error('Invalid NODE_ENV environment variable');
  }

  // Validate pool configuration
  if (DB_CONFIG.pool.max < DB_CONFIG.pool.min) {
    throw new Error('Invalid pool configuration: max must be greater than min');
  }
};

/**
 * Returns environment-specific Sequelize configuration options
 * @returns {Options} Sequelize configuration options
 */
const getSequelizeOptions = (): Options => {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    dialect: 'mysql',
    dialectOptions: {
      ssl: DB_CONFIG.ssl,
      connectTimeout: 60000, // Connection timeout
    },
    pool: DB_CONFIG.pool,
    logging: DB_CONFIG.query.logging ? console.log : false,
    logQueryParameters: !isProduction,
    benchmark: !isProduction,
    retry: {
      match: [
        /SequelizeConnectionError/,
        /SequelizeConnectionRefusedError/,
        /SequelizeHostNotFoundError/,
        /SequelizeHostNotReachableError/,
        /SequelizeInvalidConnectionError/,
        /SequelizeConnectionTimedOutError/,
        /TimeoutError/,
      ],
      max: DB_CONFIG.retry.max,
      timeout: DB_CONFIG.retry.timeout,
      backoffBase: DB_CONFIG.retry.backoffFactor,
    },
    timezone: '+00:00', // UTC timezone
    define: {
      timestamps: true,
      underscored: true,
      paranoid: true, // Soft deletes
      charset: 'utf8mb4',
      collate: 'utf8mb4_unicode_ci',
    },
  };
};

/**
 * Configures event handlers for database connection lifecycle events
 * @param sequelize - Sequelize instance
 */
const setupConnectionEventHandlers = (sequelize: Sequelize): void => {
  sequelize.authenticate()
    .then(() => {
      console.info('Database connection established successfully.');
    })
    .catch((error: ConnectionError) => {
      console.error('Unable to connect to the database:', error.message);
      process.exit(1); // Exit on connection failure
    });

  // Connection error handler
  sequelize.connectionManager.on('error', (error: Error) => {
    console.error('Database connection error:', error.message);
  });

  // Pool status monitoring
  if (process.env.NODE_ENV !== 'production') {
    setInterval(() => {
      const pool = sequelize.connectionManager.pool;
      console.debug('Connection pool status:', {
        total: pool.size,
        idle: pool.idle,
        borrowed: pool.borrowed,
      });
    }, 60000);
  }
};

// Validate environment variables before creating Sequelize instance
validateEnvironmentVariables();

// Create and configure Sequelize instance
const sequelize = new Sequelize(
  process.env.DATABASE_URL,
  getSequelizeOptions()
);

// Set up connection event handlers
setupConnectionEventHandlers(sequelize);

// Export configured Sequelize instance
export default sequelize;

/**
 * Export type-safe connection manager for external use
 */
export const connectionManager = sequelize.connectionManager;