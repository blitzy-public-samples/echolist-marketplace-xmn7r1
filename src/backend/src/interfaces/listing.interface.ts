/**
 * @fileoverview Listing Interface Definitions
 * Defines core data structures for listing management in the EchoList platform
 * @version 1.0.0
 */

import { Document } from 'mongoose'; // ^6.0.0
import { IUser } from './user.interface';
import { LISTING_STATUS, SYNC_STATUS } from '../constants/status.constants';

/**
 * Supported marketplace platforms for listing synchronization
 */
export type MarketplacePlatform = 'EBAY' | 'AMAZON' | 'WALMART';

/**
 * Dimensions specification with standardized units
 */
export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: 'in' | 'cm';
}

/**
 * AI-powered image analysis results
 */
export interface ImageAnalysis {
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
  detectedObjects: string[];
  colors: string[];
  qualityScore: number;
  hasBranding: boolean;
}

/**
 * AI-generated data and insights for listings
 */
export interface AIData {
  categories: string[];
  tags: string[];
  imageAnalysis: ImageAnalysis;
  suggestedPrice: number;
  similarListings: string[];
  marketInsights: {
    demandScore?: number;
    competitivePricing?: {
      min: number;
      max: number;
      average: number;
    };
    seasonalTrends?: {
      trending: boolean;
      peakSeason: string[];
    };
  };
}

/**
 * Shipping configuration and requirements
 */
export interface ShippingDetails {
  offersShipping: boolean;
  localPickup: boolean;
  weight: number;
  weightUnit: 'oz' | 'lb' | 'kg';
  shippingMethods: string[];
  dimensions: Dimensions;
  estimatedShippingCost: number;
  restrictedLocations: string[];
}

/**
 * Platform-specific data for marketplace synchronization
 */
export interface PlatformSpecificData {
  categoryId: string;
  attributes: string[];
  pricing: {
    listPrice?: number;
    salePrice?: number;
    minimumPrice?: number;
  };
  inventory: {
    quantity: number;
    sku?: string;
    restockDate?: Date;
  };
}

/**
 * Marketplace synchronization tracking
 */
export interface IMarketplaceSync {
  platform: MarketplacePlatform;
  externalId: string;
  externalUrl: string;
  status: SYNC_STATUS;
  lastSyncedAt: Date;
  syncErrors: string[];
  platformSpecificData: PlatformSpecificData;
  autoSync: boolean;
  syncPriority: number;
}

/**
 * Core listing interface extending Mongoose Document
 */
export interface IListing extends Document {
  id: string;
  userId: string;
  title: string;
  description: string;
  price: number;
  status: LISTING_STATUS;
  images: string[];
  dimensions: Dimensions;
  aiData: AIData;
  shipping: ShippingDetails;
  marketplaceSyncs: IMarketplaceSync[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface for creating new listings with optional AI-generated fields
 */
export interface IListingCreationAttributes {
  userId: string;
  title: string;
  description: string;
  price: number;
  images?: string[];
  dimensions?: Dimensions;
  shipping?: ShippingDetails;
  marketplacePlatforms?: MarketplacePlatform[];
  aiGeneratedData?: Partial<AIData>;
  enableAutoSync: boolean;
  targetMarketplaces: MarketplacePlatform[];
}

/**
 * Interface for listing update operations
 */
export interface IListingUpdateAttributes extends Partial<IListingCreationAttributes> {
  status?: LISTING_STATUS;
  marketplaceSyncs?: Partial<IMarketplaceSync>[];
}

/**
 * Interface for listing search and filtering
 */
export interface IListingSearchCriteria {
  userId?: string;
  status?: LISTING_STATUS | LISTING_STATUS[];
  priceRange?: {
    min?: number;
    max?: number;
  };
  categories?: string[];
  platforms?: MarketplacePlatform[];
  createdAfter?: Date;
  createdBefore?: Date;
  hasLocalPickup?: boolean;
  hasShipping?: boolean;
  sortBy?: 'price' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Type guard to check if a platform is supported
 */
export const isSupportedPlatform = (platform: string): platform is MarketplacePlatform => {
  return ['EBAY', 'AMAZON', 'WALMART'].includes(platform);
};

/**
 * Type guard for valid listing dimensions
 */
export const isValidDimensions = (dimensions: Partial<Dimensions>): dimensions is Dimensions => {
  return (
    typeof dimensions.length === 'number' &&
    typeof dimensions.width === 'number' &&
    typeof dimensions.height === 'number' &&
    ['in', 'cm'].includes(dimensions.unit)
  );
};