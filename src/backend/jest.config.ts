import type { Config } from '@jest/types';

// Jest configuration object with comprehensive settings for the EchoList backend
const config: Config.InitialOptions = {
  // Use ts-jest preset for TypeScript support
  preset: 'ts-jest',

  // Set Node.js as the test environment
  testEnvironment: 'node',

  // Define test file locations
  roots: ['<rootDir>/src'],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],

  // TypeScript transformation configuration
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },

  // Path aliases for clean imports
  moduleNameMapper: {
    '@/(.*)': '<rootDir>/src/$1'
  },

  // Coverage collection configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.interface.ts',
    '!src/types/**/*',
    '!src/**/index.ts'
  ],

  // Coverage output settings
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'json-summary',
    'html'
  ],

  // Coverage thresholds enforcement
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Test setup file for global configurations
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // Supported file extensions
  moduleFileExtensions: [
    'ts',
    'js',
    'json'
  ],

  // TypeScript compiler options for ts-jest
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
      diagnostics: true,
      isolatedModules: true
    }
  },

  // Test execution settings
  verbose: true,
  testTimeout: 10000,
  maxWorkers: '50%',
  
  // Error handling and cleanup
  errorOnDeprecated: true,
  detectOpenHandles: true,
  forceExit: true,

  // Additional settings for CI/CD integration
  bail: 1,
  ci: process.env.CI === 'true',
  clearMocks: true,
  restoreMocks: true,
  
  // Cache settings for faster subsequent runs
  cache: true,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest'
};

export default config;