/**
 * @fileoverview Defines TypeScript interfaces and enums for shipping-related operations
 * including USPS label generation, pickup scheduling, box delivery service, and tracking updates.
 */

/**
 * Available USPS shipping service types
 */
export enum USPSServiceType {
    PRIORITY = 'PRIORITY',
    FIRST_CLASS = 'FIRST_CLASS',
    GROUND = 'GROUND'
}

/**
 * Available USPS box types for delivery service
 */
export enum USPSBoxType {
    SMALL = 'SMALL',
    MEDIUM = 'MEDIUM',
    LARGE = 'LARGE'
}

/**
 * Available time windows for pickup scheduling
 */
export enum PickupTimeWindow {
    MORNING = 'MORNING',
    AFTERNOON = 'AFTERNOON'
}

/**
 * Possible statuses for pickup requests
 */
export enum PickupStatus {
    SCHEDULED = 'SCHEDULED',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED'
}

/**
 * Possible statuses for box delivery requests
 */
export enum DeliveryStatus {
    REQUESTED = 'REQUESTED',
    IN_TRANSIT = 'IN_TRANSIT',
    DELIVERED = 'DELIVERED'
}

/**
 * Possible statuses for package tracking
 */
export enum TrackingStatus {
    ACCEPTED = 'ACCEPTED',
    IN_TRANSIT = 'IN_TRANSIT',
    OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
    DELIVERED = 'DELIVERED',
    EXCEPTION = 'EXCEPTION'
}

/**
 * Address structure used across shipping interfaces
 */
interface IAddress {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
}

/**
 * Package dimensions structure
 */
interface IDimensions {
    length: number;
    width: number;
    height: number;
    unit: 'in' | 'cm';
}

/**
 * Interface for shipping label generation and management
 */
export interface IShippingLabel {
    id: string;
    transactionId: string;
    serviceType: USPSServiceType;
    fromAddress: IAddress;
    toAddress: IAddress;
    weight: number;
    dimensions: IDimensions;
    cost: number;
    labelFormat: 'PDF' | 'ZPL' | 'PNG';
    labelUrl: string;
    trackingNumber: string;
    refundStatus: 'NONE' | 'REQUESTED' | 'APPROVED' | 'REJECTED';
    createdAt: Date;
}

/**
 * Interface for USPS pickup scheduling
 */
export interface IShippingPickup {
    id: string;
    userId: string;
    pickupDate: Date;
    timeWindow: PickupTimeWindow;
    address: IAddress;
    packageCount: number;
    packageDetails: Array<{
        weight: number;
        type: string;
    }>;
    specialInstructions: string;
    status: PickupStatus;
    confirmationNumber: string;
}

/**
 * Interface for USPS box delivery service requests
 */
export interface IBoxDelivery {
    id: string;
    userId: string;
    boxType: USPSBoxType;
    quantity: number;
    deliveryAddress: IAddress;
    deliveryInstructions: string;
    preferredDeliveryDate: Date;
    status: DeliveryStatus;
    requestDate: Date;
    trackingNumber: string;
}

/**
 * Interface for package tracking updates
 */
export interface ITrackingUpdate {
    trackingNumber: string;
    status: TrackingStatus;
    location: string;
    timestamp: Date;
    description: string;
    estimatedDeliveryDate: Date;
    exceptionDetails: string;
}