// External imports with versions
import * as Joi from 'joi'; // ^17.6.0
import { validationResult } from 'express-validator'; // ^6.14.0
import xss from 'xss'; // ^1.0.10
import validator from 'validator'; // ^13.7.0

/**
 * Interface defining the structure of validation error details
 * with enhanced context and categorization
 */
export interface ValidationErrorDetail {
    field: string;
    message: string;
    value?: any;
    code: string;
    category: string;
    constraints: any[];
}

/**
 * Configuration options for the validation process
 */
export interface ValidationOptions {
    stripUnknown: boolean;
    abortEarly: boolean;
    allowUnknown: boolean;
    messages: Record<string, string>;
}

/**
 * Configuration options for input sanitization
 */
export interface SanitizeOptions {
    stripTags: boolean;
    escapeHTML: boolean;
    preventSQLInjection: boolean;
    allowedTags: string[];
}

/**
 * Enhanced custom error class for validation failures
 * with detailed error tracking and categorization
 */
export class ValidationError extends Error {
    public readonly errors: ValidationErrorDetail[];
    public readonly category: string;
    public readonly timestamp: Date;

    constructor(message: string, errors: ValidationErrorDetail[], category: string) {
        super(message);
        this.name = 'ValidationError';
        this.errors = errors;
        this.category = category;
        this.timestamp = new Date();
        Error.captureStackTrace(this, ValidationError);
    }

    /**
     * Formats error details for logging and client response
     */
    public toJSON(): Record<string, any> {
        return {
            message: this.message,
            category: this.category,
            timestamp: this.timestamp.toISOString(),
            errors: this.errors,
        };
    }
}

/**
 * Advanced schema validation with comprehensive options and error handling
 * @param schema - Joi schema for validation
 * @param data - Data to validate
 * @param options - Validation options
 */
export async function validateSchema(
    schema: Joi.Schema,
    data: any,
    options: Partial<ValidationOptions> = {}
): Promise<any> {
    const defaultOptions: ValidationOptions = {
        stripUnknown: true,
        abortEarly: false,
        allowUnknown: false,
        messages: {},
        ...options
    };

    try {
        const result = await schema.validateAsync(data, defaultOptions);
        return result;
    } catch (error) {
        if (error instanceof Joi.ValidationError) {
            const validationErrors: ValidationErrorDetail[] = error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message,
                value: detail.context?.value,
                code: detail.type,
                category: 'validation',
                constraints: detail.context?.peers || []
            }));

            throw new ValidationError(
                'Validation failed',
                validationErrors,
                'schema_validation'
            );
        }
        throw error;
    }
}

/**
 * Comprehensive authentication request validation with security checks
 * @param request - Authentication request data
 */
export async function validateAuthRequest(request: any): Promise<any> {
    const authSchema = Joi.object({
        email: Joi.string()
            .email()
            .required()
            .custom((value, helpers) => {
                if (!validator.isEmail(value)) {
                    return helpers.error('Invalid email format');
                }
                return value;
            }),
        password: Joi.string()
            .required()
            .min(8)
            .max(100)
            .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/)
            .messages({
                'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character'
            }),
        username: Joi.string()
            .alphanum()
            .min(3)
            .max(30)
            .required()
    });

    try {
        return await validateSchema(authSchema, request);
    } catch (error) {
        if (error instanceof ValidationError) {
            error.category = 'auth_validation';
        }
        throw error;
    }
}

/**
 * Advanced input sanitization for security vulnerability prevention
 * @param input - Input data to sanitize
 * @param options - Sanitization options
 */
export function sanitizeInput(
    input: any,
    options: Partial<SanitizeOptions> = {}
): any {
    const defaultOptions: SanitizeOptions = {
        stripTags: true,
        escapeHTML: true,
        preventSQLInjection: true,
        allowedTags: [],
        ...options
    };

    const xssOptions = {
        whiteList: defaultOptions.allowedTags.reduce((acc, tag) => {
            acc[tag] = [];
            return acc;
        }, {} as Record<string, string[]>),
        stripIgnoreTag: defaultOptions.stripTags,
        css: false
    };

    function sanitizeValue(value: any): any {
        if (typeof value === 'string') {
            let sanitized = value;
            
            // XSS prevention
            if (defaultOptions.escapeHTML) {
                sanitized = xss(sanitized, xssOptions);
            }

            // SQL Injection prevention
            if (defaultOptions.preventSQLInjection) {
                sanitized = validator.escape(sanitized);
            }

            return sanitized.trim();
        }

        if (Array.isArray(value)) {
            return value.map(item => sanitizeValue(item));
        }

        if (value && typeof value === 'object') {
            return Object.keys(value).reduce((acc, key) => {
                acc[key] = sanitizeValue(value[key]);
                return acc;
            }, {} as Record<string, any>);
        }

        return value;
    }

    return sanitizeValue(input);
}

/**
 * Type guard to check if an error is a ValidationError
 */
export function isValidationError(error: any): error is ValidationError {
    return error instanceof ValidationError;
}

/**
 * Utility function to create a validation error response
 */
export function createValidationError(
    message: string,
    errors: ValidationErrorDetail[],
    category: string = 'validation'
): ValidationError {
    return new ValidationError(message, errors, category);
}