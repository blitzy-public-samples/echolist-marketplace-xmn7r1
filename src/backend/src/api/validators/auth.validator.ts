/**
 * Authentication Request Validator
 * Implements comprehensive validation for authentication endpoints with enhanced security measures
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import passwordComplexity from 'joi-password-complexity'; // ^5.1.0
import { RateLimiter } from 'rate-limiter-flexible'; // ^2.3.1
import { AuthRequest, OAuthRequest } from '../../interfaces/auth.interface';
import { AUTH_ERRORS } from '../../constants/error.constants';
import { validateSchema } from '../../utils/validation.util';

/**
 * Password complexity configuration following OWASP security standards
 */
const PASSWORD_RULES = {
    min: 8,
    max: 100,
    lowerCase: 1,
    upperCase: 1,
    numeric: 1,
    symbol: 1,
    requirementCount: 4,
    prohibited: [
        /password/i,
        /123456/,
        /qwerty/i
    ]
};

/**
 * Rate limiting configuration for authentication attempts
 */
const RATE_LIMIT_CONFIG = {
    loginAttempts: {
        points: 5, // Maximum attempts
        duration: 300, // Time window in seconds (5 minutes)
        blockDuration: 900 // Block duration in seconds (15 minutes)
    },
    oauthAttempts: {
        points: 10,
        duration: 300,
        blockDuration: 600
    }
};

/**
 * Supported OAuth providers with their validation rules
 */
const OAUTH_PROVIDERS = ['google', 'facebook', 'apple'];

// Initialize rate limiter for login attempts
const loginRateLimiter = new RateLimiter({
    points: RATE_LIMIT_CONFIG.loginAttempts.points,
    duration: RATE_LIMIT_CONFIG.loginAttempts.duration,
    blockDuration: RATE_LIMIT_CONFIG.loginAttempts.blockDuration,
    keyPrefix: 'login_attempts'
});

/**
 * Validates local authentication login requests with enhanced security checks
 * @param request - Authentication request data
 * @returns Promise<boolean>
 * @throws ValidationError with detailed error information
 */
export async function validateLoginRequest(request: AuthRequest): Promise<boolean> {
    // Check rate limiting first
    try {
        await loginRateLimiter.consume(request.ipAddress);
    } catch (error) {
        throw new Error(AUTH_ERRORS.RATE_LIMIT_EXCEEDED.toString());
    }

    const loginSchema = Joi.object({
        email: Joi.string()
            .email({ minDomainSegments: 2 })
            .required()
            .lowercase()
            .trim()
            .max(255)
            .messages({
                'string.email': 'Invalid email format',
                'string.empty': 'Email is required',
                'string.max': 'Email must not exceed 255 characters'
            }),

        password: passwordComplexity(PASSWORD_RULES)
            .required()
            .messages({
                'passwordComplexity.tooShort': 'Password must be at least 8 characters',
                'passwordComplexity.tooLong': 'Password must not exceed 100 characters',
                'passwordComplexity.lowercase': 'Password must contain at least 1 lowercase letter',
                'passwordComplexity.uppercase': 'Password must contain at least 1 uppercase letter',
                'passwordComplexity.numeric': 'Password must contain at least 1 number',
                'passwordComplexity.symbol': 'Password must contain at least 1 special character',
                'passwordComplexity.prohibited': 'Password contains prohibited patterns'
            }),

        deviceId: Joi.string()
            .optional()
            .trim()
            .max(100),

        deviceType: Joi.string()
            .optional()
            .valid('ios', 'android', 'web')
            .default('web'),

        rememberMe: Joi.boolean()
            .optional()
            .default(false)
    });

    await validateSchema(loginSchema, request);
    return true;
}

/**
 * Validates OAuth authentication requests with security verifications
 * @param request - OAuth request data
 * @returns Promise<boolean>
 * @throws ValidationError with detailed error information
 */
export async function validateOAuthRequest(request: OAuthRequest): Promise<boolean> {
    const oauthSchema = Joi.object({
        provider: Joi.string()
            .required()
            .valid(...OAUTH_PROVIDERS)
            .messages({
                'any.only': 'Invalid OAuth provider'
            }),

        token: Joi.string()
            .required()
            .min(20)
            .max(2000)
            .messages({
                'string.empty': 'OAuth token is required',
                'string.min': 'Invalid OAuth token format',
                'string.max': 'OAuth token exceeds maximum length'
            }),

        state: Joi.string()
            .required()
            .min(10)
            .max(100)
            .messages({
                'string.empty': 'State parameter is required for CSRF protection'
            }),

        profile: Joi.object({
            id: Joi.string().optional(),
            email: Joi.string().email().optional(),
            name: Joi.string().optional(),
            picture: Joi.string().uri().optional()
        }).optional(),

        deviceId: Joi.string()
            .optional()
            .trim()
            .max(100),

        nonce: Joi.string()
            .optional()
            .min(10)
            .max(100)
    });

    await validateSchema(oauthSchema, request);
    return true;
}

/**
 * Validates token refresh requests with security checks
 * @param request - Refresh token request data
 * @returns Promise<boolean>
 * @throws ValidationError with detailed error information
 */
export async function validateRefreshTokenRequest(request: any): Promise<boolean> {
    const refreshTokenSchema = Joi.object({
        refreshToken: Joi.string()
            .required()
            .min(20)
            .max(2000)
            .messages({
                'string.empty': 'Refresh token is required',
                'string.min': 'Invalid refresh token format',
                'string.max': 'Refresh token exceeds maximum length'
            }),

        deviceId: Joi.string()
            .optional()
            .trim()
            .max(100),

        deviceType: Joi.string()
            .optional()
            .valid('ios', 'android', 'web')
            .default('web')
    });

    await validateSchema(refreshTokenSchema, request);
    return true;
}

export default {
    validateLoginRequest,
    validateOAuthRequest,
    validateRefreshTokenRequest
};