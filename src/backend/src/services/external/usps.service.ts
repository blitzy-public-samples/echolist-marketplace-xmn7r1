import axios, { AxiosInstance } from 'axios';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import * as cacheManager from 'cache-manager';
import { logger } from '../../utils/logger.util';
import {
  IShippingLabel,
  IShippingPickup,
  IBoxDelivery,
  ITrackingUpdate,
  USPSServiceType,
  USPSBoxType,
  PickupTimeWindow,
  PickupStatus,
  DeliveryStatus,
  TrackingStatus
} from '../../interfaces/shipping.interface';

/**
 * @version 1.0.0
 * @description Service handling all USPS API integrations with enhanced reliability,
 * caching, rate limiting, and comprehensive error handling.
 */
export class USPSService {
  private readonly apiUrl: string;
  private readonly userId: string;
  private readonly apiKey: string;
  private readonly axiosInstance: AxiosInstance;
  private readonly cache: cacheManager.Cache;
  private readonly rateLimiter: RateLimiterMemory;

  constructor() {
    // Validate required environment variables
    if (!process.env.USPS_API_URL || !process.env.USPS_USER_ID || !process.env.USPS_API_KEY) {
      throw new Error('Missing required USPS API configuration');
    }

    this.apiUrl = process.env.USPS_API_URL;
    this.userId = process.env.USPS_USER_ID;
    this.apiKey = process.env.USPS_API_KEY;

    // Initialize axios instance with defaults
    this.axiosInstance = axios.create({
      baseURL: this.apiUrl,
      timeout: Number(process.env.USPS_API_TIMEOUT) || 5000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'EchoList/1.0'
      }
    });

    // Initialize cache
    this.cache = cacheManager.caching({
      store: 'memory',
      ttl: Number(process.env.USPS_CACHE_TTL) || 300, // 5 minutes default
      max: 1000
    });

