import { describe, expect, test } from 'bun:test';
import { ApiError } from '../../../../src/utils/api/apiError';
import {
  extractId,
  requireId,
  isValidSnowflake,
  validateHexColor,
  requireString,
  optionalString,
  requireNumber,
  optionalNumber,
  requireBoolean,
  optionalStringArray,
} from '../../../../src/utils/api/helpers';

// ===========================================================================
// extractId
// ===========================================================================
describe('extractId', () => {
  test('extracts numeric ID from URL', () => {
    expect(extractId('/tickets/123/close', 'tickets')).toBe(123);
  });

  test('extracts ID from different segment', () => {
    expect(extractId('/guilds/456/members', 'guilds')).toBe(456);
  });

  test('returns null when segment is missing', () => {
    expect(extractId('/tickets/123/close', 'users')).toBeNull();
  });

  test('returns null for non-numeric value after segment', () => {
    expect(extractId('/tickets/abc/close', 'tickets')).toBeNull();
  });

  test('extracts correct ID when multiple segments present', () => {
    expect(extractId('/guilds/111/tickets/222/close', 'tickets')).toBe(222);
    expect(extractId('/guilds/111/tickets/222/close', 'guilds')).toBe(111);
  });

  test('handles ID at end of URL', () => {
    expect(extractId('/tickets/99', 'tickets')).toBe(99);
  });

  test('returns null for empty URL', () => {
    expect(extractId('', 'tickets')).toBeNull();
  });
});

// ===========================================================================
// requireId
// ===========================================================================
describe('requireId', () => {
  test('returns number when ID is present', () => {
    expect(requireId('/tickets/42/close', 'tickets')).toBe(42);
  });

  test('throws ApiError 400 when segment is missing', () => {
    expect(() => requireId('/tickets/42', 'users')).toThrow();
    try {
      requireId('/tickets/42', 'users');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
    }
  });

  test('throws ApiError 400 for non-numeric ID', () => {
    expect(() => requireId('/tickets/abc', 'tickets')).toThrow();
    try {
      requireId('/tickets/abc', 'tickets');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
    }
  });

  test('error message includes segment name', () => {
    try {
      requireId('/foo/bar', 'tickets');
    } catch (e) {
      expect((e as ApiError).message).toContain('tickets');
    }
  });
});

// ===========================================================================
// isValidSnowflake
// ===========================================================================
describe('isValidSnowflake', () => {
  test('valid 17-digit snowflake', () => {
    expect(isValidSnowflake('12345678901234567')).toBe(true);
  });

  test('valid 18-digit snowflake', () => {
    expect(isValidSnowflake('123456789012345678')).toBe(true);
  });

  test('valid 19-digit snowflake', () => {
    expect(isValidSnowflake('1234567890123456789')).toBe(true);
  });

  test('valid 20-digit snowflake', () => {
    expect(isValidSnowflake('12345678901234567890')).toBe(true);
  });

  test('too short (16 digits)', () => {
    expect(isValidSnowflake('1234567890123456')).toBe(false);
  });

  test('too long (21 digits)', () => {
    expect(isValidSnowflake('123456789012345678901')).toBe(false);
  });

  test('non-numeric string', () => {
    expect(isValidSnowflake('abc')).toBe(false);
  });

  test('alphanumeric string', () => {
    expect(isValidSnowflake('12345678901234567a')).toBe(false);
  });

  test('empty string', () => {
    expect(isValidSnowflake('')).toBe(false);
  });

  test('very short number', () => {
    expect(isValidSnowflake('1234')).toBe(false);
  });
});

// ===========================================================================
// validateHexColor
// ===========================================================================
describe('validateHexColor', () => {
  test('valid uppercase color returns null', () => {
    expect(validateHexColor('#5865F2')).toBeNull();
  });

  test('valid lowercase color returns null', () => {
    expect(validateHexColor('#ff0000')).toBeNull();
  });

  test('valid mixed case returns null', () => {
    expect(validateHexColor('#aaBBcc')).toBeNull();
  });

  test('missing hash returns error string', () => {
    const result = validateHexColor('FF0000');
    expect(result).toBeString();
    expect(result).not.toBeNull();
  });

  test('3-digit shorthand returns error string', () => {
    const result = validateHexColor('#FFF');
    expect(result).toBeString();
    expect(result).not.toBeNull();
  });

  test('invalid hex chars returns error string', () => {
    const result = validateHexColor('#GGGGGG');
    expect(result).toBeString();
    expect(result).not.toBeNull();
  });

  test('too many digits returns error string', () => {
    const result = validateHexColor('#FF00FF00');
    expect(result).toBeString();
    expect(result).not.toBeNull();
  });

  test('empty string returns error string', () => {
    const result = validateHexColor('');
    expect(result).toBeString();
    expect(result).not.toBeNull();
  });
});

