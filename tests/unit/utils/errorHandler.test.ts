/**
 * Error Handler Unit Tests
 *
 * Tests for error classification and the safe database operation wrapper.
 * Uses console spies instead of jest.mock (not supported by Bun test runner).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  classifyError,
  ErrorCategory,
  ErrorSeverity,
  safeDbOperation,
} from '../../../src/utils/errorHandler';

describe('classifyError', () => {
  describe('Database errors', () => {
    test('should classify TypeORM errors as DATABASE', () => {
      const error = new Error('TypeORM query failed');
      const result = classifyError(error);
      expect(result.category).toBe(ErrorCategory.DATABASE);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    test('should classify database connection errors', () => {
      const result = classifyError(new Error('Database connection refused'));
      expect(result.category).toBe(ErrorCategory.DATABASE);
    });

    test('should classify repository errors', () => {
      const result = classifyError(new Error('Repository not found for entity'));
      expect(result.category).toBe(ErrorCategory.DATABASE);
    });
  });

  describe('Discord API errors', () => {
    test('should classify DiscordAPIError', () => {
      const error = new Error('Discord API rate limited');
      error.name = 'DiscordAPIError';
      const result = classifyError(error);
      expect(result.category).toBe(ErrorCategory.DISCORD_API);
    });

    test('should classify unknown interaction errors', () => {
      const result = classifyError(new Error('Unknown interaction'));
      expect(result.category).toBe(ErrorCategory.DISCORD_API);
    });
  });

  describe('Permission errors', () => {
    test('should classify permission errors as PERMISSIONS with LOW severity', () => {
      const result = classifyError(new Error('Missing Access'));
      expect(result.category).toBe(ErrorCategory.PERMISSIONS);
      expect(result.severity).toBe(ErrorSeverity.LOW);
    });

    test('should classify forbidden errors', () => {
      const result = classifyError(new Error('Forbidden'));
      expect(result.category).toBe(ErrorCategory.PERMISSIONS);
    });
  });

  describe('Validation errors', () => {
    test('should classify invalid input errors', () => {
      const result = classifyError(new Error('Invalid channel ID'));
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.severity).toBe(ErrorSeverity.LOW);
    });

    test('should classify not found errors', () => {
      const result = classifyError(new Error('User not found'));
      expect(result.category).toBe(ErrorCategory.VALIDATION);
    });
  });

  describe('Configuration errors', () => {
    test('should classify config errors', () => {
      const result = classifyError(new Error('Bot not configured for this guild'));
      expect(result.category).toBe(ErrorCategory.CONFIGURATION);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    test('should classify setup errors', () => {
      const result = classifyError(new Error('Setup incomplete'));
      expect(result.category).toBe(ErrorCategory.CONFIGURATION);
    });
  });

  describe('External API errors', () => {
    test('should classify fetch errors', () => {
      const result = classifyError(new Error('Fetch timeout'));
      expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
    });

    test('should classify request failed errors', () => {
      const result = classifyError(new Error('Request failed with status 503'));
      expect(result.category).toBe(ErrorCategory.EXTERNAL_API);
    });
  });

  describe('Unknown errors', () => {
    test('should default to UNKNOWN for unrecognized errors', () => {
      const result = classifyError(new Error('Something totally unexpected'));
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    test('should handle non-Error objects', () => {
      const result = classifyError('just a string error');
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
    });

    test('should handle null/undefined', () => {
      const result = classifyError(null);
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
    });
  });
});

describe('safeDbOperation', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('should return result on success', async () => {
    const result = await safeDbOperation(
      async () => ({ id: 1, name: 'test' }),
      'test operation',
    );
    expect(result).toEqual({ id: 1, name: 'test' });
  });

  test('should return null on failure', async () => {
    const result = await safeDbOperation(
      async () => { throw new Error('DB error'); },
      'failing operation',
    );
    expect(result).toBeNull();
  });

  test('should log error on failure', async () => {
    await safeDbOperation(
      async () => { throw new Error('DB connection lost'); },
      'connection test',
    );

    // Should have logged the error via console.error (through logger/chalk)
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
