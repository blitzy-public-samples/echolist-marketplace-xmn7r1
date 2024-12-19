/**
 * @fileoverview Listing Validator Module
 * Implements comprehensive validation rules for listing-related operations
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import { Request, Response, NextFunction } from 'express'; // ^4.17.1
import { IListing, IListingCreationAttributes, MarketplacePlatform, isValidDimensions, isSupportedPlatform } from '../../interfaces/listing.interface';
import { MARKETPLACE_ERRORS } from '../../constants/error.constants';
import { validateSchema, ValidationError, sanitizeInput } from '../../utils/validation.util';
import { LISTING_STATUS, SYNC_STATUS } from '../../constants/status.constants';

/**
 * Comprehensive schema for new listing validation
 */
const LISTING_VALIDATION_SCHEMA = Joi.object({
    title: Joi.string()
        .required()
        .min(3)
        .max(100)
        .trim()
        .messages({
            'string.empty': 'Title is required',
            'string.min': 'Title must be at least 3 characters long',
            'string.max': 'Title cannot exceed 100 characters'
        }),

    description: Joi.string()
        .required()
        .min(20)
        .max(5000)
        .trim()
        .messages({
            'string.empty': 'Description is required',
            'string.min': 'Description must be at least 20 characters long',
            'string.max': 'Description cannot exceed 5000 characters'
        }),

    price: Joi.number()
        .required()
        .min(0.01)
        .max(1000000)
        .precision(2)
        .messages({
            'number.base': 'Price must be a valid number',
            'number.min': 'Price must be greater than 0',
            'number.max': 'Price cannot exceed 1,000,000'
        }),

    images: Joi.array()
        .items(Joi.string().uri())
        .min(1)
        .max(12)
        .required()
        .messages({
            'array.min': 'At least one image is required',
            'array.max': 'Cannot exceed 12 images'
        }),

    dimensions: Joi.object({
        length: Joi.number().required().min(0.1),
        width: Joi.number().required().min(0.1),
        height: Joi.number().required().min(0.1),
        unit: Joi.string().valid('in', 'cm').required()
    }).required(),

    shipping: Joi.object({
        offersShipping: Joi.boolean().required(),
        localPickup: Joi.boolean().required(),
        weight: Joi.number().required().min(0.1),
        weightUnit: Joi.string().valid('oz', 'lb', 'kg').required(),
        shippingMethods: Joi.array().items(Joi.string()).min(1),
        estimatedShippingCost: Joi.number().min(0),
        restrictedLocations: Joi.array().items(Joi.string())
    }).required(),

    marketplacePlatforms: Joi.array()
        .items(Joi.string().valid('EBAY', 'AMAZON', 'WALMART'))
        .min(1)
        .messages({
            'array.min': 'At least one marketplace platform must be selected'
        }),

    aiGeneratedData: Joi.object({
        categories: Joi.array().items(Joi.string()),
        tags: Joi.array().items(Joi.string()),
        imageAnalysis: Joi.object({
            condition: Joi.string().valid('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'),
            detectedObjects: Joi.array().items(Joi.string()),
            colors: Joi.array().items(Joi.string()),
            qualityScore: Joi.number().min(0).max(1),
            hasBranding: Joi.boolean()
        }),
        suggestedPrice: Joi.number().min(0),
        similarListings: Joi.array().items(Joi.string()),
        marketInsights: Joi.object({
            demandScore: Joi.number().min(0).max(1),
            competitivePricing: Joi.object({
                min: Joi.number().min(0),
                max: Joi.number().min(0),
                average: Joi.number().min(0)
            }),
            seasonalTrends: Joi.object({
                trending: Joi.boolean(),
                peakSeason: Joi.array().items(Joi.string())
            })
        })
    }).optional()
});

/**
 * Schema for listing update validation
 */
const UPDATE_VALIDATION_SCHEMA = Joi.object({
    title: Joi.string().min(3).max(100).trim(),
    description: Joi.string().min(20).max(5000).trim(),
    price: Joi.number().min(0.01).max(1000000).precision(2),
    status: Joi.string().valid(...Object.values(LISTING_STATUS)),
    images: Joi.array().items(Joi.string().uri()).min(1).max(12),
    dimensions: Joi.object({
        length: Joi.number().min(0.1),
        width: Joi.number().min(0.1),
        height: Joi.number().min(0.1),
        unit: Joi.string().valid('in', 'cm')
    }),
    marketplaceSyncs: Joi.array().items(Joi.object({
        platform: Joi.string().valid('EBAY', 'AMAZON', 'WALMART'),
        status: Joi.string().valid(...Object.values(SYNC_STATUS)),
        autoSync: Joi.boolean(),
        syncPriority: Joi.number().min(1).max(10)
    }))
});

/**
 * Schema for marketplace sync validation
 */