    // Initialize rate limiter (500 requests per minute)
    this.rateLimiter = new RateLimiterMemory({
      points: 500,
      duration: 60
    });
  }

  /**
   * Generates a shipping label through USPS API
   * @param labelData Shipping label request data
   * @returns Promise<IShippingLabel> Generated label with tracking number
   */
  public async generateLabel(labelData: IShippingLabel): Promise<IShippingLabel> {
    try {
      await this.rateLimiter.consume('generateLabel', 1);

      const formattedRequest = this.formatLabelRequest(labelData);
      const signedRequest = await this.signRequest(formattedRequest);

      const response = await this.executeWithRetry(async () => {
        return this.axiosInstance.post('/shipping/label', signedRequest);
      });

      if (!response.data?.label) {
        throw new Error('Invalid label response from USPS API');
      }

      const processedLabel: IShippingLabel = {
        ...labelData,
        labelUrl: response.data.label.url,
        trackingNumber: response.data.label.trackingNumber,
        cost: response.data.label.cost,
        createdAt: new Date()
      };

      logger.info('Shipping label generated successfully', {
        trackingNumber: processedLabel.trackingNumber,
        serviceType: processedLabel.serviceType
      });

      return processedLabel;
    } catch (error) {
      await this.handleApiError(error, 'Label Generation');
      throw error;
    }
  }

  /**
   * Schedules a USPS pickup
   * @param pickupData Pickup request data
   * @returns Promise<IShippingPickup> Confirmed pickup details
   */
  public async schedulePickup(pickupData: IShippingPickup): Promise<IShippingPickup> {
    try {
      await this.rateLimiter.consume('schedulePickup', 1);

      const formattedRequest = this.formatPickupRequest(pickupData);
      const signedRequest = await this.signRequest(formattedRequest);

      const response = await this.executeWithRetry(async () => {
        return this.axiosInstance.post('/shipping/pickup', signedRequest);
      });

      if (!response.data?.confirmationNumber) {
        throw new Error('Invalid pickup response from USPS API');
      }

      const confirmedPickup: IShippingPickup = {
        ...pickupData,
        confirmationNumber: response.data.confirmationNumber,
        status: PickupStatus.SCHEDULED
      };

      logger.info('Pickup scheduled successfully', {
        confirmationNumber: confirmedPickup.confirmationNumber,
        pickupDate: confirmedPickup.pickupDate
      });

      return confirmedPickup;
    } catch (error) {
      await this.handleApiError(error, 'Pickup Scheduling');
      throw error;
    }
  }

  /**
   * Requests USPS box delivery
   * @param deliveryData Box delivery request data
   * @returns Promise<IBoxDelivery> Box delivery confirmation
   */
  public async requestBoxDelivery(deliveryData: IBoxDelivery): Promise<IBoxDelivery> {
    try {
      await this.rateLimiter.consume('requestBoxDelivery', 1);

      const formattedRequest = this.formatBoxDeliveryRequest(deliveryData);
      const signedRequest = await this.signRequest(formattedRequest);

      const response = await this.executeWithRetry(async () => {
        return this.axiosInstance.post('/shipping/supplies', signedRequest);
      });

      if (!response.data?.trackingNumber) {
        throw new Error('Invalid box delivery response from USPS API');
      }

      const confirmedDelivery: IBoxDelivery = {
        ...deliveryData,
        trackingNumber: response.data.trackingNumber,
        status: DeliveryStatus.REQUESTED,
        requestDate: new Date()
      };

      logger.info('Box delivery requested successfully', {
        trackingNumber: confirmedDelivery.trackingNumber,
        boxType: confirmedDelivery.boxType
      });

      return confirmedDelivery;
    } catch (error) {
      await this.handleApiError(error, 'Box Delivery Request');
      throw error;
    }
  }

  /**
   * Retrieves tracking updates for a package
   * @param trackingNumber USPS tracking number
   * @returns Promise<ITrackingUpdate[]> Array of tracking updates
   */
  public async getTrackingUpdates(trackingNumber: string): Promise<ITrackingUpdate[]> {
    try {
      // Check cache first
      const cachedUpdates = await this.cache.get<ITrackingUpdate[]>(trackingNumber);
      if (cachedUpdates) {
        return cachedUpdates;
      }

      await this.rateLimiter.consume('getTrackingUpdates', 1);

      const formattedRequest = this.formatTrackingRequest(trackingNumber);
      const signedRequest = await this.signRequest(formattedRequest);

      const response = await this.executeWithRetry(async () => {
        return this.axiosInstance.get('/tracking', { params: signedRequest });
      });

      if (!response.data?.trackingInfo) {
        throw new Error('Invalid tracking response from USPS API');
      }

      const updates: ITrackingUpdate[] = this.processTrackingUpdates(response.data.trackingInfo);

      // Cache the updates
      await this.cache.set(trackingNumber, updates);

      logger.info('Tracking updates retrieved successfully', {
        trackingNumber,
        updateCount: updates.length
      });

      return updates;
    } catch (error) {
      await this.handleApiError(error, 'Tracking Updates');
      throw error;
    }
  }

  /**
   * Signs API requests with credentials
   * @param data Request data to sign
   * @returns Signed request data
   */
  private async signRequest(data: any): Promise<any> {
    return {
      ...data,
      userId: this.userId,
      apiKey: this.apiKey,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Executes API calls with retry logic
   * @param operation API operation to execute
   * @returns Promise with operation result
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = Number(process.env.USPS_API_RETRY_ATTEMPTS) || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt === maxRetries) break;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }

    throw lastError;
  }

  /**
   * Handles API errors with logging
   * @param error Error object
   * @param context Error context
   */
  private async handleApiError(error: any, context: string): Promise<void> {
    logger.error(`USPS API Error - ${context}`, {
      error: error.message,
      code: error.response?.status,
      data: error.response?.data
    });
  }

  // Helper methods for request formatting
  private formatLabelRequest(labelData: IShippingLabel): any {
    // Implementation details for formatting label request
    return {
      // Format according to USPS API specifications
    };
  }

  private formatPickupRequest(pickupData: IShippingPickup): any {
    // Implementation details for formatting pickup request
    return {
      // Format according to USPS API specifications
    };
  }

  private formatBoxDeliveryRequest(deliveryData: IBoxDelivery): any {
    // Implementation details for formatting box delivery request
    return {
      // Format according to USPS API specifications
    };
  }

  private formatTrackingRequest(trackingNumber: string): any {
    // Implementation details for formatting tracking request
    return {
      // Format according to USPS API specifications
    };
  }

  private processTrackingUpdates(trackingInfo: any): ITrackingUpdate[] {
    // Implementation details for processing tracking updates
    return [];
  }
}