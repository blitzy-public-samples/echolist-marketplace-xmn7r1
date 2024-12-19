/**
 * User Interface Definitions
 * Defines the core data structures for user management in the EchoList platform
 * @version 1.0.0
 */

/**
 * Authentication methods supported by the platform
 */
export enum AuthMethod {
    LOCAL = 'LOCAL',
    OAUTH = 'OAUTH',
    SERVICE = 'SERVICE'
}

/**
 * OAuth provider configuration interface
 */
export interface OAuthProvider {
    provider: string;
    providerId: string;
    accessToken: string;
    refreshToken: string;
}

/**
 * Two-factor authentication methods
 */
export enum TwoFactorMethod {
    SMS = 'SMS',
    EMAIL = 'EMAIL',
    AUTHENTICATOR = 'AUTHENTICATOR'
}

/**
 * Security settings configuration
 */
export interface SecuritySettings {
    twoFactorEnabled: boolean;
    twoFactorMethod: TwoFactorMethod;
    loginNotifications: boolean;
}

/**
 * Notification types supported by the platform
 */
export enum NotificationType {
    MESSAGES = 'MESSAGES',
    TRANSACTIONS = 'TRANSACTIONS',
    LISTINGS = 'LISTINGS',
    SECURITY = 'SECURITY'
}

/**
 * User notification preferences
 */
export interface NotificationPreferences {
    email: boolean;
    push: boolean;
    sms: boolean;
    notificationTypes: NotificationType[];
}

/**
 * Marketplace platform credential storage
 */
export interface PlatformCredential {
    apiKey: string;
    secretKey: string;
    expiresAt: Date;
}

/**
 * Marketplace integration settings
 */
export interface MarketplaceSettings {
    ebayConnected: boolean;
    amazonConnected: boolean;
    walmartConnected: boolean;
    defaultListingPlatforms: string[];
    platformCredentials: Record<string, PlatformCredential>;
}

/**
 * Shipping packaging preferences
 */
export interface PackagingPreference {
    type: string;
    size: string;
    requireSignature: boolean;
}

/**
 * Address structure with verification status
 */
export interface Address {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    isVerified: boolean;
}

/**
 * Default shipping configuration
 */
export interface ShippingDefaults {
    address: Address;
    preferredCarrier: string;
    autoSchedulePickup: boolean;
    defaultPackaging: PackagingPreference;
}

/**
 * Comprehensive user preferences configuration
 */
export interface IUserPreferences {
    notifications: NotificationPreferences;
    marketplaceSettings: MarketplaceSettings;
    shippingDefaults: ShippingDefaults;
    securitySettings: SecuritySettings;
}

/**
 * User roles for access control
 */
export enum UserRole {
    USER = 'USER',
    ADMIN = 'ADMIN',
    MODERATOR = 'MODERATOR',
    SUPPORT = 'SUPPORT'
}

/**
 * Core user interface with comprehensive authentication and security features
 */
export interface IUser {
    id: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    isVerified: boolean;
    isActive: boolean;
    authMethod: AuthMethod;
    oauthProviders: OAuthProvider[];
    preferences: IUserPreferences;
    roles: UserRole[];
    lastLogin: Date;
    createdAt: Date;
    updatedAt: Date;
}