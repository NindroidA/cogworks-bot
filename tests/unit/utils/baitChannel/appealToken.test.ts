import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildAppealUrl,
  signAppealToken,
  verifyAppealToken,
} from '../../../../src/utils/baitChannel/appealToken';

// Capture/restore env so tests don't leak state into siblings.
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.APPEAL_HMAC_SECRET;
  process.env.APPEAL_HMAC_SECRET = 'test-secret-of-sufficient-length-1234567890';
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.APPEAL_HMAC_SECRET;
  else process.env.APPEAL_HMAC_SECRET = originalSecret;
});

describe('appealToken — sign/verify round-trip', () => {
  test('round-trips and verifies', () => {
    const token = signAppealToken({
      guildId: '111',
      userId: '222',
      action: 'ban',
      banReason: 'phishing url posted in trap-channel',
    });
    const result = verifyAppealToken(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.guildId).toBe('111');
      expect(result.payload.userId).toBe('222');
      expect(result.payload.action).toBe('ban');
      expect(result.payload.iss).toBe('cogworks');
    }
  });

  test('rejects tampered payload', () => {
    const token = signAppealToken({ guildId: '111', userId: '222', action: 'ban' });
    // Swap the payload portion with an arbitrary valid-looking base64url payload.
    const tampered = `eyJndWlsZElkIjoiMzMzIn0.${token.split('.')[1]}`;
    const result = verifyAppealToken(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('invalid_signature');
  });

  test('rejects tampered signature', () => {
    const token = signAppealToken({ guildId: '111', userId: '222', action: 'ban' });
    const tampered = `${token.split('.')[0]}.abcdef0123456789`;
    const result = verifyAppealToken(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('invalid_signature');
  });

  test('rejects expired token', () => {
    const token = signAppealToken({
      guildId: '111',
      userId: '222',
      action: 'ban',
      expiresInHours: -1, // past
    });
    const result = verifyAppealToken(token);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('expired');
  });

  test('rejects malformed token (single segment)', () => {
    const result = verifyAppealToken('not-a-real-token');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('invalid_format');
  });

  test('throws when secret is missing on sign', () => {
    delete process.env.APPEAL_HMAC_SECRET;
    expect(() => signAppealToken({ guildId: '1', userId: '2', action: 'ban' })).toThrow(/APPEAL_HMAC_SECRET/);
  });
});

describe('buildAppealUrl', () => {
  test('returns full URL with token when configured', () => {
    const url = buildAppealUrl({
      guildId: '111',
      userId: '222',
      action: 'ban',
      baseUrl: 'https://app.cogworks.example/appeal',
    });
    expect(url).not.toBeNull();
    expect(url!).toContain('https://app.cogworks.example/appeal');
    expect(url!).toContain('token=');
  });

  test('returns null when baseUrl is missing', () => {
    expect(buildAppealUrl({ guildId: '1', userId: '2', action: 'ban', baseUrl: null })).toBeNull();
    expect(buildAppealUrl({ guildId: '1', userId: '2', action: 'ban', baseUrl: undefined })).toBeNull();
  });

  test('returns null when secret is missing (silent skip)', () => {
    delete process.env.APPEAL_HMAC_SECRET;
    const url = buildAppealUrl({
      guildId: '1',
      userId: '2',
      action: 'ban',
      baseUrl: 'https://app.example/appeal',
    });
    expect(url).toBeNull();
  });

  test('rejects http baseUrl', () => {
    expect(
      buildAppealUrl({
        guildId: '1',
        userId: '2',
        action: 'ban',
        baseUrl: 'http://insecure.example/appeal',
      }),
    ).toBeNull();
  });

  test('rejects malformed baseUrl', () => {
    expect(buildAppealUrl({ guildId: '1', userId: '2', action: 'ban', baseUrl: 'not-a-url' })).toBeNull();
  });
});
