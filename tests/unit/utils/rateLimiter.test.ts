import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RateLimits, createRateLimitKey, rateLimiter } from '../../../src/utils/security/rateLimiter';

describe('RateLimiter', () => {
  const orig = process.env.RELEASE;
  beforeEach(() => { process.env.RELEASE = 'prod'; });
  afterEach(() => { rateLimiter.destroy(); process.env.RELEASE = orig; });

  test('allows first', () => { expect(rateLimiter.check('t1', { maxAttempts: 3, windowMs: 60000 }).allowed).toBe(true); });
  test('denies over limit', () => {
    const c = { maxAttempts: 2, windowMs: 60000 };
    rateLimiter.check('t2', c); rateLimiter.check('t2', c);
    expect(rateLimiter.check('t2', c).allowed).toBe(false);
  });
  test('reset clears', () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check('t3', c); rateLimiter.check('t3', c);
    rateLimiter.reset('t3'); expect(rateLimiter.check('t3', c).allowed).toBe(true);
  });
  test('keys independent', () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check('a', c); rateLimiter.check('a', c);
    expect(rateLimiter.check('b', c).allowed).toBe(true);
  });
  test('window expiry', async () => {
    const c = { maxAttempts: 1, windowMs: 50 };
    rateLimiter.check('t4', c); expect(rateLimiter.check('t4', c).allowed).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(rateLimiter.check('t4', c).allowed).toBe(true);
  });
  test('getSize increases', () => {
    const c = { maxAttempts: 5, windowMs: 60000 }; const b = rateLimiter.getSize();
    rateLimiter.check('s1', c); rateLimiter.check('s2', c);
    expect(rateLimiter.getSize()).toBe(b + 2);
  });
  test('dev mode bypasses', () => {
    process.env.RELEASE = 'dev'; rateLimiter.destroy();
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check('d1', c); expect(rateLimiter.check('d1', c).allowed).toBe(true);
  });
  test('denied has message', () => {
    const c = { maxAttempts: 1, windowMs: 60000 };
    rateLimiter.check('m1', c); const r = rateLimiter.check('m1', c);
    expect(r.message).toBeDefined(); expect(r.resetIn).toBeGreaterThan(0);
  });
});

describe('createRateLimitKey', () => {
  test('user', () => { expect(createRateLimitKey.user('123', 'ticket')).toBe('user:123:ticket'); });
  test('guild', () => { expect(createRateLimitKey.guild('456', 'export')).toBe('guild:456:export'); });
  test('globalUser', () => { expect(createRateLimitKey.globalUser('789')).toBe('global:user:789'); });
});

describe('RateLimits', () => {
  test('all have shape', () => { for (const k of Object.keys(RateLimits)) { const c = RateLimits[k as keyof typeof RateLimits]; expect(c.maxAttempts).toBeGreaterThan(0); expect(c.windowMs).toBeGreaterThan(0); } });
  test('TICKET_CREATE 3/hr', () => { expect(RateLimits.TICKET_CREATE.maxAttempts).toBe(3); });
  test('GLOBAL_COMMAND 30/min', () => { expect(RateLimits.GLOBAL_COMMAND.maxAttempts).toBe(30); });
});
