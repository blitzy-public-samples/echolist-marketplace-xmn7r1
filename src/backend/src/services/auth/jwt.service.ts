/**
 * JWT Authentication Service
 * Implements secure JWT token management with enhanced security features
 * @version 1.0.0
 */

import jwt from 'jsonwebtoken'; // ^9.0.0
import ms from 'ms'; // ^2.1.3
import crypto from 'crypto';
import { JWTToken } from '../interfaces/auth.interface';
import { AUTH_ERRORS } from '../constants/error.constants';

// Environment configuration with secure defaults
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'echolist-api';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'echolist-client';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
const TOKEN_VERSION = process.env.TOKEN_VERSION || '1';

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

// Token blacklist storage (should be moved to Redis in production)
const tokenBlacklist = new Set<string>();

/**
 * Generates a cryptographic fingerprint for token binding
 * @param deviceId - Unique device identifier
 * @param userAgent - Browser/device user agent string
 * @returns Cryptographic fingerprint
 */
const generateFingerprint = (deviceId: string, userAgent: string): string => {
    return crypto
        .createHash('sha256')
        .update(`${deviceId}:${userAgent}:${TOKEN_VERSION}`)
        .digest('hex');
};

/**
 * Generates a secure JWT token with enhanced security claims
 * @param payload - Token payload containing user information
 * @param deviceId - Device identifier for token binding
 * @param userAgent - User agent for fingerprinting
 * @returns Promise resolving to the generated token
 */
export const generateToken = async (
    payload: JWTToken,
    deviceId: string,
    userAgent: string
): Promise<string> => {
    const jti = crypto.randomUUID();
    const fingerprint = generateFingerprint(deviceId, userAgent);

    const token = jwt.sign(
        {
            ...payload,
            jti,
            fingerprint,
            deviceId,
            ver: TOKEN_VERSION
        },
        JWT_SECRET,
        {
            expiresIn: JWT_EXPIRES_IN,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithm: 'HS256'
        }
    );

    // Log token generation for audit (implement proper logging in production)
    console.info(`Token generated for user ${payload.userId} with jti ${jti}`);

    return token;
};

/**
 * Verifies and validates a JWT token with comprehensive security checks
 * @param token - JWT token to verify
 * @param deviceId - Device identifier for binding validation
 * @param userAgent - User agent for fingerprint validation
 * @returns Promise resolving to the decoded token payload
 */
export const verifyToken = async (
    token: string,
    deviceId: string,
    userAgent: string
): Promise<JWTToken> => {
    try {
        // Verify token signature and decode payload
        const decoded = jwt.verify(token, JWT_SECRET, {
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithms: ['HS256']
        }) as JWTToken & {
            jti: string;
            fingerprint: string;
            deviceId: string;
            ver: string;
        };

        // Check if token is blacklisted
        if (tokenBlacklist.has(decoded.jti)) {
            throw new Error(AUTH_ERRORS.TOKEN_REVOKED.toString());
        }

        // Validate token version
        if (decoded.ver !== TOKEN_VERSION) {
            throw new Error(AUTH_ERRORS.TOKEN_INVALID.toString());
        }

        // Validate device binding
        if (decoded.deviceId !== deviceId) {
            throw new Error(AUTH_ERRORS.DEVICE_MISMATCH.toString());
        }

        // Validate fingerprint
        const expectedFingerprint = generateFingerprint(deviceId, userAgent);
        if (decoded.fingerprint !== expectedFingerprint) {
            throw new Error(AUTH_ERRORS.FINGERPRINT_MISMATCH.toString());
        }

        return decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error(AUTH_ERRORS.TOKEN_EXPIRED.toString());
        }
        throw error;
    }
};

/**
 * Generates a refresh token with extended expiration
 * @param userId - User identifier
 * @param deviceId - Device identifier for binding
 * @param userAgent - User agent for fingerprinting
 * @returns Promise resolving to the refresh token
 */
export const generateRefreshToken = async (
    userId: string,
    deviceId: string,
    userAgent: string
): Promise<string> => {
    const jti = crypto.randomUUID();
    const fingerprint = generateFingerprint(deviceId, userAgent);

    const refreshToken = jwt.sign(
        {
            userId,
            jti,
            fingerprint,
            deviceId,
            type: 'refresh',
            ver: TOKEN_VERSION
        },
        JWT_SECRET,
        {
            expiresIn: REFRESH_TOKEN_EXPIRES_IN,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithm: 'HS256'
        }
    );

    // Store refresh token metadata (implement proper storage in production)
    console.info(`Refresh token generated for user ${userId} with jti ${jti}`);

    return refreshToken;
};

/**
 * Refreshes an access token using a valid refresh token
 * @param refreshToken - Current refresh token
 * @param deviceId - Device identifier for validation
 * @param userAgent - User agent for fingerprint validation
 * @returns Promise resolving to new access and refresh tokens
 */
export const refreshAccessToken = async (
    refreshToken: string,
    deviceId: string,
    userAgent: string
): Promise<{ accessToken: string; refreshToken: string }> => {
    try {
        const decoded = await verifyToken(refreshToken, deviceId, userAgent);

        if (decoded.type !== 'refresh') {
            throw new Error(AUTH_ERRORS.TOKEN_INVALID.toString());
        }

        // Generate new tokens
        const newAccessToken = await generateToken(
            {
                userId: decoded.userId,
                email: decoded.email,
                role: decoded.role,
                permissions: decoded.permissions,
                deviceId: decoded.deviceId,
                fingerprint: decoded.fingerprint
            },
            deviceId,
            userAgent
        );

        const newRefreshToken = await generateRefreshToken(
            decoded.userId,
            deviceId,
            userAgent
        );

        // Invalidate old refresh token
        await revokeToken(decoded.jti, decoded.userId);

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        };
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw new Error(AUTH_ERRORS.REFRESH_TOKEN_EXPIRED.toString());
        }
        throw error;
    }
};

/**
 * Revokes a token by adding it to the blacklist
 * @param tokenId - JWT ID (jti) to revoke
 * @param userId - User identifier for audit
 * @returns Promise resolving when token is revoked
 */
export const revokeToken = async (
    tokenId: string,
    userId: string
): Promise<void> => {
    tokenBlacklist.add(tokenId);

    // Log token revocation for audit
    console.info(`Token ${tokenId} revoked for user ${userId}`);

    // Implement proper cleanup of expired blacklist entries in production
    // Consider using Redis with TTL for token blacklist
};