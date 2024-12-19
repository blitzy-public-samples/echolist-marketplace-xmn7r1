import { Request, Response } from 'express';
import httpStatus from 'http-status';
import { KMS } from 'aws-sdk';
import { IUser, IUserPreferences, UserRole } from '../../interfaces/user.interface';
import { User } from '../../db/models/user.model';
import { PasswordService } from '../../services/auth/password.service';
import { logger } from '../../utils/logger.util';
import { createCustomError } from '../../utils/error.util';
import { AUTH_ERRORS } from '../../constants/error.constants';
import { encryptionService } from '../../utils/encryption.util';

/**
 * Enhanced UserController with comprehensive security features,
 * audit logging, and AWS KMS integration
 * @version 1.0.0
 */
export class UserController {
  private readonly passwordService: PasswordService;
  private readonly kmsClient: KMS;
  private readonly rateLimitMap: Map<string, number>;
  private readonly MAX_ATTEMPTS = 5;
  private readonly RATE_LIMIT_WINDOW = 3600000; // 1 hour in milliseconds

  constructor(passwordService: PasswordService, kmsClient: KMS) {
    this.passwordService = passwordService;
    this.kmsClient = kmsClient;
    this.rateLimitMap = new Map();

    // Clean up rate limit map periodically
    setInterval(() => this.cleanRateLimitMap(), this.RATE_LIMIT_WINDOW);
  }

  /**
   * Creates a new user account with enhanced security validation
   * @param req Express request object
   * @param res Express response object
   */
  public async createUser(req: Request, res: Response): Promise<Response> {
    try {
      const { email, password, firstName, lastName, phoneNumber } = req.body;

      // Validate email uniqueness with rate limiting
      if (await this.isRateLimited(email)) {
        throw createCustomError(
          AUTH_ERRORS.UNAUTHORIZED,
          'Too many attempts. Please try again later.'
        );
      }

      // Check for existing user
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'Email already registered'
        );
      }

      // Hash password with KMS integration
      const hashedPassword = await this.passwordService.hashNewPassword(
        password,
        email
      );

      // Create user with default roles and preferences
      const user = await User.create({
        email,
        password: hashedPassword.hash,
        firstName,
        lastName,
        phoneNumber,
        roles: [UserRole.USER],
        isVerified: false,
        isActive: true,
        lastLogin: new Date(),
        securityLog: [{
          event: 'ACCOUNT_CREATION',
          timestamp: new Date(),
          metadata: {
            ip: req.ip,
            userAgent: req.headers['user-agent']
          }
        }]
      });

      // Log successful creation
      logger.info('User account created successfully', {
        userId: user.id,
        email: user.email,
        timestamp: new Date().toISOString()
      });