const SYNC_VALIDATION_SCHEMA = Joi.object({
    listingId: Joi.string().required(),
    platforms: Joi.array()
        .items(Joi.string().valid('EBAY', 'AMAZON', 'WALMART'))
        .min(1)
        .required(),
    autoSync: Joi.boolean().default(true),
    syncPriority: Joi.number().min(1).max(10).default(5)
});

/**
 * Validates listing creation requests
 */
export async function validateListingCreation(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Sanitize input data
        const sanitizedData = sanitizeInput(req.body, {
            stripTags: true,
            escapeHTML: true,
            preventSQLInjection: true,
            allowedTags: ['b', 'i', 'em', 'strong']
        });

        // Validate against schema
        const validatedData = await validateSchema(LISTING_VALIDATION_SCHEMA, sanitizedData);

        // Additional validation for dimensions
        if (!isValidDimensions(validatedData.dimensions)) {
            throw new ValidationError(
                'Invalid dimensions provided',
                [{
                    field: 'dimensions',
                    message: 'Invalid dimension values or unit',
                    code: 'INVALID_DIMENSIONS',
                    category: 'validation',
                    constraints: []
                }],
                'listing_validation'
            );
        }

        // Validate marketplace platforms
        if (validatedData.marketplacePlatforms) {
            const invalidPlatforms = validatedData.marketplacePlatforms.filter(
                (platform: string) => !isSupportedPlatform(platform)
            );
            if (invalidPlatforms.length > 0) {
                throw new ValidationError(
                    'Unsupported marketplace platforms',
                    [{
                        field: 'marketplacePlatforms',
                        message: `Unsupported platforms: ${invalidPlatforms.join(', ')}`,
                        code: 'INVALID_PLATFORMS',
                        category: 'validation',
                        constraints: []
                    }],
                    'listing_validation'
                );
            }
        }

        req.body = validatedData;
        next();
    } catch (error) {
        next(error);
    }
}

/**
 * Validates listing update requests
 */
export async function validateListingUpdate(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const sanitizedData = sanitizeInput(req.body);
        const validatedData = await validateSchema(UPDATE_VALIDATION_SCHEMA, sanitizedData);

        // Validate status transitions
        if (validatedData.status) {
            const currentStatus = req.params.currentStatus as LISTING_STATUS;
            if (!isValidStatusTransition(currentStatus, validatedData.status)) {
                throw new ValidationError(
                    'Invalid status transition',
                    [{
                        field: 'status',
                        message: `Cannot transition from ${currentStatus} to ${validatedData.status}`,
                        code: 'INVALID_STATUS_TRANSITION',
                        category: 'validation',
                        constraints: []
                    }],
                    'listing_validation'
                );
            }
        }

        req.body = validatedData;
        next();
    } catch (error) {
        next(error);
    }
}

/**
 * Validates marketplace synchronization requests
 */
export async function validateMarketplaceSync(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const sanitizedData = sanitizeInput(req.body);
        const validatedData = await validateSchema(SYNC_VALIDATION_SCHEMA, sanitizedData);

        // Validate platform-specific requirements
        for (const platform of validatedData.platforms) {
            if (!await validatePlatformRequirements(platform, req.params.listingId)) {
                throw new ValidationError(
                    'Platform requirements not met',
                    [{
                        field: 'platforms',
                        message: `Listing does not meet ${platform} requirements`,
                        code: 'PLATFORM_REQUIREMENTS_NOT_MET',
                        category: 'validation',
                        constraints: []
                    }],
                    'listing_validation'
                );
            }
        }

        req.body = validatedData;
        next();
    } catch (error) {
        next(error);
    }
}

/**
 * Validates if a status transition is allowed
 */
function isValidStatusTransition(currentStatus: LISTING_STATUS, newStatus: LISTING_STATUS): boolean {
    const allowedTransitions: Record<LISTING_STATUS, LISTING_STATUS[]> = {
        [LISTING_STATUS.DRAFT]: [LISTING_STATUS.ACTIVE, LISTING_STATUS.ARCHIVED],
        [LISTING_STATUS.ACTIVE]: [LISTING_STATUS.SOLD, LISTING_STATUS.ARCHIVED, LISTING_STATUS.PENDING],
        [LISTING_STATUS.PENDING]: [LISTING_STATUS.ACTIVE, LISTING_STATUS.ARCHIVED],
        [LISTING_STATUS.SOLD]: [LISTING_STATUS.ARCHIVED],
        [LISTING_STATUS.ARCHIVED]: [LISTING_STATUS.ACTIVE]
    };

    return allowedTransitions[currentStatus]?.includes(newStatus) || false;
}

/**
 * Validates platform-specific listing requirements
 */
async function validatePlatformRequirements(
    platform: MarketplacePlatform,
    listingId: string
): Promise<boolean> {
    // Platform-specific validation logic would go here
    // This is a placeholder implementation
    return true;
}