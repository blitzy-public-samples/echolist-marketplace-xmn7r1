/**
 * Listing Routes Configuration
 * Implements secure routes for listing management with AI integration and marketplace sync
 * @version 1.0.0
 */

import { Router } from 'express'; // ^4.17.1
import { container } from 'inversify'; // ^6.0.1
import rateLimit from 'express-rate-limit'; // ^6.0.0

import { ListingController } from '../controllers/listing.controller';
import { 
  authenticate, 
  authorize 
} from '../middlewares/auth.middleware';
import {
  validateListingCreation,
  validateListingUpdate,
  validateMarketplaceSync
} from '../validators/listing.validator';

// Rate limiting configurations
const createListingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many listing creation attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

const updateListingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many listing update attempts, please try again later'
});

const syncListingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many marketplace sync attempts, please try again later'
});

const imageProcessingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many image processing attempts, please try again later'
});

/**
 * Configures and returns the listing routes with security middleware
 * @returns Express Router instance with configured listing routes
 */
const configureListingRoutes = (): Router => {
  const router = Router();
  const listingController = container.get<ListingController>(ListingController);

  // Create new listing with AI processing
  router.post('/',
    createListingLimiter,
    authenticate,
    authorize(['seller']),
    validateListingCreation,
    listingController.createListing
  );

  // Update existing listing
  router.put('/:id',
    updateListingLimiter,
    authenticate,
    authorize(['seller']),
    validateListingUpdate,
    listingController.updateListing
  );

  // Get listing details
  router.get('/:id',
    rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }),
    authenticate,
    listingController.getListing
  );

  // Sync listing with marketplaces
  router.post('/:id/sync',
    syncListingLimiter,
    authenticate,
    authorize(['seller']),
    validateMarketplaceSync,
    listingController.syncWithMarketplaces
  );

  // Process listing images with AI
  router.post('/:id/images',
    imageProcessingLimiter,
    authenticate,
    authorize(['seller']),
    listingController.processListingImages
  );

  // Estimate item dimensions using AI
  router.post('/:id/dimensions',
    imageProcessingLimiter,
    authenticate,
    authorize(['seller']),
    listingController.estimateItemDimensions
  );

  return router;
};

// Create and export configured router
const listingRouter = configureListingRoutes();
export default listingRouter;

// Export route configuration for testing and documentation
export { configureListingRoutes };