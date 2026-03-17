/**
 * Internal API Auth Unit Tests
 *
 * Tests bearer token authentication with timing-safe comparison.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import type { IncomingMessage } from 'node:http';

function createMockRequest(authorization?: string): IncomingMessage {
  return {
    headers: authorization !== undefined ? { authorization } : {},
  } as IncomingMessage;
}

describe('validateAuth', () => {
  const originalToken = process.env.COGWORKS_INTERNAL_API_TOKEN;

  afterEach(() => {
    // Restore original env var after each test
    if (originalToken !== undefined) {
      process.env.COGWORKS_INTERNAL_API_TOKEN = originalToken;
    } else {
      delete process.env.COGWORKS_INTERNAL_API_TOKEN;
    }
  });

  // Import once — the function reads env var per call so no module reset needed
  let validateAuth: (req: IncomingMessage) => boolean;

  beforeAll(async () => {
    const mod = await import('../../../src/utils/api/internalApiAuth');
    validateAuth = mod.validateAuth;
  });

  test('should reject when token env var is not set', () => {
    delete process.env.COGWORKS_INTERNAL_API_TOKEN;
    const req = createMockRequest('Bearer some-token');
    expect(validateAuth(req)).toBe(false);
  });

  test('should reject when token env var is empty string', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = '';
    const req = createMockRequest('Bearer some-token');
    expect(validateAuth(req)).toBe(false);
  });

  test('should reject when no authorization header', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'test-secret-token';
    const req = createMockRequest();
    expect(validateAuth(req)).toBe(false);
  });

  test('should reject when authorization header is not Bearer', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'test-secret-token';
    const req = createMockRequest('Basic dXNlcjpwYXNz');
    expect(validateAuth(req)).toBe(false);
  });

  test('should reject when token does not match', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'correct-token-value';
    const req = createMockRequest('Bearer wrong-token-value!');
    expect(validateAuth(req)).toBe(false);
  });

  test('should reject when token length differs', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'short';
    const req = createMockRequest('Bearer a-much-longer-token-value');
    expect(validateAuth(req)).toBe(false);
  });

  test('should accept when token matches exactly', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'my-secret-api-token-12345';
    const req = createMockRequest('Bearer my-secret-api-token-12345');
    expect(validateAuth(req)).toBe(true);
  });

  test('should reject empty bearer token', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'test-token';
    const req = createMockRequest('Bearer ');
    expect(validateAuth(req)).toBe(false);
  });

  test('should reject Bearer prefix without space', () => {
    process.env.COGWORKS_INTERNAL_API_TOKEN = 'test-token';
    const req = createMockRequest('Bearertest-token');
    expect(validateAuth(req)).toBe(false);
  });
});
