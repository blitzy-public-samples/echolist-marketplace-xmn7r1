import { Model, DataTypes, Sequelize } from 'sequelize';
import { KMS } from 'aws-sdk';
import { IUser, UserRole, IUserPreferences, AuthMethod } from '../../interfaces/user.interface';
import { hashNewPassword } from '../../services/auth/password.service';
import { logger } from '../../utils/logger.util';
import { createCustomError } from '../../utils/error.util';
import { AUTH_ERRORS } from '../../constants/error.constants';

/**
 * Enhanced Sequelize model class for User entity with AWS KMS integration,
 * comprehensive validation, and audit logging capabilities.
 * @version 1.0.0
 */
export class User extends Model<IUser> {
  public id!: string;
  public email!: string;
  public password!: string;
  public firstName!: string;
  public lastName!: string;
  public phoneNumber!: string;
  public isVerified!: boolean;
  public isActive!: boolean;
  public authMethod!: AuthMethod;
  public preferences!: IUserPreferences;
  public roles!: UserRole[];
  public lastLogin!: Date;
  public failedAttempts!: number;
  public securityLog!: Record<string, any>[];
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public lastIpAddress!: string;
  public deviceInfo!: Record<string, any>;

  /**
   * Initialize the User model with enhanced security features
   * @param sequelize - Sequelize instance
   */
  public static initialize(sequelize: Sequelize): void {
    User.init(
      {
        id: {
          type: DataTypes.UUID,
          defaultValue: DataTypes.UUIDV4,
          primaryKey: true,
        },
        email: {
          type: DataTypes.STRING,
          allowNull: false,
          unique: true,
          validate: {
            isEmail: true,
            notEmpty: true,
          },
        },
        password: {
          type: DataTypes.STRING(1024), // Extended length for KMS-encrypted hash
          allowNull: false,
        },
        firstName: {
          type: DataTypes.STRING,
          allowNull: false,
          validate: {
            notEmpty: true,
          },
        },
        lastName: {
          type: DataTypes.STRING,
          allowNull: false,
          validate: {
            notEmpty: true,
          },
        },
        phoneNumber: {
          type: DataTypes.STRING,
          allowNull: true,
          validate: {
            is: /^\+?[\d\s-()]+$/,
          },
        },
        isVerified: {
          type: DataTypes.BOOLEAN,
          defaultValue: false,
        },
        isActive: {
          type: DataTypes.BOOLEAN,
          defaultValue: true,
        },
        authMethod: {
          type: DataTypes.ENUM(...Object.values(AuthMethod)),
          defaultValue: AuthMethod.LOCAL,
        },
        preferences: {
          type: DataTypes.JSONB,
          defaultValue: {},
        },
        roles: {
          type: DataTypes.ARRAY(DataTypes.ENUM(...Object.values(UserRole))),
          defaultValue: [UserRole.USER],
        },
        lastLogin: {
          type: DataTypes.DATE,
        },
        failedAttempts: {
          type: DataTypes.INTEGER,
          defaultValue: 0,
        },
        securityLog: {
          type: DataTypes.JSONB,
          defaultValue: [],
        },
        lastIpAddress: {
          type: DataTypes.STRING,
        },
        deviceInfo: {
          type: DataTypes.JSONB,
          defaultValue: {},
        },
      },
      {
        sequelize,
        tableName: 'users',
        indexes: [
          { unique: true, fields: ['email'] },
          { fields: ['roles'] },
          { fields: ['isActive'] },
        ],
        hooks: {
          beforeCreate: async (user: User) => {
            await User.validateAndHashPassword(user);
            await User.initializeUserDefaults(user);
          },
          beforeUpdate: async (user: User) => {
            await User.handleUserUpdate(user);
          },
        },
      }
    );
  }

  /**
   * Validates and hashes password using AWS KMS integration
   * @param user - User instance
   */
  private static async validateAndHashPassword(user: User): Promise<void> {
    try {
      if (!user.password) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'Password is required'
        );
      }

      // Validate password complexity
      if (!User.validatePasswordComplexity(user.password)) {
        throw createCustomError(
          AUTH_ERRORS.INVALID_CREDENTIALS,
          'Password does not meet complexity requirements'
        );
      }

      // Hash password with AWS KMS integration
      const hashedPassword = await hashNewPassword(user.password, user.id);
      user.password = hashedPassword.hash;

      // Log security event
      user.securityLog = [{
        event: 'PASSWORD_HASH',
        timestamp: new Date(),
        metadata: {
          kmsKeyId: hashedPassword.metadata.kmsKeyId,
        },
      }];
    } catch (error) {
      logger.error('Password processing failed', { error, userId: user.id });
      throw error;
    }
  }

  /**
   * Initializes default user preferences and settings
   * @param user - User instance
   */
  private static async initializeUserDefaults(user: User): Promise<void> {
    user.preferences = {
      notifications: {
        email: true,
        push: true,
        sms: false,
        notificationTypes: ['MESSAGES', 'TRANSACTIONS', 'SECURITY'],
      },
      marketplaceSettings: {
        ebayConnected: false,
        amazonConnected: false,
        walmartConnected: false,
        defaultListingPlatforms: [],
        platformCredentials: {},
      },
      shippingDefaults: {
        address: {
          street: '',
          city: '',
          state: '',
          zipCode: '',
          country: '',
          isVerified: false,
        },
        preferredCarrier: 'USPS',
        autoSchedulePickup: false,
        defaultPackaging: {
          type: 'standard',
          size: 'medium',
          requireSignature: false,
        },
      },
      securitySettings: {
        twoFactorEnabled: false,
        twoFactorMethod: 'SMS',
        loginNotifications: true,
      },
    };
  }

  /**
   * Handles user update operations with security logging
   * @param user - User instance
   */
  private static async handleUserUpdate(user: User): Promise<void> {
    const changed = user.changed();
    if (!changed) return;

    // Handle password updates
    if (changed.includes('password')) {
      await User.validateAndHashPassword(user);
    }

    // Log security-relevant changes
    const securityFields = ['email', 'roles', 'isActive', 'isVerified'];
    const securityChanges = changed.filter(field => securityFields.includes(field));

    if (securityChanges.length > 0) {
      user.securityLog = [
        {
          event: 'PROFILE_UPDATE',
          timestamp: new Date(),
          changes: securityChanges,
        },
        ...(user.securityLog || []),
      ].slice(0, 100); // Keep last 100 security events
    }
  }

  /**
   * Validates password complexity requirements
   * @param password - Password to validate
   */
  private static validatePasswordComplexity(password: string): boolean {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*]/.test(password);

    return (
      password.length >= minLength &&
      hasUpperCase &&
      hasLowerCase &&
      hasNumbers &&
      hasSpecialChar
    );
  }
}