/**
 * Logger Unit Tests
 *
 * Tests for the basic logger utility and timestamp formatting.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { getTimestamp, logger } from '../../../src/utils/logger';

describe('getTimestamp', () => {
  test('should return a string', () => {
    const result = getTimestamp();
    expect(typeof result).toBe('string');
  });

  test('should be lowercase (am/pm)', () => {
    const result = getTimestamp();
    expect(result).toBe(result.toLowerCase());
  });

  test('should contain a colon (hour:minute format)', () => {
    const result = getTimestamp();
    expect(result).toContain(':');
  });

  test('should contain am or pm', () => {
    const result = getTimestamp();
    expect(result).toMatch(/[ap]m/);
  });
});

describe('logger', () => {
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

  test('should default to INFO level using console.log', () => {
    logger('test message');
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  });

  test('should use console.warn for WARN level', () => {
    logger('warning message', 'WARN');
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
  });

  test('should use console.error for ERROR level', () => {
    logger('error message', 'ERROR');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  test('should include the message in output', () => {
    logger('my specific message');
    const call = consoleLogSpy.mock.calls[0][0] as string;
    expect(call).toContain('my specific message');
  });

  test('should include timestamp in output', () => {
    logger('timestamped');
    const call = consoleLogSpy.mock.calls[0][0] as string;
    // Should have format [time - LEVEL]
    expect(call).toMatch(/\[.+ - INFO\]/);
  });
});
