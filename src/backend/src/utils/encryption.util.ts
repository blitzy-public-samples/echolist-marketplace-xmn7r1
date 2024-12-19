// aws-sdk v2.1000.0 - AWS SDK for JavaScript/TypeScript
import * as AWS from 'aws-sdk';
// crypto (built-in) - Node.js crypto module
import * as crypto from 'crypto';
import { awsConfig } from '../config/aws.config';
import { logger } from './logger.util';

/**
 * @version 1.0.0
 * @description Enhanced encryption utility providing secure data encryption/decryption
 * services using AWS KMS and AES-256-GCM with comprehensive security features.
 */

// Global configuration constants
const KMS_KEY_ID = process.env.KMS_KEY_ID;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_CACHE_DURATION = parseInt(process.env.KEY_CACHE_DURATION || '3600', 10);
const PBKDF2_ITERATIONS = parseInt(process.env.PBKDF2_ITERATIONS || '100000', 10);

// Type definitions
interface EncryptionOptions {
  useCache?: boolean;
  additionalAuthData?: Buffer;
  keyRotation?: boolean;
}

interface EncryptionResult {
  encryptedData: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
  metadata: {
    algorithm: string;
    timestamp: string;
    version: string;
  };
}

interface DecryptionResult {
  decryptedData: Buffer;
  metadata: {
    keyId: string;
    timestamp: string;
  };
}

interface CachedKey {
  key: Buffer;
  timestamp: number;
  keyId: string;
}

/**
 * Encryption service class implementing secure data protection with AWS KMS
 * and local caching optimization
 */
class EncryptionService {
  private static instance: EncryptionService;
  private kmsClient: AWS.KMS;
  private keyCache: Map<string, CachedKey>;
  private readonly keyId: string;

  private constructor() {
    if (!KMS_KEY_ID) {
      throw new Error('KMS_KEY_ID environment variable is required');
    }

    this.keyId = KMS_KEY_ID;
    this.keyCache = new Map();
    this.kmsClient = new AWS.KMS({
      apiVersion: '2014-11-01',
      ...awsConfig.getInstance(),
      maxRetries: 3,
    });

    // Set up periodic cache cleanup
    setInterval(() => this.cleanKeyCache(), KEY_CACHE_DURATION * 1000);
  }

  /**
   * Returns singleton instance of EncryptionService
   */
  public static getInstance(): EncryptionService {
    if (!EncryptionService.instance) {
      EncryptionService.instance = new EncryptionService();
    }
    return EncryptionService.instance;
  }

  /**
   * Encrypts data using AWS KMS and AES-256-GCM
   * @param data Data to encrypt
   * @param options Encryption options
   */
  public async encrypt(
    data: Buffer | string,
    options: EncryptionOptions = {}
  ): Promise<EncryptionResult> {
    try {
      const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const iv = crypto.randomBytes(12);
      const { key, keyId } = await this.getDataKey(options.useCache);

      // Create cipher with AES-256-GCM
      const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

      // Add additional authenticated data if provided
      if (options.additionalAuthData) {
        cipher.setAAD(options.additionalAuthData);
      }

      // Encrypt data
      const encryptedData = Buffer.concat([
        cipher.update(dataBuffer),
        cipher.final(),
      ]);

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Log encryption operation (excluding sensitive data)
      logger.info('Data encryption completed', {
        keyId,
        timestamp: new Date().toISOString(),
        dataSize: dataBuffer.length,
      });

      return {
        encryptedData,
        iv,
        authTag,
        keyId,
        metadata: {
          algorithm: ENCRYPTION_ALGORITHM,
          timestamp: new Date().toISOString(),
          version: '1.0',
        },
      };
    } catch (error) {
      logger.error('Encryption failed', { error });
      throw new Error('Encryption failed: ' + (error as Error).message);
    }
  }

  /**
   * Decrypts data using AWS KMS and AES-256-GCM
   * @param encryptionResult Encryption result containing encrypted data and metadata
   */
  public async decrypt(
    encryptionResult: EncryptionResult
  ): Promise<DecryptionResult> {
    try {
      const { key } = await this.getDataKey(true, encryptionResult.keyId);

      // Create decipher
      const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        encryptionResult.iv
      );

      // Set auth tag for verification
      decipher.setAuthTag(encryptionResult.authTag);

      // Decrypt data
      const decryptedData = Buffer.concat([
        decipher.update(encryptionResult.encryptedData),
        decipher.final(),
      ]);

      logger.info('Data decryption completed', {
        keyId: encryptionResult.keyId,
        timestamp: new Date().toISOString(),
      });

      return {
        decryptedData,
        metadata: {
          keyId: encryptionResult.keyId,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Decryption failed', { error });
      throw new Error('Decryption failed: ' + (error as Error).message);
    }
  }

  /**
   * Retrieves data key from AWS KMS or cache
   * @param useCache Whether to use cached key
   * @param keyId Optional specific key ID
   */
  private async getDataKey(
    useCache: boolean = true,
    keyId?: string
  ): Promise<{ key: Buffer; keyId: string }> {
    const targetKeyId = keyId || this.keyId;

    // Check cache if enabled
    if (useCache) {
      const cachedKey = this.keyCache.get(targetKeyId);
      if (
        cachedKey &&
        Date.now() - cachedKey.timestamp < KEY_CACHE_DURATION * 1000
      ) {
        return { key: cachedKey.key, keyId: cachedKey.keyId };
      }
    }

    try {
      // Generate new data key from KMS
      const { Plaintext, KeyId } = await this.kmsClient
        .generateDataKey({
          KeyId: targetKeyId,
          KeySpec: 'AES_256',
        })
        .promise();

      if (!Plaintext || !KeyId) {
        throw new Error('Failed to generate data key');
      }

      const key = Buffer.from(Plaintext);

      // Cache the key if caching is enabled
      if (useCache) {
        this.keyCache.set(KeyId, {
          key,
          timestamp: Date.now(),
          keyId: KeyId,
        });
      }

      return { key, keyId: KeyId };
    } catch (error) {
      logger.error('Failed to get data key from KMS', { error });
      throw new Error('Key generation failed: ' + (error as Error).message);
    }
  }

  /**
   * Cleans expired keys from cache
   */
  private cleanKeyCache(): void {
    const now = Date.now();
    for (const [keyId, cachedKey] of this.keyCache.entries()) {
      if (now - cachedKey.timestamp >= KEY_CACHE_DURATION * 1000) {
        this.keyCache.delete(keyId);
      }
    }
  }
}

// Export singleton instance and utility functions
export const encryptionService = EncryptionService.getInstance();

export const encrypt = async (
  data: Buffer | string,
  options?: EncryptionOptions
): Promise<EncryptionResult> => {
  return encryptionService.encrypt(data, options);
};

export const decrypt = async (
  encryptionResult: EncryptionResult
): Promise<DecryptionResult> => {
  return encryptionService.decrypt(encryptionResult);
};

export type {
  EncryptionOptions,
  EncryptionResult,
  DecryptionResult,
};