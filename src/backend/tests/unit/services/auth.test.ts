import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import AWS from 'aws-sdk';
import { 
  generateToken, 
  verifyToken, 
  generateRefreshToken, 
  refreshAccessToken, 
  revokeToken 
} from '../../src/services/auth/jwt.service';
import { PasswordService } from '../../src/services/auth/password.service';
import { JWTToken } from '../../src/interfaces/auth.interface';
import { AUTH_ERRORS } from '../../src/constants/error.constants';

// Test constants
const TEST_USER: JWTToken = {
  userId: '123',
  email: 'test@example.com',
  role: 'user',
  permissions: ['read', 'write'],
  deviceFingerprint: 'test-device-123',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  jti: 'test-jti',
  iss: 'echolist-api',
  sub: 'test@example.com',
  aud: ['echolist-client']
};

const TEST_PASSWORD = 'TestPassword123!@#';
const MOCK_KMS_KEY = 'arn:aws:kms:region:account:key/mock-key-id';

describe('Authentication Service Tests', () => {
  let passwordService: PasswordService;

  beforeAll(async () => {
    // Configure AWS KMS mock
    const mockKMS = {
      encrypt: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({
          CiphertextBlob: Buffer.from('encrypted'),
          KeyId: MOCK_KMS_KEY
        })
      }),
      decrypt: jest.fn().mockReturnValue({
        promise: () => Promise.resolve({
          Plaintext: Buffer.from('decrypted')
        })
      })
    };

    AWS.KMS = jest.fn(() => mockKMS) as any;

    // Initialize PasswordService
    passwordService = new PasswordService();

    // Set environment variables
    process.env.JWT_SECRET = 'test-secret';
    process.env.KMS_KEY_ID = MOCK_KMS_KEY;
  });

  afterAll(() => {
    jest.clearAllMocks();
    delete process.env.JWT_SECRET;
    delete process.env.KMS_KEY_ID;
  });

  describe('JWT Token Management', () => {
    describe('generateToken', () => {
      test('should generate valid JWT token with correct payload', async () => {
        const deviceId = 'test-device';
        const userAgent = 'test-agent';

        const token = await generateToken(TEST_USER, deviceId, userAgent);
        expect(token).toBeDefined();
        expect(typeof token).toBe('string');

        const decoded = jwt.decode(token) as any;
        expect(decoded.userId).toBe(TEST_USER.userId);
        expect(decoded.email).toBe(TEST_USER.email);
        expect(decoded.role).toBe(TEST_USER.role);
      });

      test('should include device binding in token', async () => {
        const deviceId = 'test-device';
        const userAgent = 'test-agent';

        const token = await generateToken(TEST_USER, deviceId, userAgent);
        const decoded = jwt.decode(token) as any;

        expect(decoded.deviceId).toBe(deviceId);
        expect(decoded.fingerprint).toBeDefined();
      });

      test('should throw error for invalid payload', async () => {
        const invalidPayload = { ...TEST_USER, userId: undefined };
        await expect(generateToken(invalidPayload as any, 'device', 'agent'))
          .rejects.toThrow();
      });
    });

    describe('verifyToken', () => {
      test('should verify and decode valid token', async () => {
        const deviceId = 'test-device';
        const userAgent = 'test-agent';
        const token = await generateToken(TEST_USER, deviceId, userAgent);

        const decoded = await verifyToken(token, deviceId, userAgent);
        expect(decoded.userId).toBe(TEST_USER.userId);
        expect(decoded.email).toBe(TEST_USER.email);
      });

      test('should throw TOKEN_EXPIRED for expired token', async () => {
        const expiredToken = jwt.sign(
          { ...TEST_USER, exp: Math.floor(Date.now() / 1000) - 3600 },
          process.env.JWT_SECRET!
        );

        await expect(verifyToken(expiredToken, 'device', 'agent'))
          .rejects.toThrow(AUTH_ERRORS.TOKEN_EXPIRED.toString());
      });

      test('should throw UNAUTHORIZED for invalid device binding', async () => {
        const token = await generateToken(TEST_USER, 'device-1', 'agent');
        await expect(verifyToken(token, 'device-2', 'agent'))
          .rejects.toThrow(AUTH_ERRORS.UNAUTHORIZED.toString());
      });
    });

    describe('refreshToken', () => {
      test('should generate valid refresh token', async () => {
        const refreshToken = await generateRefreshToken(
          TEST_USER.userId,
          'device',
          'agent'
        );

        expect(refreshToken).toBeDefined();
        const decoded = jwt.decode(refreshToken) as any;
        expect(decoded.type).toBe('refresh');
      });

      test('should refresh access token with valid refresh token', async () => {
        const deviceId = 'test-device';
        const userAgent = 'test-agent';
        const refreshToken = await generateRefreshToken(
          TEST_USER.userId,
          deviceId,
          userAgent
        );

        const result = await refreshAccessToken(refreshToken, deviceId, userAgent);
        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBeDefined();
      });
    });
  });

  describe('Password Service', () => {
    describe('validateAndHashPassword', () => {
      test('should hash valid password with KMS', async () => {
        const result = await passwordService.hashNewPassword(TEST_PASSWORD, TEST_USER.userId);
        expect(result.hash).toBeDefined();
        expect(result.metadata.kmsKeyId).toBe(MOCK_KMS_KEY);
      });

      test('should enforce password complexity requirements', async () => {
        const weakPassword = 'weak';
        await expect(passwordService.hashNewPassword(weakPassword, TEST_USER.userId))
          .rejects.toThrow();
      });

      test('should detect breached passwords', async () => {
        // Mock breach detection
        jest.spyOn(passwordService as any, 'checkPasswordBreach')
          .mockResolvedValueOnce(true);

        await expect(passwordService.hashNewPassword('breached123', TEST_USER.userId))
          .rejects.toThrow();
      });
    });

    describe('verifyPassword', () => {
      test('should verify correct password', async () => {
        const hashedPassword = await passwordService.hashNewPassword(TEST_PASSWORD, TEST_USER.userId);
        const isValid = await passwordService.verifyPassword(
          TEST_PASSWORD,
          hashedPassword.hash,
          TEST_USER.userId
        );
        expect(isValid).toBe(true);
      });

      test('should reject incorrect password', async () => {
        const hashedPassword = await passwordService.hashNewPassword(TEST_PASSWORD, TEST_USER.userId);
        const isValid = await passwordService.verifyPassword(
          'wrong-password',
          hashedPassword.hash,
          TEST_USER.userId
        );
        expect(isValid).toBe(false);
      });

      test('should enforce rate limiting', async () => {
        const hashedPassword = await passwordService.hashNewPassword(TEST_PASSWORD, TEST_USER.userId);
        
        // Attempt multiple password verifications
        for (let i = 0; i < 5; i++) {
          await passwordService.verifyPassword(
            'wrong-password',
            hashedPassword.hash,
            TEST_USER.userId
          );
        }

        // Next attempt should be rate limited
        await expect(passwordService.verifyPassword(
          'wrong-password',
          hashedPassword.hash,
          TEST_USER.userId
        )).rejects.toThrow(AUTH_ERRORS.RATE_LIMIT_EXCEEDED.toString());
      });
    });
  });
});