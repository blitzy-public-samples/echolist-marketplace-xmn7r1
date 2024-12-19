import { Request, Response, NextFunction } from 'express'; // ^4.17.1
import { USPSService } from '../../services/external/usps.service';
import {
  validateShippingLabel,
  validatePickupRequest,
  validateBoxDelivery,
  validateTrackingUpdate
} from '../validators/shipping.validator';
import {
  IShippingLabel,
  IShippingPickup,
  IBoxDelivery,
  ITrackingUpdate,
  USPSServiceType,
  PickupStatus,
  DeliveryStatus
} from '../../interfaces/shipping.interface';
import { logger } from '../../utils/logger.util';
import { ValidationError } from '../../utils/validation.util';

/**
 * @class ShippingController
 * @description Controller handling all shipping-related HTTP endpoints with comprehensive
 * error handling, validation, and monitoring capabilities
 * @version 1.0.0
 */
export class ShippingController {
  private readonly uspsService: USPSService;

  constructor(uspsService: USPSService) {
    this.uspsService = uspsService;
  }

  /**
   * Generates a shipping label through USPS with enhanced validation
   * @param req Express request object containing label data
   * @param res Express response object
   * @param next Express next function
   */
  public async generateShippingLabel = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const requestId = req.headers['x-request-id'] || Date.now().toString();
    
    try {
      logger.info('Initiating shipping label generation', {
        requestId,
        userId: req.user?.id,
        serviceType: req.body.serviceType
      });

      // Validate request data
      await validateShippingLabel(req.body);

      // Generate shipping label
      const labelData: IShippingLabel = await this.uspsService.generateLabel({
        ...req.body,
        id: requestId,
        transactionId: req.body.transactionId,
        createdAt: new Date()
      });

      logger.info('Shipping label generated successfully', {
        requestId,
        trackingNumber: labelData.trackingNumber
      });

      res.status(201).json({
        success: true,
        data: labelData
      });
    } catch (error) {
      logger.error('Error generating shipping label', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: error.toJSON()
        });
        return;
      }

      next(error);
    }
  };

  /**
   * Schedules a USPS pickup with validation and monitoring
   * @param req Express request object containing pickup data
   * @param res Express response object
   * @param next Express next function
   */
  public async schedulePickup = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const requestId = req.headers['x-request-id'] || Date.now().toString();

    try {
      logger.info('Initiating pickup scheduling', {
        requestId,
        userId: req.user?.id,
        pickupDate: req.body.pickupDate
      });

      // Validate pickup request
      await validatePickupRequest(req.body);

      // Schedule pickup
      const pickupData: IShippingPickup = await this.uspsService.schedulePickup({
        ...req.body,
        id: requestId,
        userId: req.user?.id,
        status: PickupStatus.SCHEDULED
      });

      logger.info('Pickup scheduled successfully', {
        requestId,
        confirmationNumber: pickupData.confirmationNumber
      });

      res.status(201).json({
        success: true,
        data: pickupData
      });
    } catch (error) {
      logger.error('Error scheduling pickup', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: error.toJSON()
        });
        return;
      }

      next(error);
    }
  };

  /**
   * Requests USPS box delivery with enhanced validation
   * @param req Express request object containing box delivery data
   * @param res Express response object
   * @param next Express next function
   */
  public async requestBoxDelivery = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const requestId = req.headers['x-request-id'] || Date.now().toString();

    try {
      logger.info('Initiating box delivery request', {
        requestId,
        userId: req.user?.id,
        boxType: req.body.boxType
      });

      // Validate box delivery request
      await validateBoxDelivery(req.body);

      // Request box delivery
      const deliveryData: IBoxDelivery = await this.uspsService.requestBoxDelivery({
        ...req.body,
        id: requestId,
        userId: req.user?.id,
        status: DeliveryStatus.REQUESTED,
        requestDate: new Date()
      });

      logger.info('Box delivery requested successfully', {
        requestId,
        trackingNumber: deliveryData.trackingNumber
      });

      res.status(201).json({
        success: true,
        data: deliveryData
      });
    } catch (error) {
      logger.error('Error requesting box delivery', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: error.toJSON()
        });
        return;
      }

      next(error);
    }
  };

  /**
   * Retrieves tracking information with caching
   * @param req Express request object containing tracking number
   * @param res Express response object
   * @param next Express next function
   */
  public async getTrackingInfo = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const requestId = req.headers['x-request-id'] || Date.now().toString();
    const trackingNumber = req.params.trackingNumber;

    try {
      logger.info('Retrieving tracking information', {
        requestId,
        trackingNumber
      });

      // Validate tracking number format
      await validateTrackingUpdate({ trackingNumber });

      // Get tracking updates
      const trackingUpdates: ITrackingUpdate[] = await this.uspsService.getTrackingUpdates(
        trackingNumber
      );

      logger.info('Tracking information retrieved successfully', {
        requestId,
        trackingNumber,
        updatesCount: trackingUpdates.length
      });

      res.status(200).json({
        success: true,
        data: trackingUpdates
      });
    } catch (error) {
      logger.error('Error retrieving tracking information', {
        requestId,
        trackingNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: error.toJSON()
        });
        return;
      }

      next(error);
    }
  };
}