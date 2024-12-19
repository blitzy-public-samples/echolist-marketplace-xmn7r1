/**
 * Authentication Middleware
 * Implements secure JWT validation and role-based authorization for the EchoList platform
 * @version 1.0.0
 */

import { Request, Response, NextFunction } from 'express'; // ^4.18.0
import { verifyToken } from '../../services/auth/jwt.service';
import { JWTToken } from '../../interfaces/auth.interface';
import { AUTH_ERRORS } from '../../constants/error.constants';
import crypto from 'crypto';

/**
 * Extended Express Request interface with enhanced user data and security context
 */
interface AuthenticatedRequest extends Request {
    user?: JWTToken;
    deviceId?: string;
    userAgent?: string;
    requestId: string;
}

/**
 * Role hierarchy for authorization checks
 */
const ROLE_HIERARCHY = {
    'ADMIN': ['ADMIN', 'MODERATOR', 'SUPPORT', 'USER'],
    'MODERATOR': ['MODERATOR', 'SUPPORT', 'USER'],
    'SUPPORT': ['SUPPORT', 'USER'],
    'USER': ['USER']
};

/**
 * Generates a unique request ID for tracking
 * @returns Unique request identifier
 */
const generateRequestId = (): string => {
    return crypto.randomBytes(16).toString('hex');
};

/**
 * Extracts bearer token from authorization header
 * @param authHeader - Authorization header value
 * @returns Extracted token or null
 */
const extractBearerToken = (authHeader: string | undefined): string | null => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.substring(7);
};

/**
 * Extracts device identifier from request headers
 * @param req - Express request object
 * @returns Device identifier or generated fallback
 */
const extractDeviceId = (req: Request): string => {
    return req.headers['x-device-id'] as string || 
           req.headers['x-forwarded-for'] as string || 
           req.ip;
};

/**
 * Authentication middleware with comprehensive security checks
 */
export const authenticate = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        // Generate unique request ID for tracking
        req.requestId = generateRequestId();

        // Extract and validate authorization header
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
            throw new Error(AUTH_ERRORS.UNAUTHORIZED.toString());
        }

        // Extract device context
        const deviceId = extractDeviceId(req);
        const userAgent = req.headers['user-agent'] || 'unknown';

        // Verify token with enhanced security checks
        const decodedToken = await verifyToken(token, deviceId, userAgent);

        // Attach user context to request
        req.user = decodedToken;
        req.deviceId = deviceId;
        req.userAgent = userAgent;

        // Log authentication for audit
        console.info(
            `Authenticated request ${req.requestId} for user ${decodedToken.userId}`,
            {
                userId: decodedToken.userId,
                deviceId,
                requestPath: req.path,
                timestamp: new Date().toISOString()
            }
        );

        next();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
        
        // Log authentication failure
        console.error(
            `Authentication failed for request ${req.requestId}`,
            {
                error: errorMessage,
                path: req.path,
                timestamp: new Date().toISOString()
            }
        );

        // Map error codes to appropriate responses
        if (errorMessage.includes(AUTH_ERRORS.TOKEN_EXPIRED.toString())) {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (errorMessage.includes(AUTH_ERRORS.INVALID_TOKEN.toString())) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        res.status(401).json({ error: 'Authentication failed' });
    }
};

/**
 * Role-based authorization middleware with hierarchical permissions
 * @param requiredRoles - Array of roles that can access the resource
 * @param requiredPermissions - Array of permissions needed for access
 */
export const authorize = (
    requiredRoles: string[] = [],
    requiredPermissions: string[] = []
): ((req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>) => {
    return async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const user = req.user;
            if (!user) {
                throw new Error(AUTH_ERRORS.UNAUTHORIZED.toString());
            }

            // Check role authorization
            if (requiredRoles.length > 0) {
                const userRoleHierarchy = ROLE_HIERARCHY[user.role] || [];
                const hasRequiredRole = requiredRoles.some(role => 
                    userRoleHierarchy.includes(role)
                );

                if (!hasRequiredRole) {
                    throw new Error(AUTH_ERRORS.UNAUTHORIZED.toString());
                }
            }

            // Check permission authorization
            if (requiredPermissions.length > 0) {
                const hasRequiredPermissions = requiredPermissions.every(
                    permission => user.permissions.includes(permission)
                );

                if (!hasRequiredPermissions) {
                    throw new Error(AUTH_ERRORS.UNAUTHORIZED.toString());
                }
            }

            // Log authorization for audit
            console.info(
                `Authorized request ${req.requestId}`,
                {
                    userId: user.userId,
                    roles: requiredRoles,
                    permissions: requiredPermissions,
                    path: req.path,
                    timestamp: new Date().toISOString()
                }
            );

            next();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Authorization failed';

            // Log authorization failure
            console.error(
                `Authorization failed for request ${req.requestId}`,
                {
                    error: errorMessage,
                    path: req.path,
                    timestamp: new Date().toISOString()
                }
            );

            res.status(403).json({ error: 'Access forbidden' });
        }
    };
};
```

This implementation provides:

1. Comprehensive JWT validation with device binding
2. Role-based authorization with hierarchical permissions
3. Enhanced security features including:
   - Request ID tracking
   - Device fingerprinting
   - User agent validation
   - Detailed audit logging
4. Error handling with specific error codes
5. TypeScript interfaces for type safety
6. Extensive documentation and comments

The middleware can be used in routes like:

```typescript
router.get('/protected',
    authenticate,
    authorize(['ADMIN', 'MODERATOR'], ['read:data']),
    controller.handler
);