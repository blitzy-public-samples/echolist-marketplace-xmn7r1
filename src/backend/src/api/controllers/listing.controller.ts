import { Request, Response } from 'express'; // ^4.17.1
import { injectable } from 'inversify'; // ^6.0.1
import { controller, httpPost, httpPut, httpGet } from 'inversify-express-utils'; // ^6.3.2
import rateLimit from 'express-rate-limit'; // ^6.0.0

import { ListingService } from '../../services/listing/listing.service';
import { 
  IListing, 
  IListingCreationAttributes, 
  IListingUpdateAttributes 
} from '../../interfaces/listing.interface';
import { 
  validateListingCreation, 
  validateListingUpdate, 
  validateMarketplaceSync 
} from '../validators/listing.validator';
import { logger } from '../../utils/logger.util';
import { createCustomError } from '../../utils/error.util';
import { MARKETPLACE_ERRORS } from '../../constants/error.constants';

// Rate limiting configuration
const createListingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per window
  message: 'Too many listing creation attempts, please try again later'
});

const updateListingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many listing update attempts, please try again later'
});

@injectable()
@controller('/api/listings')
export class ListingController {
  constructor(
    private readonly listingService: ListingService,
    private readonly logger: typeof logger
  ) {}

  /**
   * Creates a new listing with AI-powered features
   * @route POST /api/listings
   */
  @httpPost('/')
  @validateListingCreation
  async createListing(req: Request, res: Response): Promise<Response> {
    try {
      const correlationId = req.headers['x-correlation-id'] as string;
      const userId = req.user?.id;

      this.logger.info('Creating new listing', {
        correlationId,
        userId,
        metadata: { title: req.body.title }
      });

      const listingData: IListingCreationAttributes = {
        ...req.body,
        userId,
        enableAutoSync: req.body.enableAutoSync ?? true,
        targetMarketplaces: req.body.marketplacePlatforms || []
      };

      const createdListing = await this.listingService.createListing(listingData);

      return res.status(201).json({
        success: true,
        data: createdListing,
        metadata: {
          correlationId,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      this.logger.error('Failed to create listing', { error, body: req.body });
      throw createCustomError(
        MARKETPLACE_ERRORS.INVALID_LISTING,
        'Failed to create listing',
        { originalError: error }
      );
    }
  }

  /**
   * Updates an existing listing
   * @route PUT /api/listings/:id
   */
  @httpPut('/:id')
  @validateListingUpdate
  async updateListing(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const correlationId = req.headers['x-correlation-id'] as string;

      // Verify listing ownership
      const existingListing = await this.listingService.getListing(id);
      if (existingListing.userId !== userId) {
        throw createCustomError(
          MARKETPLACE_ERRORS.INVALID_LISTING,
          'Unauthorized to update this listing'
        );
      }

      const updateData: IListingUpdateAttributes = req.body;

      this.logger.info('Updating listing', {
        correlationId,
        listingId: id,
        userId,
        metadata: { updateFields: Object.keys(updateData) }
      });

      const updatedListing = await this.listingService.updateListing(
        id,
        updateData
      );

      return res.status(200).json({
        success: true,
        data: updatedListing,
        metadata: {
          correlationId,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      this.logger.error('Failed to update listing', {
        error,
        listingId: req.params.id,
        body: req.body
      });
      throw createCustomError(
        MARKETPLACE_ERRORS.INVALID_LISTING,
        'Failed to update listing',
        { originalError: error }
      );
    }
  }

  /**
   * Synchronizes listing with external marketplaces
   * @route POST /api/listings/:id/sync
   */
  @httpPost('/:id/sync')
  @validateMarketplaceSync
  async syncWithMarketplaces(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { platforms, autoSync } = req.body;
      const correlationId = req.headers['x-correlation-id'] as string;

      this.logger.info('Syncing listing with marketplaces', {
        correlationId,
        listingId: id,
        platforms,
        metadata: { autoSync }
      });

      const syncResults = await this.listingService.syncWithMarketplaces(
        id,
        platforms,
        { autoSync }
      );

      return res.status(200).json({
        success: true,
        data: syncResults,
        metadata: {
          correlationId,
          timestamp: new Date().toISOString(),
          platforms
        }
      });
    } catch (error) {
      this.logger.error('Failed to sync listing', {
        error,
        listingId: req.params.id,
        platforms: req.body.platforms
      });
      throw createCustomError(
        MARKETPLACE_ERRORS.SYNC_FAILED,
        'Failed to sync listing with marketplaces',
        { originalError: error }
      );
    }
  }

  /**
   * Retrieves a specific listing by ID
   * @route GET /api/listings/:id
   */
  @httpGet('/:id')
  async getListing(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const correlationId = req.headers['x-correlation-id'] as string;

      this.logger.info('Retrieving listing', {
        correlationId,
        listingId: id
      });

      const listing = await this.listingService.getListing(id);

      if (!listing) {
        throw createCustomError(
          MARKETPLACE_ERRORS.INVALID_LISTING,
          'Listing not found'
        );
      }

      return res.status(200).json({
        success: true,
        data: listing,
        metadata: {
          correlationId,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      this.logger.error('Failed to retrieve listing', {
        error,
        listingId: req.params.id
      });
      throw createCustomError(
        MARKETPLACE_ERRORS.INVALID_LISTING,
        'Failed to retrieve listing',
        { originalError: error }
      );
    }
  }
}

export default ListingController;