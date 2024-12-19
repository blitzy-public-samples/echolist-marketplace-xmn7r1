/**
 * @fileoverview Marketplace Model Definition
 * Defines MongoDB schemas for marketplace integration data with enhanced security and monitoring
 * @version 1.0.0
 */

import { Schema, model, Document } from 'mongoose'; // ^6.0.0
import {
    IMarketplaceSync,
    IMarketplaceCredentials,
    MarketplacePlatform
} from '../../interfaces/marketplace.interface';
import { SYNC_STATUS } from '../../constants/status.constants';

/**
 * Extended interface for MarketplaceCredentials document with monitoring
 */
export interface IMarketplaceCredentialsDocument extends IMarketplaceCredentials, Document {
    lastRefreshed: Date;
    lastAccessed: Date;
    failedAttempts: number;
    isLocked: boolean;
    lockExpiresAt?: Date;
}

/**
 * Extended interface for MarketplaceSync document with enhanced tracking
 */
export interface IMarketplaceSyncDocument extends IMarketplaceSync, Document {
    retryCount: number;
    lastError?: string;
    syncMetadata: {
        duration: number;
        statusCode?: number;
        requestId?: string;
    };
}

/**
 * Schema for marketplace platform credentials with enhanced security
 */
const MarketplaceCredentialsSchema = new Schema<IMarketplaceCredentialsDocument>({
    platform: {
        type: String,
        enum: Object.values(MarketplacePlatform),
        required: true
    },
    apiKey: {
        type: String,
        required: true,
        select: false, // Prevents API key from being returned in queries by default
        minlength: 32
    },
    secretKey: {
        type: String,
        required: true,
        select: false,
        minlength: 32
    },
    refreshToken: {
        type: String,
        select: false
    },
    lastRefreshed: {
        type: Date,
        default: Date.now
    },
    lastAccessed: {
        type: Date,
        default: Date.now
    },
    failedAttempts: {
        type: Number,
        default: 0
    },
    isLocked: {
        type: Boolean,
        default: false
    },
    lockExpiresAt: {
        type: Date
    }
}, {
    timestamps: true,
    collection: 'marketplace_credentials'
});

/**
 * Schema for marketplace synchronization with monitoring capabilities
 */
const MarketplaceSyncSchema = new Schema<IMarketplaceSyncDocument>({
    listingId: {
        type: String,
        required: true,
        index: true
    },
    platform: {
        type: String,
        enum: Object.values(MarketplacePlatform),
        required: true
    },
    externalId: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: Object.values(SYNC_STATUS),
        required: true,
        default: SYNC_STATUS.PENDING
    },
    lastSyncAttempt: {
        type: Date,
        default: Date.now
    },
    nextSyncAttempt: Date,
    retryCount: {
        type: Number,
        default: 0
    },
    lastError: String,
    syncErrors: [{
        code: String,
        message: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    syncMetadata: {
        duration: Number,
        statusCode: Number,
        requestId: String
    },
    platformSpecificData: {
        type: Map,
        of: Schema.Types.Mixed
    }
}, {
    timestamps: true,
    collection: 'marketplace_syncs'
});

// Indexes for MarketplaceCredentialsSchema
MarketplaceCredentialsSchema.index({ platform: 1, apiKey: 1 }, { unique: true });
MarketplaceCredentialsSchema.index({ lastRefreshed: 1 });
MarketplaceCredentialsSchema.index({ isLocked: 1, lockExpiresAt: 1 });

// Indexes for MarketplaceSyncSchema
MarketplaceSyncSchema.index({ listingId: 1, platform: 1 }, { unique: true });
MarketplaceSyncSchema.index({ platform: 1, externalId: 1 }, { unique: true });
MarketplaceSyncSchema.index({ status: 1, nextSyncAttempt: 1 });
MarketplaceSyncSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days TTL

// Pre-save middleware for credentials
MarketplaceCredentialsSchema.pre('save', function(next) {
    if (this.isModified('failedAttempts') && this.failedAttempts >= 5) {
        this.isLocked = true;
        this.lockExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes lock
    }
    next();
});

// Pre-save middleware for sync
MarketplaceSyncSchema.pre('save', function(next) {
    if (this.isModified('status') && this.status === SYNC_STATUS.FAILED) {
        this.retryCount += 1;
        if (this.retryCount < 5) {
            this.nextSyncAttempt = new Date(Date.now() + Math.pow(2, this.retryCount) * 1000);
        }
    }
    next();
});

// Virtual for checking if credentials are expired
MarketplaceCredentialsSchema.virtual('isExpired').get(function() {
    return this.lastRefreshed < new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
});

// Method to safely update credentials
MarketplaceCredentialsSchema.methods.updateCredentials = async function(
    newCredentials: Partial<IMarketplaceCredentials>
) {
    if (this.isLocked && this.lockExpiresAt > new Date()) {
        throw new Error('Credentials are locked due to multiple failed attempts');
    }
    Object.assign(this, newCredentials);
    this.lastRefreshed = new Date();
    this.failedAttempts = 0;
    this.isLocked = false;
    return this.save();
};

// Export models
export const MarketplaceCredentials = model<IMarketplaceCredentialsDocument>(
    'MarketplaceCredentials',
    MarketplaceCredentialsSchema
);

export const MarketplaceSync = model<IMarketplaceSyncDocument>(
    'MarketplaceSync',
    MarketplaceSyncSchema
);