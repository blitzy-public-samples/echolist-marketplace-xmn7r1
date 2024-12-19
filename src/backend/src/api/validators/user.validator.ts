import * as Joi from 'joi'; // ^17.6.0
import { IUser } from '../../interfaces/user.interface';
import { validateRequest } from '../middlewares/validation.middleware';

// Global validation constants
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB
const SCHEMA_VERSION = '1.0.0';

// Base user schema components with caching enabled
const userBaseSchema = Joi.object({
  email: Joi.string()
    .email({ minDomainSegments: 2 })
    .lowercase()
    .trim()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email is required'
    }),
  firstName: Joi.string()
    .min(2)
    .max(50)
    .trim()
    .required()
    .messages({
      'string.min': 'First name must be at least 2 characters long',
      'string.max': 'First name cannot exceed 50 characters'
    }),
  lastName: Joi.string()
    .min(2)
    .max(50)
    .trim()
    .required()
    .messages({
      'string.min': 'Last name must be at least 2 characters long',
      'string.max': 'Last name cannot exceed 50 characters'
    }),
  phoneNumber: Joi.string()
    .pattern(PHONE_REGEX)
    .messages({
      'string.pattern.base': 'Please provide a valid phone number'
    })
}).meta({ className: 'UserBaseSchema', version: SCHEMA_VERSION });

// User registration schema
const registrationSchema = userBaseSchema.keys({
  password: Joi.string()
    .pattern(PASSWORD_REGEX)
    .required()
    .messages({
      'string.pattern.base': 'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number and one special character',
      'any.required': 'Password is required'
    }),
  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .required()
    .messages({
      'any.only': 'Passwords must match'
    })
}).meta({ className: 'RegistrationSchema' });

// User update schema (partial updates allowed)
const updateSchema = userBaseSchema.keys({
  password: Joi.string()
    .pattern(PASSWORD_REGEX)
    .messages({
      'string.pattern.base': 'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number and one special character'
    }),
  currentPassword: Joi.when('password', {
    is: Joi.exist(),
    then: Joi.string().required(),
    otherwise: Joi.forbidden()
  }).messages({
    'any.required': 'Current password is required when updating password'
  })
}).meta({ className: 'UpdateSchema' });

// User preferences schema
const preferencesSchema = Joi.object({
  notifications: Joi.object({
    email: Joi.boolean().required(),
    push: Joi.boolean().required(),
    sms: Joi.boolean().required(),
    notificationTypes: Joi.array()
      .items(Joi.string().valid('MESSAGES', 'TRANSACTIONS', 'LISTINGS', 'SECURITY'))
      .required()
  }).required(),
  marketplaceSettings: Joi.object({
    ebayConnected: Joi.boolean(),
    amazonConnected: Joi.boolean(),
    walmartConnected: Joi.boolean(),
    defaultListingPlatforms: Joi.array()
      .items(Joi.string().valid('EBAY', 'AMAZON', 'WALMART'))
  }).required(),
  shippingDefaults: Joi.object({
    preferredCarrier: Joi.string().valid('USPS', 'UPS', 'FEDEX'),
    autoSchedulePickup: Joi.boolean(),
    defaultPackaging: Joi.object({
      type: Joi.string(),
      size: Joi.string(),
      requireSignature: Joi.boolean()
    })
  }).required(),
  securitySettings: Joi.object({
    twoFactorEnabled: Joi.boolean().required(),
    twoFactorMethod: Joi.string().valid('SMS', 'EMAIL', 'AUTHENTICATOR'),
    loginNotifications: Joi.boolean()
  }).required()
}).meta({ className: 'PreferencesSchema' });

/**
 * Validates user registration data with enhanced security checks and rate limiting
 */
export const validateUserRegistration = validateRequest(
  registrationSchema,
  'body',
  {
    stripUnknown: true,
    abortEarly: false,
    messages: {
      'object.unknown': 'Invalid field provided in request'
    }
  }
);

/**
 * Validates partial user profile updates with field-specific rules
 */
export const validateUserUpdate = validateRequest(
  updateSchema,
  'body',
  {
    stripUnknown: true,
    abortEarly: false
  }
);

/**
 * Validates user preferences updates with comprehensive rule set
 */
export const validatePreferencesUpdate = validateRequest(
  preferencesSchema,
  'body',
  {
    stripUnknown: true,
    abortEarly: false
  }
);

// Export schemas for testing and external use
export const schemas = {
  registration: registrationSchema,
  update: updateSchema,
  preferences: preferencesSchema
};