import { QueryInterface, DataTypes } from 'sequelize';
import { IUser } from '../../interfaces/user.interface';

/**
 * Database migration for creating the users table
 * Implements comprehensive user management with secure authentication
 * and role-based access control for the EchoList platform
 * @version 1.0.0
 */
export default {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    // Enable UUID extension for PostgreSQL if not already enabled
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await queryInterface.createTable('users', {
      // Primary identifier using UUID for security and scalability
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
        comment: 'Unique identifier for the user'
      },

      // Authentication fields
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
          notEmpty: true
        },
        comment: 'User email address for authentication and communication'
      },
      password: {
        type: DataTypes.STRING(1024),
        allowNull: false,
        comment: 'Securely hashed password using bcrypt'
      },

      // Personal information
      firstName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: true
        },
        comment: 'User first name'
      },
      lastName: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
          notEmpty: true
        },
        comment: 'User last name'
      },
      phoneNumber: {
        type: DataTypes.STRING(15),
        allowNull: true,
        unique: true,
        validate: {
          is: /^\+[1-9]\d{1,14}$/, // E.164 format validation
        },
        comment: 'User phone number in E.164 format'
      },

      // Account status flags
      isVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false,
        comment: 'Indicates if user email/phone is verified'
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        comment: 'Indicates if user account is active'
      },

      // Authentication method tracking
      authMethod: {
        type: DataTypes.ENUM('LOCAL', 'OAUTH', 'SERVICE'),
        defaultValue: 'LOCAL',
        allowNull: false,
        comment: 'Authentication method used by the user'
      },

      // OAuth providers data
      oauthProviders: {
        type: DataTypes.JSONB,
        defaultValue: [],
        allowNull: false,
        comment: 'OAuth provider credentials and tokens'
      },

      // User preferences and settings
      preferences: {
        type: DataTypes.JSONB,
        defaultValue: {
          notifications: {
            email: true,
            push: true,
            sms: false,
            notificationTypes: ['MESSAGES', 'TRANSACTIONS']
          },
          marketplaceSettings: {
            ebayConnected: false,
            amazonConnected: false,
            walmartConnected: false,
            defaultListingPlatforms: [],
            platformCredentials: {}
          },
          shippingDefaults: {
            preferredCarrier: 'USPS',
            autoSchedulePickup: false
          },
          securitySettings: {
            twoFactorEnabled: false,
            twoFactorMethod: 'SMS',
            loginNotifications: true
          }
        },
        allowNull: false,
        comment: 'User preferences and platform settings'
      },

      // Role-based access control
      roles: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: ['USER'],
        allowNull: false,
        comment: 'User roles for access control'
      },

      // Activity tracking
      lastLogin: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of last successful login'
      },

      // Timestamps
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Timestamp of user creation'
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        comment: 'Timestamp of last user update'
      }
    }, {
      comment: 'Stores user accounts and authentication data for the EchoList platform'
    });

    // Create optimized indexes
    await queryInterface.addIndex('users', ['email'], {
      name: 'users_email_idx',
      unique: true,
      using: 'BTREE'
    });

    await queryInterface.addIndex('users', ['phoneNumber'], {
      name: 'users_phone_idx',
      unique: true,
      using: 'BTREE',
      where: {
        phoneNumber: {
          [Symbol.for('ne')]: null
        }
      }
    });

    await queryInterface.addIndex('users', ['isActive', 'isVerified'], {
      name: 'users_status_idx',
      using: 'BTREE'
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // Drop indexes first
    await queryInterface.removeIndex('users', 'users_email_idx');
    await queryInterface.removeIndex('users', 'users_phone_idx');
    await queryInterface.removeIndex('users', 'users_status_idx');

    // Drop the users table
    await queryInterface.dropTable('users');

    // Remove the UUID extension if no other tables need it
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS "uuid-ossp";');
  }
};