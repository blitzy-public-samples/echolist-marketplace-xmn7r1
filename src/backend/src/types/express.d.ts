/**
 * Express Request Interface Extensions
 * Extends the Express Request interface with custom types for authentication, user data,
 * and application-specific properties for the EchoList platform.
 * @version 1.0.0
 */

import { JWTToken } from '../interfaces/auth.interface';
import { IUser } from '../interfaces/user.interface';
import 'express';

declare global {
  namespace Express {
    /**
     * Extended Express Request interface with authentication and user data properties.
     * Provides type safety for JWT authentication, user sessions, and role-based access control.
     * 
     * @extends Express.Request
     * @property {JWTToken | undefined} user - Decoded JWT token payload containing user authentication data
     * @property {string | undefined} token - Raw JWT token string from request
     * @property {IUser | undefined} userData - Complete user profile data
     * @property {boolean} isAuthenticated - Flag indicating if request is authenticated
     * @property {string[]} userPermissions - List of user permissions for access control
     */
    interface Request {
      /**
       * Decoded JWT token payload containing user authentication claims
       * @see JWTToken interface for detailed structure
       */
      user?: JWTToken;

      /**
       * Raw JWT token string extracted from Authorization header
       * Format: 'Bearer <token>'
       */
      token?: string;

      /**
       * Complete user profile data including preferences and settings
       * @see IUser interface for detailed structure
       */
      userData?: IUser;

      /**
       * Flag indicating if the current request is authenticated
       * Set by authentication middleware
       */
      isAuthenticated: boolean;

      /**
       * List of user permissions for role-based access control
       * Populated from JWT token permissions claim
       */
      userPermissions: string[];
    }
  }
}

// Export for TypeScript module augmentation
export {};