import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import supertest from 'supertest';
import nock from 'nock';
import { USPSService } from '../../src/services/external/usps.service';
import { ShippingController } from '../../src/api/controllers/shipping.controller';
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
} from '../../src/interfaces/shipping.interface';

// Test server and service instances
let testServer: any;
let uspsService: USPSService;
let shippingController: ShippingController;

// Mock data for testing
const mockShippingData = {
  validAddress: {
    street1: '123 Test Street',
    city: 'Test City',
    state: 'TX',
    zipCode: '75001',
    country: 'US'
  },
  validDimensions: {
    length: 12,
    width: 8,
    height: 6,
    unit: 'in'
  },
  validLabel: {
    serviceType: USPSServiceType.PRIORITY,
    fromAddress: {
      street1: '123 Sender St',
      city: 'Dallas',
      state: 'TX',
      zipCode: '75001',
      country: 'US'
    },
    toAddress: {
      street1: '456 Receiver Ave',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
      country: 'US'
    },
    weight: 5,
    dimensions: {
      length: 12,
      width: 8,
      height: 6,
      unit: 'in'
    },
    labelFormat: 'PDF'
  },
  validPickup: {
    pickupDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    timeWindow: PickupTimeWindow.MORNING,
    address: {
      street1: '123 Pickup St',
      city: 'Dallas',
      state: 'TX',
      zipCode: '75001',
      country: 'US'
    },
    packageCount: 2,
    packageDetails: [
      { weight: 5, type: 'PRIORITY' },
      { weight: 3, type: 'FIRST_CLASS' }
    ],
    specialInstructions: 'Please ring doorbell'
  },
  validBoxDelivery: {
    boxType: USPSBoxType.MEDIUM,
    quantity: 5,
    deliveryAddress: {
      street1: '123 Delivery St',
      city: 'Dallas',
      state: 'TX',
      zipCode: '75001',
      country: 'US'
    },
    deliveryInstructions: 'Leave at front door',
    preferredDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  }
};

beforeAll(async () => {
  // Initialize USPS service with mock credentials
  process.env.USPS_API_URL = 'http://test-usps-api';
  process.env.USPS_USER_ID = 'test-user';
  process.env.USPS_API_KEY = 'test-key';

  uspsService = new USPSService();
  shippingController = new ShippingController(uspsService);

  // Setup test server
  const app = express();
  app.use(express.json());
  app.use('/api/shipping', shippingController.router);
  testServer = supertest(app);

  // Setup nock for USPS API mocking
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
});

afterAll(async () => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('Shipping Label Generation', () => {
  test('should successfully generate shipping label with valid data', async () => {
    // Mock USPS API response
    nock('http://test-usps-api')
      .post('/shipping/label')
      .reply(200, {
        label: {
          url: 'https://test-label.pdf',
          trackingNumber: '12345678901234567890',
          cost: 7.95
        }
      });

    const response = await testServer
      .post('/api/shipping/label')
      .send(mockShippingData.validLabel)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('labelUrl');
    expect(response.body.data).toHaveProperty('trackingNumber');
    expect(response.body.data.serviceType).toBe(USPSServiceType.PRIORITY);
  });

  test('should reject invalid address data', async () => {
    const invalidLabel = {
      ...mockShippingData.validLabel,
      toAddress: {
        ...mockShippingData.validLabel.toAddress,
        zipCode: '123' // Invalid ZIP code
      }
    };

    const response = await testServer
      .post('/api/shipping/label')
      .send(invalidLabel)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.category).toBe('validation');
  });

  test('should handle USPS API errors gracefully', async () => {
    nock('http://test-usps-api')
      .post('/shipping/label')
      .replyWithError('USPS API unavailable');

    const response = await testServer
      .post('/api/shipping/label')
      .send(mockShippingData.validLabel)
      .expect(500);

    expect(response.body.success).toBe(false);
  });
});

describe('Pickup Scheduling', () => {
  test('should successfully schedule pickup with valid data', async () => {
    nock('http://test-usps-api')
      .post('/shipping/pickup')
      .reply(200, {
        confirmationNumber: 'PICKUP123456'
      });

    const response = await testServer
      .post('/api/shipping/pickup')
      .send(mockShippingData.validPickup)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.confirmationNumber).toBeDefined();
    expect(response.body.data.status).toBe(PickupStatus.SCHEDULED);
  });

  test('should validate pickup time windows', async () => {
    const invalidPickup = {
      ...mockShippingData.validPickup,
      timeWindow: 'INVALID_WINDOW'
    };

    const response = await testServer
      .post('/api/shipping/pickup')
      .send(invalidPickup)
      .expect(400);

    expect(response.body.error.errors[0].field).toBe('timeWindow');
  });

  test('should enforce package count limits', async () => {
    const invalidPickup = {
      ...mockShippingData.validPickup,
      packageCount: 51 // Exceeds limit
    };

    const response = await testServer
      .post('/api/shipping/pickup')
      .send(invalidPickup)
      .expect(400);

    expect(response.body.error.errors[0].field).toBe('packageCount');
  });
});

describe('Box Delivery Service', () => {
  test('should successfully request box delivery', async () => {
    nock('http://test-usps-api')
      .post('/shipping/supplies')
      .reply(200, {
        trackingNumber: '98765432109876543210'
      });

    const response = await testServer
      .post('/api/shipping/boxes')
      .send(mockShippingData.validBoxDelivery)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.trackingNumber).toBeDefined();
    expect(response.body.data.status).toBe(DeliveryStatus.REQUESTED);
  });

  test('should validate box quantity limits', async () => {
    const invalidDelivery = {
      ...mockShippingData.validBoxDelivery,
      quantity: 26 // Exceeds limit
    };

    const response = await testServer
      .post('/api/shipping/boxes')
      .send(invalidDelivery)
      .expect(400);

    expect(response.body.error.errors[0].field).toBe('quantity');
  });

  test('should sanitize delivery instructions', async () => {
    const deliveryWithXSS = {
      ...mockShippingData.validBoxDelivery,
      deliveryInstructions: '<script>alert("xss")</script>Leave at door'
    };

    const response = await testServer
      .post('/api/shipping/boxes')
      .send(deliveryWithXSS)
      .expect(201);

    expect(response.body.data.deliveryInstructions).not.toContain('<script>');
  });
});

describe('Tracking Updates', () => {
  const validTrackingNumber = '12345678901234567890';

  test('should retrieve tracking updates successfully', async () => {
    nock('http://test-usps-api')
      .get('/tracking')
      .query(true)
      .reply(200, {
        trackingInfo: [
          {
            status: TrackingStatus.IN_TRANSIT,
            location: 'Dallas, TX',
            timestamp: new Date().toISOString(),
            description: 'Package in transit',
            estimatedDeliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        ]
      });

    const response = await testServer
      .get(`/api/shipping/tracking/${validTrackingNumber}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0].status).toBe(TrackingStatus.IN_TRANSIT);
  });

  test('should validate tracking number format', async () => {
    const response = await testServer
      .get('/api/shipping/tracking/invalid123')
      .expect(400);

    expect(response.body.error.errors[0].field).toBe('trackingNumber');
  });

  test('should handle tracking service unavailability', async () => {
    nock('http://test-usps-api')
      .get('/tracking')
      .query(true)
      .replyWithError('Tracking service unavailable');

    const response = await testServer
      .get(`/api/shipping/tracking/${validTrackingNumber}`)
      .expect(500);

    expect(response.body.success).toBe(false);
  });
});