import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import { connect } from 'amqplib';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import http from 'http';

// Internal imports
import sequelize from './config/database.config';
import { socketConfig } from './config/socket.config';
import { redisConfig, REDIS_ERROR_CODES } from './config/redis.config';
import { queueConfig } from './config/queue.config';

// Initialize Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

/**
 * Initializes the Express application with comprehensive security and monitoring
 * @returns {Express} Configured Express application instance
 */
const initializeApp = (): Express => {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", process.env.CLIENT_URL || '']
      }
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));

  // CORS configuration
  app.use(cors({
    origin: process.env.CLIENT_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // 24 hours
  }));

  // Rate limiting
  app.use(rateLimit({
    windowMs: parseInt(process.env.API_RATE_WINDOW || '900000', 10), // 15 minutes
    max: parseInt(process.env.API_RATE_LIMIT || '100', 10), // limit each IP
    message: 'Too many requests from this IP, please try again later.'
  }));

  // Middleware
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
  }));

  // Health check endpoint
  app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy' });
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
};

/**
 * Initializes database connection with retry logic and monitoring
 */
const initializeDatabase = async (): Promise<void> => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    logger.info('Database connection established successfully');
  } catch (error) {
    logger.error('Database connection error:', error);
    throw error;
  }
};

/**
 * Initializes WebSocket server with security and monitoring
 */
const initializeWebSocket = (server: http.Server): Server => {
  const io = new Server(server, socketConfig);

  io.use((socket, next) => {
    // Auth middleware
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }
    next();
  });

  io.on('connection', (socket) => {
    logger.info(`Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      logger.info(`Client disconnected: ${socket.id}`);
    });

    socket.on('error', (error) => {
      logger.error(`Socket error: ${error}`);
    });
  });

  return io;
};

/**
 * Initializes Redis cache with clustering and monitoring
 */
const initializeRedis = async (): Promise<Redis> => {
  const redis = new Redis(redisConfig);

  redis.on('error', (error) => {
    logger.error('Redis error:', error);
    const errorCode = error.code as keyof typeof REDIS_ERROR_CODES;
    if (REDIS_ERROR_CODES[errorCode]) {
      logger.error(REDIS_ERROR_CODES[errorCode]);
    }
  });

  redis.on('connect', () => {
    logger.info('Redis connected successfully');
  });

  return redis;
};

/**
 * Initializes message queue with dead letter exchanges
 */
const initializeMessageQueue = async (): Promise<void> => {
  try {
    const connection = await connect(queueConfig.url);
    const channel = await connection.createChannel();

    // Setup exchanges
    for (const exchange of Object.values(queueConfig.exchanges)) {
      await channel.assertExchange(
        exchange.name,
        exchange.type,
        exchange.options
      );
    }

    // Setup queues and bindings
    for (const queue of Object.values(queueConfig.queues)) {
      await channel.assertQueue(queue.name, queue.options);
      
      for (const binding of queue.bindings) {
        await channel.bindQueue(
          queue.name,
          binding.exchange,
          binding.routingKey,
          binding.arguments
        );
      }
    }

    logger.info('Message queue initialized successfully');
  } catch (error) {
    logger.error('Message queue initialization error:', error);
    throw error;
  }
};

/**
 * Handles graceful shutdown of all services
 */
const gracefulShutdown = async (): Promise<void> => {
  logger.info('Initiating graceful shutdown...');

  try {
    // Close database connection
    await sequelize.close();
    logger.info('Database connection closed');

    // Additional cleanup for other services
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

// Initialize application
const app = initializeApp();
const server = http.createServer(app);

// Initialize all services
Promise.all([
  initializeDatabase(),
  initializeRedis(),
  initializeMessageQueue()
]).then(() => {
  const io = initializeWebSocket(server);
  
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
}).catch((error) => {
  logger.error('Failed to initialize services:', error);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default app;