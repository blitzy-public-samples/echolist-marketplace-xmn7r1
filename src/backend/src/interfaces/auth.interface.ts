/**
 * Authentication Interface Definitions
 * Defines core authentication data structures for the EchoList platform
 * @version 1.0.0
 */

import { IUser } from './user.interface';

/**
 * JWT token payload structure with comprehensive security claims
 * Follows RFC 7519 standard for JWT implementation
 */
export interface JWTToken {
    userId: string;
    email: string;
    role: string;
    permissions: string[];
    exp: number;  // Expiration time
    iat: number;  // Issued at
    jti: string;  // JWT ID
    iss: string;  // Issuer
    sub: string;  // Subject
    aud: string[];  // Audience
}

/**
 * Authentication request payload for local authentication
 * Includes optional device tracking for enhanced security
 */
export interface AuthRequest {
    email: string;
    password: string;
    deviceId?: string;
    deviceType?: string;
    rememberMe?: boolean;
}

/**
 * Authentication response structure with tokens and user data
 * Implements OAuth 2.0 standard response format
 */
export interface AuthResponse {
    token: string;
    refreshToken: string;
    user: IUser;
    expiresIn: number;
    tokenType: string;
}

/**
 * OAuth authentication request structure
 * Supports multiple OAuth providers with provider-specific data
 */
export interface OAuthRequest {
    provider: 'google' | 'facebook' | 'apple';
    token: string;
    profile?: {
        id?: string;
        email?: string;
        name?: string;
        picture?: string;
    };
    deviceId?: string;
    nonce?: string;
}

/**
 * Decoded token payload structure with standard JWT claims
 * Used for token validation and user identification
 */
export interface TokenPayload {
    userId: string;
    email: string;
    iat: number;  // Issued at timestamp
    exp: number;  // Expiration timestamp
    jti: string;  // Unique token identifier
    scope: string[];  // Token permissions scope
}

/**
 * Token validation response structure
 * Used by authentication middleware for token verification
 */
export interface TokenValidationResponse {
    valid: boolean;
    error?: string;
    payload?: TokenPayload;
}

/**
 * Password reset request structure
 * Implements secure password reset flow
 */
export interface PasswordResetRequest {
    email: string;
    token?: string;
    newPassword?: string;
    deviceInfo?: {
        deviceId: string;
        deviceType: string;
        ipAddress: string;
    };
}

/**
 * Session management interface
 * Tracks active user sessions for security
 */
export interface AuthSession {
    sessionId: string;
    userId: string;
    deviceId?: string;
    ipAddress: string;
    userAgent: string;
    lastActive: number;
    isValid: boolean;
}

/**
 * Two-factor authentication verification payload
 * Supports multiple 2FA methods
 */
export interface TwoFactorVerification {
    userId: string;
    method: 'sms' | 'email' | 'authenticator';
    code: string;
    deviceId?: string;
}

/**
 * Rate limiting configuration interface
 * Implements security measures against brute force attacks
 */
export interface RateLimitConfig {
    windowMs: number;
    maxAttempts: number;
    blockDuration: number;
    whitelist: string[];
}