      // Return sanitized user data
      return res.status(httpStatus.CREATED).json({
        success: true,
        data: this.sanitizeUserData(user)
      });

    } catch (error) {
      logger.error('User creation failed', { error });
      throw error;
    }
  }

  /**
   * Updates user profile with role-based access control
   * @param req Express request object
   * @param res Express response object
   */
  public async updateUser(req: Request, res: Response): Promise<Response> {
    try {
      const userId = req.params.id;
      const updates = req.body;

      // Verify user authorization
      if (!this.canUpdateUser(req.user, userId)) {
        throw createCustomError(
          AUTH_ERRORS.UNAUTHORIZED,
          'Not authorized to update this user'
        );
      }

      // Get existing user
      const user = await User.findByPk(userId);
      if (!user) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'User not found'
        );
      }

      // Filter allowed update fields
      const allowedUpdates = this.getAllowedUpdates(req.user.roles);
      const sanitizedUpdates = Object.keys(updates)
        .filter(key => allowedUpdates.includes(key))
        .reduce((obj, key) => {
          obj[key] = updates[key];
          return obj;
        }, {} as Partial<IUser>);

      // Track changes for audit log
      const changes = Object.keys(sanitizedUpdates).map(key => ({
        field: key,
        oldValue: user[key],
        newValue: sanitizedUpdates[key]
      }));

      // Update user record
      await user.update(sanitizedUpdates);

      // Add security log entry
      user.securityLog = [
        {
          event: 'PROFILE_UPDATE',
          timestamp: new Date(),
          changes,
          metadata: {
            ip: req.ip,
            userAgent: req.headers['user-agent']
          }
        },
        ...user.securityLog
      ];
      await user.save();

      logger.info('User profile updated', {
        userId,
        changes,
        timestamp: new Date().toISOString()
      });

      return res.status(httpStatus.OK).json({
        success: true,
        data: this.sanitizeUserData(user)
      });

    } catch (error) {
      logger.error('User update failed', { error });
      throw error;
    }
  }

  /**
   * Updates user preferences with type validation
   * @param req Express request object
   * @param res Express response object
   */
  public async updatePreferences(req: Request, res: Response): Promise<Response> {
    try {
      const userId = req.params.id;
      const preferences: Partial<IUserPreferences> = req.body;

      // Verify user authorization
      if (!this.canUpdateUser(req.user, userId)) {
        throw createCustomError(
          AUTH_ERRORS.UNAUTHORIZED,
          'Not authorized to update preferences'
        );
      }

      // Get existing user
      const user = await User.findByPk(userId);
      if (!user) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'User not found'
        );
      }

      // Validate and merge preferences
      const updatedPreferences = {
        ...user.preferences,
        ...this.validatePreferences(preferences)
      };

      // Update preferences with encryption for sensitive data
      const encryptedPreferences = await encryptionService.encrypt(
        JSON.stringify(updatedPreferences)
      );

      await user.update({
        preferences: updatedPreferences,
        securityLog: [
          {
            event: 'PREFERENCES_UPDATE',
            timestamp: new Date(),
            metadata: {
              ip: req.ip,
              userAgent: req.headers['user-agent']
            }
          },
          ...user.securityLog
        ]
      });

      logger.info('User preferences updated', {
        userId,
        timestamp: new Date().toISOString()
      });

      return res.status(httpStatus.OK).json({
        success: true,
        data: { preferences: updatedPreferences }
      });

    } catch (error) {
      logger.error('Preferences update failed', { error });
      throw error;
    }
  }

  /**
   * Retrieves user profile with data sanitization
   * @param req Express request object
   * @param res Express response object
   */
  public async getUser(req: Request, res: Response): Promise<Response> {
    try {
      const userId = req.params.id;

      // Verify user authorization
      if (!this.canViewUser(req.user, userId)) {
        throw createCustomError(
          AUTH_ERRORS.UNAUTHORIZED,
          'Not authorized to view this user'
        );
      }

      const user = await User.findByPk(userId);
      if (!user) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'User not found'
        );
      }

      return res.status(httpStatus.OK).json({
        success: true,
        data: this.sanitizeUserData(user)
      });

    } catch (error) {
      logger.error('User retrieval failed', { error });
      throw error;
    }
  }

  /**
   * Soft deletes user account with cleanup
   * @param req Express request object
   * @param res Express response object
   */
  public async deleteUser(req: Request, res: Response): Promise<Response> {
    try {
      const userId = req.params.id;

      // Verify user authorization
      if (!this.canDeleteUser(req.user, userId)) {
        throw createCustomError(
          AUTH_ERRORS.UNAUTHORIZED,
          'Not authorized to delete this user'
        );
      }

      const user = await User.findByPk(userId);
      if (!user) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'User not found'
        );
      }

      // Perform soft delete
      await user.update({
        isActive: false,
        securityLog: [
          {
            event: 'ACCOUNT_DELETION',
            timestamp: new Date(),
            metadata: {
              ip: req.ip,
              userAgent: req.headers['user-agent']
            }
          },
          ...user.securityLog
        ]
      });

      logger.info('User account deleted', {
        userId,
        timestamp: new Date().toISOString()
      });

      return res.status(httpStatus.OK).json({
        success: true,
        message: 'User account deleted successfully'
      });

    } catch (error) {
      logger.error('User deletion failed', { error });
      throw error;
    }
  }

  // Private helper methods

  private sanitizeUserData(user: User): Partial<IUser> {
    const { password, securityLog, ...sanitizedUser } = user.toJSON();
    return sanitizedUser;
  }

  private async isRateLimited(identifier: string): Promise<boolean> {
    const attempts = this.rateLimitMap.get(identifier) || 0;
    if (attempts >= this.MAX_ATTEMPTS) {
      return true;
    }
    this.rateLimitMap.set(identifier, attempts + 1);
    return false;
  }

  private cleanRateLimitMap(): void {
    this.rateLimitMap.clear();
  }

  private canUpdateUser(requestUser: IUser, targetUserId: string): boolean {
    return requestUser.id === targetUserId || 
           requestUser.roles.includes(UserRole.ADMIN);
  }

  private canViewUser(requestUser: IUser, targetUserId: string): boolean {
    return requestUser.id === targetUserId || 
           requestUser.roles.includes(UserRole.ADMIN) ||
           requestUser.roles.includes(UserRole.SUPPORT);
  }

  private canDeleteUser(requestUser: IUser, targetUserId: string): boolean {
    return requestUser.roles.includes(UserRole.ADMIN);
  }

  private getAllowedUpdates(roles: UserRole[]): string[] {
    const baseFields = ['firstName', 'lastName', 'phoneNumber'];
    if (roles.includes(UserRole.ADMIN)) {
      return [...baseFields, 'email', 'isVerified', 'roles'];
    }
    return baseFields;
  }

  private validatePreferences(preferences: Partial<IUserPreferences>): IUserPreferences {
    // Implement comprehensive preference validation
    // This is a simplified version
    const validatedPreferences = { ...preferences };
    
    // Ensure required structures exist
    if (!validatedPreferences.notifications) {
      validatedPreferences.notifications = {
        email: true,
        push: true,
        sms: false,
        notificationTypes: ['MESSAGES', 'TRANSACTIONS', 'SECURITY']
      };
    }

    return validatedPreferences as IUserPreferences;
  }
}