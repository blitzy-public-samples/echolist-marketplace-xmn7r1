/**
 * @fileoverview Validation module for shipping-related requests including label generation,
 * pickup scheduling, box delivery requests, and tracking updates with enhanced security measures
 * and USPS-specific validations.
 * @version 1.0.0
 */

import * as Joi from 'joi'; // ^17.6.0
import { validateSchema, ValidationError } from '../../../utils/validation.util';
import {
    USPSServiceType,
    USPSBoxType,
    PickupTimeWindow,
    PickupStatus,
    TrackingStatus,
    DeliveryStatus
} from '../../../interfaces/shipping.interface';

// Constants for validation rules
const ADDRESS_MAX_LENGTH = 100;
const INSTRUCTIONS_MAX_LENGTH = 500;
const MAX_PACKAGE_COUNT = 50;
const MAX_BOX_QUANTITY = 25;
const MIN_PICKUP_DAYS_AHEAD = 1;
const MAX_PICKUP_DAYS_AHEAD = 14;
const TRACKING_NUMBER_REGEX = /^[0-9]{20,22}$/;
const ZIP_CODE_REGEX = /^\d{5}(-\d{4})?$/;

/**
 * Address validation schema with enhanced USPS compatibility checks
 */
const addressSchema = Joi.object({
    street1: Joi.string().trim().max(ADDRESS_MAX_LENGTH).required()
        .messages({
            'string.empty': 'Street address is required',
            'string.max': `Street address cannot exceed ${ADDRESS_MAX_LENGTH} characters`
        }),
    street2: Joi.string().trim().max(ADDRESS_MAX_LENGTH).allow(''),
    city: Joi.string().trim().required(),
    state: Joi.string().trim().length(2).required()
        .messages({
            'string.length': 'State must be a 2-letter code'
        }),
    zipCode: Joi.string().pattern(ZIP_CODE_REGEX).required()
        .messages({
            'string.pattern.base': 'Invalid ZIP code format'
        }),
    country: Joi.string().trim().default('US')
});

/**
 * Dimensions validation schema with USPS size limits
 */
const dimensionsSchema = Joi.object({
    length: Joi.number().positive().max(108).required(),
    width: Joi.number().positive().max(108).required(),
    height: Joi.number().positive().max(108).required(),
    unit: Joi.string().valid('in', 'cm').required()
});

/**
 * Validates shipping label generation request data with comprehensive USPS-specific validations
 * @param labelRequest - The shipping label request data to validate
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validateShippingLabel(labelRequest: any): Promise<boolean> {
    const labelSchema = Joi.object({
        serviceType: Joi.string()
            .valid(...Object.values(USPSServiceType))
            .required()
            .messages({
                'any.only': 'Invalid USPS service type'
            }),
        fromAddress: addressSchema.required(),
        toAddress: addressSchema.required(),
        weight: Joi.number()
            .positive()
            .max(70)
            .required()
            .messages({
                'number.max': 'Package weight cannot exceed 70 pounds'
            }),
        dimensions: dimensionsSchema.required(),
        labelFormat: Joi.string()
            .valid('PDF', 'ZPL', 'PNG')
            .default('PDF'),
        trackingNumber: Joi.string()
            .pattern(TRACKING_NUMBER_REGEX)
            .messages({
                'string.pattern.base': 'Invalid USPS tracking number format'
            })
    });

    await validateSchema(labelSchema, labelRequest);
    return true;
}

/**
 * Validates USPS pickup scheduling request data with enhanced time window validation
 * @param pickupRequest - The pickup request data to validate
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validatePickupRequest(pickupRequest: any): Promise<boolean> {
    const pickupSchema = Joi.object({
        pickupDate: Joi.date()
            .min(new Date(Date.now() + MIN_PICKUP_DAYS_AHEAD * 24 * 60 * 60 * 1000))
            .max(new Date(Date.now() + MAX_PICKUP_DAYS_AHEAD * 24 * 60 * 60 * 1000))
            .required()
            .messages({
                'date.min': `Pickup date must be at least ${MIN_PICKUP_DAYS_AHEAD} day ahead`,
                'date.max': `Pickup date cannot be more than ${MAX_PICKUP_DAYS_AHEAD} days ahead`
            }),
        timeWindow: Joi.string()
            .valid(...Object.values(PickupTimeWindow))
            .required(),
        address: addressSchema.required(),
        packageCount: Joi.number()
            .integer()
            .min(1)
            .max(MAX_PACKAGE_COUNT)
            .required()
            .messages({
                'number.max': `Cannot schedule more than ${MAX_PACKAGE_COUNT} packages for pickup`
            }),
        packageDetails: Joi.array().items(
            Joi.object({
                weight: Joi.number().positive().required(),
                type: Joi.string().required()
            })
        ).min(1).required(),
        specialInstructions: Joi.string()
            .max(INSTRUCTIONS_MAX_LENGTH)
            .allow('')
            .messages({
                'string.max': `Special instructions cannot exceed ${INSTRUCTIONS_MAX_LENGTH} characters`
            })
    });

    await validateSchema(pickupSchema, pickupRequest);
    return true;
}

/**
 * Validates box delivery service request data with enhanced quantity validation
 * @param deliveryRequest - The box delivery request data to validate
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validateBoxDelivery(deliveryRequest: any): Promise<boolean> {
    const deliverySchema = Joi.object({
        boxType: Joi.string()
            .valid(...Object.values(USPSBoxType))
            .required(),
        quantity: Joi.number()
            .integer()
            .min(1)
            .max(MAX_BOX_QUANTITY)
            .required()
            .messages({
                'number.max': `Cannot request more than ${MAX_BOX_QUANTITY} boxes`
            }),
        deliveryAddress: addressSchema.required(),
        deliveryInstructions: Joi.string()
            .max(INSTRUCTIONS_MAX_LENGTH)
            .allow('')
            .messages({
                'string.max': `Delivery instructions cannot exceed ${INSTRUCTIONS_MAX_LENGTH} characters`
            }),
        preferredDeliveryDate: Joi.date()
            .min(new Date(Date.now() + MIN_PICKUP_DAYS_AHEAD * 24 * 60 * 60 * 1000))
            .required()
    });

    await validateSchema(deliverySchema, deliveryRequest);
    return true;
}

/**
 * Validates tracking update notification data with enhanced status validation
 * @param trackingUpdate - The tracking update data to validate
 * @returns Promise<boolean> - Returns true if validation passes, throws ValidationError if fails
 */
export async function validateTrackingUpdate(trackingUpdate: any): Promise<boolean> {
    const trackingSchema = Joi.object({
        trackingNumber: Joi.string()
            .pattern(TRACKING_NUMBER_REGEX)
            .required()
            .messages({
                'string.pattern.base': 'Invalid USPS tracking number format'
            }),
        status: Joi.string()
            .valid(...Object.values(TrackingStatus))
            .required(),
        location: Joi.string()
            .max(ADDRESS_MAX_LENGTH)
            .required(),
        timestamp: Joi.date()
            .max('now')
            .required()
            .messages({
                'date.max': 'Tracking timestamp cannot be in the future'
            }),
        description: Joi.string()
            .max(INSTRUCTIONS_MAX_LENGTH)
            .required(),
        estimatedDeliveryDate: Joi.date()
            .min('now')
            .required(),
        exceptionDetails: Joi.string()
            .max(INSTRUCTIONS_MAX_LENGTH)
            .allow('')
            .when('status', {
                is: TrackingStatus.EXCEPTION,
                then: Joi.required()
            })
    });

    await validateSchema(trackingSchema, trackingUpdate);
    return true;
}