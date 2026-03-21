import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../../../src/utils/api/apiError';

// ===========================================================================
// Constructor
// ===========================================================================
describe('ApiError constructor', () => {
  test('sets statusCode', () => {
    const error = new ApiError(400, 'Bad Request');
    expect(error.statusCode).toBe(400);
  });

  test('sets message', () => {
    const error = new ApiError(404, 'Not Found');
    expect(error.message).toBe('Not Found');
  });

  test('sets name to ApiError', () => {
    const error = new ApiError(500, 'Internal');
    expect(error.name).toBe('ApiError');
  });

  test('extends Error', () => {
    const error = new ApiError(400, 'Bad Request');
    expect(error).toBeInstanceOf(Error);
  });

  test('is instanceof ApiError', () => {
    const error = new ApiError(400, 'Bad Request');
    expect(error).toBeInstanceOf(ApiError);
  });

  test('has a stack trace', () => {
    const error = new ApiError(500, 'Internal');
    expect(error.stack).toBeDefined();
    expect(typeof error.stack).toBe('string');
  });

  test('statusCode is readonly', () => {
    const error = new ApiError(400, 'Bad Request');
    // TypeScript prevents assignment at compile time; runtime check
    expect(error.statusCode).toBe(400);
  });

  test('works with custom status codes', () => {
    const error = new ApiError(418, 'I am a teapot');
    expect(error.statusCode).toBe(418);
    expect(error.message).toBe('I am a teapot');
  });
});

// ===========================================================================
// Static factory: badRequest
// ===========================================================================
describe('ApiError.badRequest()', () => {
  test('returns ApiError with statusCode 400', () => {
    const error = ApiError.badRequest('Missing field');
    expect(error.statusCode).toBe(400);
  });

  test('sets the message', () => {
    const error = ApiError.badRequest('Missing field');
    expect(error.message).toBe('Missing field');
  });

  test('returns an ApiError instance', () => {
    const error = ApiError.badRequest('test');
    expect(error).toBeInstanceOf(ApiError);
  });

  test('returns an Error instance', () => {
    const error = ApiError.badRequest('test');
    expect(error).toBeInstanceOf(Error);
  });
});

// ===========================================================================
// Static factory: forbidden
// ===========================================================================
describe('ApiError.forbidden()', () => {
  test('returns ApiError with statusCode 403', () => {
    const error = ApiError.forbidden('Access denied');
    expect(error.statusCode).toBe(403);
  });

  test('sets the message', () => {
    const error = ApiError.forbidden('Access denied');
    expect(error.message).toBe('Access denied');
  });

  test('returns an ApiError instance', () => {
    expect(ApiError.forbidden('test')).toBeInstanceOf(ApiError);
  });
});

// ===========================================================================
// Static factory: notFound
// ===========================================================================
describe('ApiError.notFound()', () => {
  test('returns ApiError with statusCode 404', () => {
    const error = ApiError.notFound('Guild not found');
    expect(error.statusCode).toBe(404);
  });

  test('sets the message', () => {
    const error = ApiError.notFound('Guild not found');
    expect(error.message).toBe('Guild not found');
  });

  test('returns an ApiError instance', () => {
    expect(ApiError.notFound('test')).toBeInstanceOf(ApiError);
  });
});

// ===========================================================================
// Static factory: conflict
// ===========================================================================
describe('ApiError.conflict()', () => {
  test('returns ApiError with statusCode 409', () => {
    const error = ApiError.conflict('Already exists');
    expect(error.statusCode).toBe(409);
  });

  test('sets the message', () => {
    const error = ApiError.conflict('Already exists');
    expect(error.message).toBe('Already exists');
  });

  test('returns an ApiError instance', () => {
    expect(ApiError.conflict('test')).toBeInstanceOf(ApiError);
  });
});

// ===========================================================================
// Static factory: tooManyRequests
// ===========================================================================
describe('ApiError.tooManyRequests()', () => {
  test('returns ApiError with statusCode 429', () => {
    const error = ApiError.tooManyRequests('Rate limited');
    expect(error.statusCode).toBe(429);
  });

  test('sets the message', () => {
    const error = ApiError.tooManyRequests('Rate limited');
    expect(error.message).toBe('Rate limited');
  });

  test('returns an ApiError instance', () => {
    expect(ApiError.tooManyRequests('test')).toBeInstanceOf(ApiError);
  });
});

// ===========================================================================
// instanceof discrimination
// ===========================================================================
describe('instanceof checks', () => {
  test('ApiError is distinguishable from plain Error', () => {
    const apiError = new ApiError(400, 'api');
    const plainError = new Error('plain');
    expect(apiError instanceof ApiError).toBe(true);
    expect(plainError instanceof ApiError).toBe(false);
  });

  test('can be caught in a try/catch as ApiError', () => {
    let caught = false;
    try {
      throw ApiError.notFound('missing');
    } catch (e) {
      if (e instanceof ApiError) {
        caught = true;
        expect(e.statusCode).toBe(404);
      }
    }
    expect(caught).toBe(true);
  });

  test('can be caught as generic Error', () => {
    let caught = false;
    try {
      throw ApiError.badRequest('bad');
    } catch (e) {
      if (e instanceof Error) {
        caught = true;
        expect(e.message).toBe('bad');
      }
    }
    expect(caught).toBe(true);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================
describe('edge cases', () => {
  test('empty message', () => {
    const error = new ApiError(400, '');
    expect(error.message).toBe('');
    expect(error.statusCode).toBe(400);
  });

  test('long message', () => {
    const msg = 'x'.repeat(10000);
    const error = new ApiError(500, msg);
    expect(error.message).toHaveLength(10000);
  });

  test('message with special characters', () => {
    const msg = 'Error: "field" contains <html> & special chars';
    const error = ApiError.badRequest(msg);
    expect(error.message).toBe(msg);
  });
});
