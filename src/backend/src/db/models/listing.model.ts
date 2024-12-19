/**
 * @fileoverview Sequelize model definition for the Listing entity in the EchoList platform.
 * Implements comprehensive listing functionality including multi-platform marketplace integration,
 * AI-powered features, shipping management, and advanced data validation.
 * @version 1.0.0
 */

import { Model, DataTypes, ValidationError } from 'sequelize'; // ^6.32.0
import { IListing, Dimensions, AIData, ShippingDetails, IMarketplaceSync } from '../../interfaces/listing.interface';
import { LISTING_STATUS } from '../../constants/status.constants';
import sequelize from '../../config/database.config';

/**
 * Enhanced Listing model class extending Sequelize.Model
 * Implements comprehensive marketplace integration and AI features
 */
class Listing extends Model<IListing> {
  public id!: string;
  public userId!: string;
  public title!: string;
  public description!: string;
  public price!: number;
  public status!: LISTING_STATUS;
  public images!: string[];
  public dimensions!: Dimensions;
  public aiData!: AIData;
  public shipping!: ShippingDetails;
  public marketplaceSyncs!: IMarketplaceSync[];
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public readonly deletedAt!: Date | null;

  /**
   * Define model associations with related entities
   */
  public static associate(models: any): void {
    Listing.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'seller',
      onDelete: 'CASCADE'
    });

    Listing.hasMany(models.MarketplaceSync, {
      foreignKey: 'listingId',
      as: 'syncRecords'
    });

    Listing.hasMany(models.ListingAnalytics, {
      foreignKey: 'listingId',
      as: 'analytics'
    });
  }
}

/**
 * Initialize Listing model with comprehensive schema definition
 */
Listing.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        len: [3, 255],
        notEmpty: true
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        len: [10, 5000],
        notEmpty: true
      }
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01,
        max: 999999.99
      }
    },
    status: {
      type: DataTypes.ENUM(...Object.values(LISTING_STATUS)),
      allowNull: false,
      defaultValue: LISTING_STATUS.DRAFT
    },
    images: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
      validate: {
        isValidImageArray(value: string[]) {
          if (!Array.isArray(value)) {
            throw new Error('Images must be an array');
          }
          if (value.length === 0) {
            throw new Error('At least one image is required');
          }
          if (value.length > 12) {
            throw new Error('Maximum 12 images allowed');
          }
          value.forEach(url => {
            if (!url.match(/^https:\/\/.*\.(jpg|jpeg|png|webp)$/i)) {
              throw new Error('Invalid image URL format');
            }
          });
        }
      }
    },
    dimensions: {
      type: DataTypes.JSONB,
      allowNull: true,
      validate: {
        isValidDimensions(value: Dimensions) {
          if (!value) return;
          if (!value.length || !value.width || !value.height || !value.unit) {
            throw new Error('Invalid dimensions format');
          }
          if (!['in', 'cm'].includes(value.unit)) {
            throw new Error('Invalid dimension unit');
          }
        }
      }
    },
    aiData: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    shipping: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {
        offersShipping: false,
        localPickup: true
      },
      validate: {
        isValidShipping(value: ShippingDetails) {
          if (!value.offersShipping && !value.localPickup) {
            throw new Error('Must offer either shipping or local pickup');
          }
          if (value.offersShipping && !value.weight) {
            throw new Error('Weight is required for shipping');
          }
        }
      }
    },
    marketplaceSyncs: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    }
  },
  {
    sequelize,
    tableName: 'listings',
    paranoid: true,
    indexes: [
      {
        name: 'listings_user_id_idx',
        fields: ['userId']
      },
      {
        name: 'listings_status_idx',
        fields: ['status']
      },
      {
        name: 'listings_price_idx',
        fields: ['price']
      },
      {
        name: 'listings_created_at_idx',
        fields: ['createdAt']
      }
    ]
  }
);

/**
 * Pre-validation hook for comprehensive data validation
 */
Listing.beforeValidate(async (listing: Listing) => {
  // Validate price format and range
  if (listing.price) {
    const priceStr = listing.price.toString();
    if (priceStr.split('.')[1]?.length > 2) {
      throw new ValidationError('Price cannot have more than 2 decimal places');
    }
  }

  // Validate required fields based on status
  if (listing.status === LISTING_STATUS.ACTIVE) {
    if (!listing.images?.length) {
      throw new ValidationError('Active listings must have at least one image');
    }
    if (!listing.description) {
      throw new ValidationError('Active listings must have a description');
    }
  }

  // Validate marketplace syncs structure
  if (listing.marketplaceSyncs) {
    listing.marketplaceSyncs.forEach(sync => {
      if (!sync.platform || !sync.status) {
        throw new ValidationError('Invalid marketplace sync configuration');
      }
    });
  }
});

/**
 * Pre-creation hook for data initialization and processing
 */
Listing.beforeCreate(async (listing: Listing) => {
  // Set default status if not provided
  if (!listing.status) {
    listing.status = LISTING_STATUS.DRAFT;
  }

  // Initialize empty arrays/objects if not provided
  listing.images = listing.images || [];
  listing.marketplaceSyncs = listing.marketplaceSyncs || [];
  listing.dimensions = listing.dimensions || { length: 0, width: 0, height: 0, unit: 'in' };

  // Ensure shipping configuration
  listing.shipping = {
    offersShipping: false,
    localPickup: true,
    ...listing.shipping
  };
});

export default Listing;