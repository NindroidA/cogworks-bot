/**
 * Jest Test Setup
 * 
 * Global test configuration and utilities.
 * Runs before all test files.
 */

// Extend Jest timeout for integration tests
jest.setTimeout(10000);

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.RELEASE = 'dev';
process.env.BOT_TOKEN = 'test_token';
process.env.CLIENT_ID = 'test_client_id';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '3306';
process.env.DB_USER = 'test_user';
process.env.DB_PASSWORD = 'test_password';
process.env.DB_NAME = 'cogworks_test';

// Suppress console output during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Global test utilities
export const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

export const mockDate = (date: Date): void => {
  jest.useFakeTimers();
  jest.setSystemTime(date);
};

export const restoreDate = (): void => {
  jest.useRealTimers();
};
