/**
 * Message Routes Implementation
 * Defines secure routes for handling real-time messaging with AI processing
 * @version 1.0.0
 */

import express, { Router } from 'express'; // ^4.18.0
import helmet from 'helmet'; // ^7.0.0
import compression from 'compression'; // ^1.7.4
import rateLimit from 'express-rate-limit'; // ^6.9.0
import { MessageController } from '../controllers/message.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validateRequestBody } from '../middlewares/validation.middleware';
import { messageSchemas } from '../validators/message.validator';
import { logger } from '../../utils/logger.util';

/**
 * Initializes and configures message routes with comprehensive security
 * and monitoring features
 */
function initializeMessageRoutes(): Router {
    const router = express.Router();
    const messageController = new MessageController();

    // Apply security middleware
    router.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "wss:"]
            }
        },
        xssFilter: true,
        noSniff: true,
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
    }));

    // Apply compression
    router.use(compression());

    // Configure rate limiting
    const messageLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 100, // limit each IP to 100 requests per windowMs
        message: 'Too many messages sent, please try again later',
        standardHeaders: true,
        legacyHeaders: false
    });

    // Apply authentication to all routes
    router.use(authenticate);

    /**
     * @route POST /messages
     * @description Create and send a new message with AI processing
     * @access Private
     */
    router.post('/',
        messageLimiter,
        validateRequestBody(messageSchemas.createMessageSchema),
        async (req, res, next) => {
            try {
                const response = await messageController.sendMessage(req, res, next);
                return response;
            } catch (error) {
                logger.error('Error sending message', { error });
                return res.status(500).json({
                    success: false,
                    message: 'Failed to send message'
                });
            }
        }
    );

    /**
     * @route GET /messages/:conversationId
     * @description Retrieve messages for a conversation with pagination
     * @access Private
     */
    router.get('/:conversationId',
        rateLimit({
            windowMs: 60 * 1000,
            max: 200
        }),
        async (req, res, next) => {
            try {
                const response = await messageController.getMessages(req, res, next);
                return response;
            } catch (error) {
                logger.error('Error retrieving messages', { error });
                return res.status(500).json({
                    success: false,
                    message: 'Failed to retrieve messages'
                });
            }
        }
    );

    /**
     * @route PUT /messages/:messageId/status
     * @description Update message status (read/delivered)
     * @access Private
     */
    router.put('/:messageId/status',
        rateLimit({
            windowMs: 60 * 1000,
            max: 150
        }),
        validateRequestBody(messageSchemas.updateMessageSchema),
        async (req, res, next) => {
            try {
                const response = await messageController.updateMessageStatus(req, res, next);
                return response;
            } catch (error) {
                logger.error('Error updating message status', { error });
                return res.status(500).json({
                    success: false,
                    message: 'Failed to update message status'
                });
            }
        }
    );

    /**
     * @route GET /conversations
     * @description Get user's conversation list
     * @access Private
     */
    router.get('/conversations',
        rateLimit({
            windowMs: 60 * 1000,
            max: 100
        }),
        async (req, res, next) => {
            try {
                const response = await messageController.getConversations(req, res, next);
                return response;
            } catch (error) {
                logger.error('Error retrieving conversations', { error });
                return res.status(500).json({
                    success: false,
                    message: 'Failed to retrieve conversations'
                });
            }
        }
    );

    // Error handling middleware
    router.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        logger.error('Message routes error', { error: err });
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    });

    return router;
}

// Export configured router
export const messageRouter = initializeMessageRoutes();