// ===========================================================================
// requireString
// ===========================================================================
describe('requireString', () => {
  test('returns string value', () => {
    expect(requireString({ name: 'hello' }, 'name')).toBe('hello');
  });

  test('trims whitespace', () => {
    expect(requireString({ name: '  hello  ' }, 'name')).toBe('hello');
  });

  test('throws ApiError 400 when field is missing', () => {
    try {
      requireString({}, 'name');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is empty string', () => {
    try {
      requireString({ name: '' }, 'name');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is whitespace-only', () => {
    try {
      requireString({ name: '   ' }, 'name');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a number', () => {
    try {
      requireString({ name: 42 }, 'name');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is null', () => {
    try {
      requireString({ name: null }, 'name');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is undefined', () => {
    try {
      requireString({ name: undefined }, 'name');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('error message includes field name', () => {
    try {
      requireString({}, 'channelId');
    } catch (e) {
      expect((e as ApiError).message).toContain('channelId');
      return;
    }
    throw new Error('Expected to throw');
  });
});

// ===========================================================================
// optionalString
// ===========================================================================
describe('optionalString', () => {
  test('returns trimmed string when present', () => {
    expect(optionalString({ color: '  blue  ' }, 'color')).toBe('blue');
  });

  test('returns undefined when field is missing', () => {
    expect(optionalString({}, 'color')).toBeUndefined();
  });

  test('returns undefined when field is null', () => {
    expect(optionalString({ color: null }, 'color')).toBeUndefined();
  });

  test('returns undefined when field is empty string', () => {
    expect(optionalString({ color: '' }, 'color')).toBeUndefined();
  });

  test('returns undefined when field is whitespace-only', () => {
    expect(optionalString({ color: '   ' }, 'color')).toBeUndefined();
  });

  test('throws ApiError 400 when field is wrong type', () => {
    try {
      optionalString({ color: 123 }, 'color');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a boolean', () => {
    try {
      optionalString({ color: true }, 'color');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });
});

// ===========================================================================
// requireNumber
// ===========================================================================
describe('requireNumber', () => {
  test('returns number value', () => {
    expect(requireNumber({ count: 5 }, 'count')).toBe(5);
  });

  test('returns zero', () => {
    expect(requireNumber({ count: 0 }, 'count')).toBe(0);
  });

  test('returns negative number', () => {
    expect(requireNumber({ count: -10 }, 'count')).toBe(-10);
  });

  test('returns float', () => {
    expect(requireNumber({ count: 3.14 }, 'count')).toBe(3.14);
  });

  test('throws ApiError 400 when field is missing', () => {
    try {
      requireNumber({}, 'count');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is NaN', () => {
    try {
      requireNumber({ count: NaN }, 'count');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a string', () => {
    try {
      requireNumber({ count: '5' }, 'count');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is null', () => {
    try {
      requireNumber({ count: null }, 'count');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });
});

// ===========================================================================
// optionalNumber
// ===========================================================================
describe('optionalNumber', () => {
  test('returns number when present', () => {
    expect(optionalNumber({ limit: 10 }, 'limit')).toBe(10);
  });

  test('returns zero', () => {
    expect(optionalNumber({ limit: 0 }, 'limit')).toBe(0);
  });

  test('returns undefined when field is missing', () => {
    expect(optionalNumber({}, 'limit')).toBeUndefined();
  });

  test('returns undefined when field is null', () => {
    expect(optionalNumber({ limit: null }, 'limit')).toBeUndefined();
  });

  test('throws ApiError 400 when field is NaN', () => {
    try {
      optionalNumber({ limit: NaN }, 'limit');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a string', () => {
    try {
      optionalNumber({ limit: '10' }, 'limit');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a boolean', () => {
    try {
      optionalNumber({ limit: true }, 'limit');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });
});

// ===========================================================================
// requireBoolean
// ===========================================================================
describe('requireBoolean', () => {
  test('returns true', () => {
    expect(requireBoolean({ enabled: true }, 'enabled')).toBe(true);
  });

  test('returns false', () => {
    expect(requireBoolean({ enabled: false }, 'enabled')).toBe(false);
  });

  test('throws ApiError 400 when field is missing', () => {
    try {
      requireBoolean({}, 'enabled');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a string', () => {
    try {
      requireBoolean({ enabled: 'true' }, 'enabled');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a number', () => {
    try {
      requireBoolean({ enabled: 1 }, 'enabled');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is null', () => {
    try {
      requireBoolean({ enabled: null }, 'enabled');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });
});

// ===========================================================================
// optionalStringArray
// ===========================================================================
describe('optionalStringArray', () => {
  test('returns array of strings', () => {
    expect(optionalStringArray({ tags: ['a', 'b'] }, 'tags')).toEqual(['a', 'b']);
  });

  test('returns empty array', () => {
    expect(optionalStringArray({ tags: [] }, 'tags')).toEqual([]);
  });

  test('returns undefined when field is missing', () => {
    expect(optionalStringArray({}, 'tags')).toBeUndefined();
  });

  test('returns undefined when field is null', () => {
    expect(optionalStringArray({ tags: null }, 'tags')).toBeUndefined();
  });

  test('throws ApiError 400 when field is not an array', () => {
    try {
      optionalStringArray({ tags: 'not-an-array' }, 'tags');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when array contains non-strings', () => {
    try {
      optionalStringArray({ tags: ['a', 123] }, 'tags');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when array contains mixed types', () => {
    try {
      optionalStringArray({ tags: ['a', true, null] }, 'tags');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });

  test('throws when field is a number', () => {
    try {
      optionalStringArray({ tags: 42 }, 'tags');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(400);
      return;
    }
    throw new Error('Expected to throw');
  });
});
