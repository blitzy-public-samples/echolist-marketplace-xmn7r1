/**
 * @fileoverview Migration to create marketplace_sync table for tracking listing synchronization
 * across multiple external marketplaces (eBay, Amazon, Walmart)
 * @version 1.0.0
 */

import { QueryInterface, DataTypes } from 'sequelize'; // ^6.0.0
import { MarketplacePlatform } from '../../interfaces/marketplace.interface';
import { SYNC_STATUS } from '../../constants/status.constants';

/**
 * Migration to create marketplace_sync table
 */
export default {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    // Create custom enum types
    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_marketplace_platform" AS ENUM (
        '${MarketplacePlatform.EBAY}',
        '${MarketplacePlatform.AMAZON}',
        '${MarketplacePlatform.WALMART}'
      );
    `);

    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_sync_status" AS ENUM (
        '${SYNC_STATUS.PENDING}',
        '${SYNC_STATUS.SYNCED}',
        '${SYNC_STATUS.FAILED}'
      );
    `);

    // Create marketplace_sync table
    await queryInterface.createTable('marketplace_sync', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
        comment: 'Primary key for marketplace sync records'
      },
      listing_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: 'listings',
          key: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        comment: 'Foreign key to listings table with cascade delete'
      },
      platform: {
        type: DataTypes.ENUM,
        values: Object.values(MarketplacePlatform),
        allowNull: false,
        comment: 'Marketplace platform identifier'
      },
      external_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Platform-specific listing identifier'
      },
      external_url: {
        type: DataTypes.STRING(2048),
        allowNull: true,
        comment: 'URL to listing on external marketplace'
      },
      status: {
        type: DataTypes.ENUM,
        values: Object.values(SYNC_STATUS),
        allowNull: false,
        defaultValue: SYNC_STATUS.PENDING,
        comment: 'Current sync status of the listing'
      },
      errors: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Detailed error information for failed syncs'
      },
      last_synced: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of last successful sync'
      },
      next_sync_attempt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Scheduled timestamp for next sync attempt'
      },
      platform_specific_data: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Platform-specific metadata and configuration'
      },
      sync_priority: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Priority level for sync operations'
      },
      auto_sync: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Whether automatic sync is enabled'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Record creation timestamp'
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Record last update timestamp'
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Soft delete timestamp'
      }
    }, {
      comment: 'Tracks synchronization status of listings across multiple marketplaces'
    });

    // Create indexes for performance optimization
    await queryInterface.addIndex('marketplace_sync', ['listing_id', 'platform'], {
      name: 'marketplace_sync_listing_platform',
      unique: true,
      comment: 'Ensures unique listing-platform combinations'
    });

    await queryInterface.addIndex('marketplace_sync', ['external_id', 'platform'], {
      name: 'marketplace_sync_external_id',
      unique: true,
      comment: 'Ensures unique external IDs per platform'
    });

    await queryInterface.addIndex('marketplace_sync', ['status', 'next_sync_attempt'], {
      name: 'marketplace_sync_status_next',
      comment: 'Optimizes sync queue queries'
    });

    await queryInterface.addIndex('marketplace_sync', ['sync_priority', 'status'], {
      name: 'marketplace_sync_priority',
      comment: 'Optimizes priority-based sync processing'
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    // Drop indexes
    await queryInterface.removeIndex('marketplace_sync', 'marketplace_sync_listing_platform');
    await queryInterface.removeIndex('marketplace_sync', 'marketplace_sync_external_id');
    await queryInterface.removeIndex('marketplace_sync', 'marketplace_sync_status_next');
    await queryInterface.removeIndex('marketplace_sync', 'marketplace_sync_priority');

    // Drop table
    await queryInterface.dropTable('marketplace_sync');

    // Drop custom enum types
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_marketplace_platform" CASCADE;');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_sync_status" CASCADE;');
  }
};