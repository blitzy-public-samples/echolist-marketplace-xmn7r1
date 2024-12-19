import http from 'http';
import https from 'https';
import cluster from 'cluster';
import os from 'os';
import fs from 'fs';
import app from './app';
import logger from './utils/logger.util';

/**
 * Server configuration interface
 */
interface ServerConfig {
  port: number;
  host: string;
  workerCount: number;
  shutdownTimeout: number;
  sslEnabled: boolean;
  sslKeyPath?: string;
  sslCertPath?: string;
}

/**
 * Load server configuration from environment variables
 */
const config: ServerConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  workerCount: parseInt(process.env.WORKER_COUNT || '0', 10) || os.cpus().length,
  shutdownTimeout: parseInt(process.env.SHUTDOWN_TIMEOUT || '30000', 10),
  sslEnabled: process.env.NODE_ENV === 'production',
  sslKeyPath: process.env.SSL_KEY,
  sslCertPath: process.env.SSL_CERT
};

/**
 * Track active connections for graceful shutdown
 */
let activeConnections = new Set<any>();

/**
 * Creates HTTP/HTTPS server based on environment
 */
async function createServer(): Promise<http.Server | https.Server> {
  if (config.sslEnabled && config.sslKeyPath && config.sslCertPath) {
    try {
      const sslOptions = {
        key: fs.readFileSync(config.sslKeyPath),
        cert: fs.readFileSync(config.sslCertPath),
        minVersion: 'TLSv1.2',
        ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384',
        honorCipherOrder: true
      };
      return https.createServer(sslOptions, app);
    } catch (error) {
      logger.error('Failed to load SSL certificates:', error);
      process.exit(1);
    }
  }
  return http.createServer(app);
}

/**
 * Configures server connection tracking and timeout settings
 */
function configureServer(server: http.Server | https.Server): void {
  // Track connections
  server.on('connection', (connection) => {
    activeConnections.add(connection);
    connection.on('close', () => {
      activeConnections.delete(connection);
    });
  });

  // Configure timeouts
  server.keepAliveTimeout = 65000; // Slightly higher than ALB idle timeout
  server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout
}

/**
 * Implements graceful shutdown procedure
 */
async function gracefulShutdown(
  server: http.Server | https.Server,
  signal: string
): Promise<void> {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    logger.info('Server closed. No longer accepting connections.');
  });

  // Set shutdown timeout
  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, config.shutdownTimeout);

  try {
    // Close existing connections
    const closePromises = Array.from(activeConnections).map((connection) => {
      return new Promise<void>((resolve) => {
        if (!connection.destroyed) {
          connection.end(() => {
            connection.destroy();
            resolve();
          });
        } else {
          resolve();
        }
      });
    });

    await Promise.all(closePromises);
    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

/**
 * Configures worker process for clustering
 */
async function setupWorker(): Promise<void> {
  try {
    const server = await createServer();
    configureServer(server);

    // Start listening
    server.listen(config.port, config.host, () => {
      logger.info(`Worker ${process.pid} listening on ${config.host}:${config.port}`);
    });

    // Handle shutdown signals
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
    signals.forEach((signal) => {
      process.on(signal, () => gracefulShutdown(server, signal));
    });

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      gracefulShutdown(server, 'uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
      gracefulShutdown(server, 'unhandledRejection');
    });
  } catch (error) {
    logger.error('Failed to setup worker:', error);
    process.exit(1);
  }
}

/**
 * Configures master process for clustering
 */
async function setupCluster(): Promise<void> {
  logger.info(`Master ${process.pid} is running`);

  // Fork workers
  for (let i = 0; i < config.workerCount; i++) {
    cluster.fork();
  }

  // Handle worker events
  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died. Code: ${code}, Signal: ${signal}`);
    if (code !== 0 && !worker.exitedAfterDisconnect) {
      logger.info('Starting new worker...');
      cluster.fork();
    }
  });

  // Handle master process shutdown
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGQUIT'];
  signals.forEach((signal) => {
    process.on(signal, () => {
      logger.info(`${signal} received in master. Shutting down workers...`);
      for (const id in cluster.workers) {
        cluster.workers[id]?.process.kill(signal);
      }
    });
  });
}

/**
 * Main server initialization
 */
async function startServer(): Promise<void> {
  try {
    if (cluster.isPrimary) {
      await setupCluster();
    } else {
      await setupWorker();
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  logger.error('Fatal error during server startup:', error);
  process.exit(1);
});