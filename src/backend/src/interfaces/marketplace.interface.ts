/**
 * @fileoverview Marketplace Interface Definitions
 * Defines core data structures for marketplace integrations and synchronization
 * @version 1.0.0
 */

import { Document } from 'mongoose'; // ^6.0.0
import { IListing } from './listing.interface';
import { SYNC_STATUS } from '../constants/status.constants';

/**
 * Supported marketplace platforms
 */
export enum MarketplacePlatform {
    EBAY = 'EBAY',
    AMAZON = 'AMAZON',
    WALMART = 'WALMART'
}

/**
 * API rate limiting configuration
 */
interface RateLimitConfig {
    requestsPerSecond: number;
    burstLimit: number;
    cooldownPeriod: number; // in milliseconds
}

/**
 * Version information for marketplace API
 */
interface APIVersion {
    major: number;
    minor: number;
    patch: number;
}

/**
 * Marketplace platform configuration
 */
export interface IMarketplaceConfig {
    platform: MarketplacePlatform;
    apiEndpoint: string;
    webhookEndpoint: string;
    version: APIVersion;
    rateLimit: RateLimitConfig;
}

/**
 * Authentication credentials for marketplace APIs
 */
export interface IMarketplaceCredentials {
    platform: MarketplacePlatform;
    apiKey: string;
    secretKey: string;
    refreshToken?: string;
    expiresAt?: Date;
    scopes?: string[];
}

/**
 * Price synchronization configuration
 */
interface PriceSyncConfig {
    strategy: 'match' | 'undercut' | 'markup';
    markup: number;
    roundingRule: 'nearest' | 'up' | 'down';
    minimumPrice: number;
}

/**
 * Marketplace synchronization options
 */
export interface IMarketplaceSyncOptions {
    autoSync: boolean;
    syncInterval: number; // in milliseconds
    fieldsToSync: string[];
    priceSync: PriceSyncConfig;
}

/**
 * Response metadata from marketplace APIs
 */
interface ResponseMetadata {
    platformSpecific: any;
    timestamp: Date;
    requestId: string;
}

/**
 * Standardized marketplace API response
 */
export interface IMarketplaceResponse {
    externalId: string;
    externalUrl: string;
    success: boolean;
    errors?: string[];
    metadata: ResponseMetadata;
}

/**
 * Marketplace synchronization record
 */
export interface IMarketplaceSync extends Document {
    listingId: string;
    platform: MarketplacePlatform;
    externalId: string;
    status: SYNC_STATUS;
    lastSyncAttempt: Date;
    nextSyncAttempt?: Date;
    syncErrors: Array<{
        code: string;
        message: string;
        timestamp: Date;
    }>;
    platformSpecificData: {
        categoryId?: string;
        variantId?: string;
        inventoryId?: string;
        [key: string]: any;
    };
}

/**
 * Marketplace inventory sync status
 */
export interface IInventorySync {
    quantity: number;
    reserved: number;
    available: number;
    lastUpdated: Date;
    threshold: number;
    autoRestock: boolean;
}

/**
 * Marketplace category mapping
 */
export interface ICategoryMapping {
    localCategory: string;
    platformCategory: {
        id: string;
        name: string;
        path: string[];
    };
    attributes: Array<{
        name: string;
        required: boolean;
        values: string[];
    }>;
}

/**
 * Global marketplace configuration constants
 */
export const MARKETPLACE_SYNC_INTERVAL = 300000; // 5 minutes
export const MARKETPLACE_API_TIMEOUT = 30000; // 30 seconds

/**
 * Type guard to check if platform is supported
 */
export const isSupportedMarketplace = (platform: string): platform is MarketplacePlatform => {
    return Object.values(MarketplacePlatform).includes(platform as MarketplacePlatform);
};

/**
 * Type guard for valid marketplace credentials
 */
export const isValidCredentials = (credentials: Partial<IMarketplaceCredentials>): credentials is IMarketplaceCredentials => {
    return (
        !!credentials.platform &&
        !!credentials.apiKey &&
        !!credentials.secretKey &&
        isSupportedMarketplace(credentials.platform)
    );
};