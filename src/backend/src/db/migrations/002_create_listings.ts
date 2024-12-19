/**
 * @fileoverview Database migration for creating the listings table with comprehensive support
 * for multi-platform marketplace integration, AI-powered features, and advanced querying capabilities.
 * @version 1.0.0
 */

import { QueryInterface, DataTypes } from 'sequelize';
import { LISTING_STATUS } from '../../constants/status.constants';

/**
 * Migration to create the listings table
 */
export default {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.createTable('listings', {
      // Primary Identification
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        comment: 'Unique identifier for the listing'
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onDelete: 'CASCADE',
        comment: 'Reference to the user who created the listing'
      },

      // Basic Listing Information
      title: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Listing title optimized for marketplace search'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Detailed listing description'
      },
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        validate: {
          min: 0
        },
        comment: 'Listing price in USD'
      },
      condition: {
        type: DataTypes.ENUM('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'),
        allowNull: false,
        comment: 'Item condition classification'
      },

      // Status and Visibility
      status: {
        type: DataTypes.ENUM(...Object.values(LISTING_STATUS)),
        defaultValue: LISTING_STATUS.DRAFT,
        allowNull: false,
        comment: 'Current listing status'
      },
      visibility: {
        type: DataTypes.ENUM('PUBLIC', 'PRIVATE', 'UNLISTED'),
        defaultValue: 'PUBLIC',
        allowNull: false,
        comment: 'Listing visibility control'
      },

      // Categorization
      categoryId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'categories',
          key: 'id'
        },
        comment: 'Reference to item category'
      },

      // Media and Dimensions
      images: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: [],
        comment: 'Array of image URLs'
      },
      dimensions: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'AI-estimated item dimensions (length, width, height, weight)'
      },

      // AI and Marketplace Integration
      aiData: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'AI processing results including recognition and categorization'
      },
      marketplaceData: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'Platform-specific listing details and sync status'
      },
      shippingInfo: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'Shipping options, requirements, and restrictions'
      },

      // Timestamps
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false
      }
    });

    // Create indexes for efficient querying
    await queryInterface.addIndex('listings', ['userId'], {
      name: 'listings_user_id_idx',
      comment: "Index for user's listings lookup"
    });

    await queryInterface.addIndex('listings', ['status'], {
      name: 'listings_status_idx',
      comment: 'Index for status filtering'
    });

    await queryInterface.addIndex('listings', ['categoryId'], {
      name: 'listings_category_id_idx',
      comment: 'Index for category filtering'
    });

    await queryInterface.addIndex('listings', ['createdAt'], {
      name: 'listings_created_at_idx',
      comment: 'Index for timestamp-based queries'
    });

    // Partial index for active listings
    await queryInterface.sequelize.query(`
      CREATE INDEX listings_active_price_idx ON listings (price)
      WHERE status = '${LISTING_STATUS.ACTIVE}'
    `);

    // GIN indexes for JSONB columns
    await queryInterface.sequelize.query(`
      CREATE INDEX listings_marketplace_gin_idx ON listings USING GIN (marketplaceData);
      CREATE INDEX listings_ai_gin_idx ON listings USING GIN (aiData);
    `);
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // Drop indexes first
    await queryInterface.removeIndex('listings', 'listings_user_id_idx');
    await queryInterface.removeIndex('listings', 'listings_status_idx');
    await queryInterface.removeIndex('listings', 'listings_category_id_idx');
    await queryInterface.removeIndex('listings', 'listings_created_at_idx');
    await queryInterface.removeIndex('listings', 'listings_active_price_idx');
    await queryInterface.removeIndex('listings', 'listings_marketplace_gin_idx');
    await queryInterface.removeIndex('listings', 'listings_ai_gin_idx');

    // Drop the table
    await queryInterface.dropTable('listings');
  }
};