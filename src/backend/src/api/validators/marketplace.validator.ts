/**
 * @fileoverview Marketplace Validator Module
 * Implements comprehensive validation rules for marketplace operations
 * including credentials, sync requests, and platform-specific validations
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import { MarketplacePlatform, IMarketplaceCredentials } from '../../interfaces/marketplace.interface';
import { MARKETPLACE_ERRORS } from '../../constants/error.constants';
import { validateSchema } from '../../utils/validation.util';

/**
 * Regular expressions for credential format validation
 */
const CREDENTIAL_PATTERNS = {
    API_KEY: /^[A-Za-z0-9-_]{32,64}$/,
    SECRET_KEY: /^[A-Za-z0-9-_]{32,64}$/,
    REFRESH_TOKEN: /^[A-Za-z0-9-_.]{1,256}$/
};

/**
 * Platform-specific validation schemas
 */
const PLATFORM_SPECIFIC_SCHEMAS = {
    [MarketplacePlatform.EBAY]: Joi.object({
        sandbox: Joi.boolean().optional(),
        siteId: Joi.number().optional(),
        authScope: Joi.array().items(Joi.string()).optional()
    }),
    [MarketplacePlatform.AMAZON]: Joi.object({
        region: Joi.string().required(),
        marketplaceId: Joi.string().required(),
        programId: Joi.string().optional()
    }),
    [MarketplacePlatform.WALMART]: Joi.object({
        channelType: Joi.string().valid('MARKETPLACE', 'DROP_SHIP').required(),
        partnerType: Joi.string().optional()
    })
};

/**
 * Base schema for marketplace credentials validation
 */
export const marketplaceCredentialsSchema = Joi.object({
    platform: Joi.string()
        .valid(...Object.values(MarketplacePlatform))
        .required()
        .messages({
            'any.required': `${MARKETPLACE_ERRORS.INVALID_PLATFORM}: Platform is required`,
            'any.only': `${MARKETPLACE_ERRORS.INVALID_PLATFORM}: Invalid platform specified`
        }),

    apiKey: Joi.string()
        .pattern(CREDENTIAL_PATTERNS.API_KEY)
        .required()
        .messages({
            'string.pattern.base': `${MARKETPLACE_ERRORS.INVALID_API_KEY}: Invalid API key format`,
            'any.required': `${MARKETPLACE_ERRORS.INVALID_API_KEY}: API key is required`
        }),

    secretKey: Joi.string()
        .pattern(CREDENTIAL_PATTERNS.SECRET_KEY)
        .required()
        .messages({
            'string.pattern.base': `${MARKETPLACE_ERRORS.INVALID_SECRET_KEY}: Invalid secret key format`,
            'any.required': `${MARKETPLACE_ERRORS.INVALID_SECRET_KEY}: Secret key is required`
        }),

    refreshToken: Joi.string()
        .pattern(CREDENTIAL_PATTERNS.REFRESH_TOKEN)
        .optional()
        .messages({
            'string.pattern.base': `${MARKETPLACE_ERRORS.INVALID_REFRESH_TOKEN}: Invalid refresh token format`
        }),

    platformSpecific: Joi.object().when('platform', {
        switch: [
            {
                is: MarketplacePlatform.EBAY,
                then: PLATFORM_SPECIFIC_SCHEMAS[MarketplacePlatform.EBAY]
            },
            {
                is: MarketplacePlatform.AMAZON,
                then: PLATFORM_SPECIFIC_SCHEMAS[MarketplacePlatform.AMAZON]
            },
            {
                is: MarketplacePlatform.WALMART,
                then: PLATFORM_SPECIFIC_SCHEMAS[MarketplacePlatform.WALMART]
            }
        ]
    })
});

/**
 * Schema for marketplace sync request validation
 */
export const syncRequestSchema = Joi.object({
    listingId: Joi.string()
        .uuid()
        .required()
        .messages({
            'string.guid': `${MARKETPLACE_ERRORS.INVALID_LISTING}: Invalid listing ID format`
        }),

    platform: Joi.string()
        .valid(...Object.values(MarketplacePlatform))
        .required()
        .messages({
            'any.only': `${MARKETPLACE_ERRORS.INVALID_PLATFORM}: Unsupported platform for sync`
        }),

    options: Joi.object({
        schedule: Joi.date().iso().optional(),
        priority: Joi.number().min(1).max(5).optional(),
        transformRules: Joi.array().items(Joi.object()).optional(),
        autoSync: Joi.boolean().optional(),
        syncInterval: Joi.number().min(300000).optional() // Minimum 5 minutes
    }),

    rateLimit: Joi.object({
        maxRequests: Joi.number().required(),
        timeWindow: Joi.number().required()
    })
});

/**
 * Validates marketplace credentials with enhanced security checks
 * @param credentials - Marketplace credentials to validate
 * @returns Promise resolving to validated credentials or throwing ValidationError
 */
export async function validateMarketplaceCredentials(
    credentials: IMarketplaceCredentials
): Promise<boolean> {
    try {
        await validateSchema(marketplaceCredentialsSchema, credentials, {
            stripUnknown: true,
            abortEarly: false
        });
        return true;
    } catch (error) {
        throw error;
    }
}

/**
 * Validates marketplace sync request with comprehensive checks
 * @param syncRequest - Sync request data to validate
 * @returns Promise resolving to validated sync request or throwing ValidationError
 */
export async function validateSyncRequest(
    syncRequest: any
): Promise<boolean> {
    try {
        await validateSchema(syncRequestSchema, syncRequest, {
            stripUnknown: true,
            abortEarly: false
        });
        return true;
    } catch (error) {
        throw error;
    }
}

/**
 * Type guard to check if platform-specific configuration is valid
 * @param platform - Marketplace platform
 * @param config - Platform-specific configuration
 */
export function isValidPlatformConfig(
    platform: MarketplacePlatform,
    config: any
): boolean {
    try {
        const schema = PLATFORM_SPECIFIC_SCHEMAS[platform];
        const { error } = schema.validate(config);
        return !error;
    } catch {
        return false;
    }
}