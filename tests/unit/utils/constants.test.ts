import { describe, test, expect } from 'bun:test';
import { CACHE_TTL, DEFAULT_TICKET_STATUSES, INTERVALS, JOIN_VELOCITY, MAX, REQUIRED_WORKFLOW_STATUSES, RETENTION_DAYS, TEXT_LIMITS } from '../../../src/utils/constants';

describe('constant groups exist', () => {
  test('CACHE_TTL', () => { expect(typeof CACHE_TTL).toBe('object'); });
  test('INTERVALS', () => { expect(typeof INTERVALS).toBe('object'); });
  test('RETENTION_DAYS', () => { expect(typeof RETENTION_DAYS).toBe('object'); });
  test('MAX', () => { expect(typeof MAX).toBe('object'); });
  test('TEXT_LIMITS', () => { expect(typeof TEXT_LIMITS).toBe('object'); });
  test('JOIN_VELOCITY', () => { expect(typeof JOIN_VELOCITY).toBe('object'); });
});

describe('values positive', () => {
  test('CACHE_TTL', () => { for (const v of Object.values(CACHE_TTL)) expect(v).toBeGreaterThan(0); });
  test('INTERVALS', () => { for (const v of Object.values(INTERVALS)) expect(v).toBeGreaterThan(0); });
  test('RETENTION_DAYS', () => { for (const v of Object.values(RETENTION_DAYS)) expect(v).toBeGreaterThan(0); });
  test('MAX', () => { for (const v of Object.values(MAX)) expect(v).toBeGreaterThan(0); });
});

describe('critical values', () => {
  test('MAX.BAIT_KEYWORDS_PER_GUILD === 50', () => { expect(MAX.BAIT_KEYWORDS_PER_GUILD).toBe(50); });
  test('MAX.CUSTOM_FIELDS_PER_ENTITY === 5', () => { expect(MAX.CUSTOM_FIELDS_PER_ENTITY).toBe(5); });
  test('RETENTION_DAYS.BAIT_LOG === 90', () => { expect(RETENTION_DAYS.BAIT_LOG).toBe(90); });
  test('JOIN_VELOCITY.MAX_WINDOW_MS === 600000', () => { expect(JOIN_VELOCITY.MAX_WINDOW_MS).toBe(600000); });
});

describe('DEFAULT_TICKET_STATUSES', () => {
  test('is array', () => { expect(Array.isArray(DEFAULT_TICKET_STATUSES)).toBe(true); });
  test('has open', () => { expect(DEFAULT_TICKET_STATUSES.find(s => s.id === 'open')).toBeDefined(); });
  test('has closed', () => { expect(DEFAULT_TICKET_STATUSES.find(s => s.id === 'closed')).toBeDefined(); });
  test('each has required fields', () => { for (const s of DEFAULT_TICKET_STATUSES) { expect(typeof s.id).toBe('string'); expect(typeof s.label).toBe('string'); } });
});

describe('REQUIRED_WORKFLOW_STATUSES', () => {
  test('contains open', () => { expect(REQUIRED_WORKFLOW_STATUSES).toContain('open'); });
  test('contains closed', () => { expect(REQUIRED_WORKFLOW_STATUSES).toContain('closed'); });
});
