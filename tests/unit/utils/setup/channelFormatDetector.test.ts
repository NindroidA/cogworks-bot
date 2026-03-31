import { describe, test, expect } from 'bun:test';
import {
  formatChannelName,
  formatCategoryName,
  type ChannelFormat,
} from '../../../../src/utils/setup/channelFormatDetector';

// Helper to build a ChannelFormat with defaults
function fmt(overrides: Partial<ChannelFormat> = {}): ChannelFormat {
  return { separator: '-', casing: 'lower', emojiPrefix: false, confidence: 0.5, ...overrides };
}

describe('formatChannelName', () => {
  test('lowercases and replaces spaces with hyphens', () => {
    expect(formatChannelName('Ticket Archive', undefined, fmt())).toBe('ticket-archive');
  });

  test('handles single-word name', () => {
    expect(formatChannelName('tickets', undefined, fmt())).toBe('tickets');
  });

  test('handles multiple spaces between words', () => {
    expect(formatChannelName('ticket   archive   log', undefined, fmt())).toBe('ticket-archive-log');
  });

  test('prepends emoji with detected separator when emojiPrefix is true', () => {
    const format = fmt({ separator: '︱', emojiPrefix: true, confidence: 0.8 });
    expect(formatChannelName('tickets', '🎫', format)).toBe('🎫︱tickets');
  });

  test('does not prepend emoji when emojiPrefix is false', () => {
    const format = fmt({ emojiPrefix: false });
    expect(formatChannelName('tickets', '🎫', format)).toBe('tickets');
  });

  test('does not prepend emoji when emoji is undefined', () => {
    const format = fmt({ emojiPrefix: true });
    expect(formatChannelName('tickets', undefined, format)).toBe('tickets');
  });

  test('uses dash separator between emoji and name when separator is dash', () => {
    const format = fmt({ separator: '-', emojiPrefix: true });
    expect(formatChannelName('tickets', '🎫', format)).toBe('🎫-tickets');
  });

  test('uses pipe separator between emoji and name', () => {
    const format = fmt({ separator: '│', emojiPrefix: true });
    expect(formatChannelName('tickets', '🎫', format)).toBe('🎫│tickets');
  });

  test('always lowercases regardless of casing format', () => {
    const format = fmt({ casing: 'upper', emojiPrefix: false });
    expect(formatChannelName('TICKET ARCHIVE', undefined, format)).toBe('ticket-archive');
  });

  test('truncates to 100 characters', () => {
    const longName = 'a'.repeat(120);
    const result = formatChannelName(longName, undefined, fmt());
    expect(result.length).toBe(100);
  });

  test('truncates including emoji prefix to 100 characters', () => {
    const longName = 'a'.repeat(99);
    const format = fmt({ separator: '︱', emojiPrefix: true });
    const result = formatChannelName(longName, '🎫', format);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  test('handles empty emoji string (falsy) without prefix', () => {
    const format = fmt({ emojiPrefix: true });
    expect(formatChannelName('tickets', '', format)).toBe('tickets');
  });
});

describe('formatCategoryName', () => {
  describe('casing', () => {
    test('lower casing lowercases the name', () => {
      expect(formatCategoryName('Ticket System', undefined, fmt({ casing: 'lower' }))).toBe('ticket system');
    });

    test('title casing capitalizes each word', () => {
      expect(formatCategoryName('ticket system', undefined, fmt({ casing: 'title' }))).toBe('Ticket System');
    });

    test('title casing lowercases rest of each word', () => {
      expect(formatCategoryName('TICKET SYSTEM', undefined, fmt({ casing: 'title' }))).toBe('Ticket System');
    });

    test('upper casing uppercases the name', () => {
      expect(formatCategoryName('ticket system', undefined, fmt({ casing: 'upper' }))).toBe('TICKET SYSTEM');
    });
  });

  describe('emoji prefix', () => {
    test('prepends emoji with space when emojiPrefix is true', () => {
      const format = fmt({ casing: 'title', emojiPrefix: true });
      expect(formatCategoryName('Tickets', '🎫', format)).toBe('🎫 Tickets');
    });

    test('does not prepend emoji when emojiPrefix is false', () => {
      const format = fmt({ casing: 'title', emojiPrefix: false });
      expect(formatCategoryName('Tickets', '🎫', format)).toBe('Tickets');
    });

    test('does not prepend emoji when emoji is undefined', () => {
      const format = fmt({ casing: 'lower', emojiPrefix: true });
      expect(formatCategoryName('Tickets', undefined, format)).toBe('tickets');
    });

    test('does not prepend emoji when emoji is empty string', () => {
      const format = fmt({ casing: 'lower', emojiPrefix: true });
      expect(formatCategoryName('Tickets', '', format)).toBe('tickets');
    });
  });

  describe('combined casing + emoji', () => {
    test('lower casing with emoji prefix', () => {
      const format = fmt({ casing: 'lower', emojiPrefix: true });
      expect(formatCategoryName('Ticket System', '🎫', format)).toBe('🎫 ticket system');
    });

    test('upper casing with emoji prefix', () => {
      const format = fmt({ casing: 'upper', emojiPrefix: true });
      expect(formatCategoryName('ticket system', '🎫', format)).toBe('🎫 TICKET SYSTEM');
    });

    test('title casing with emoji prefix', () => {
      const format = fmt({ casing: 'title', emojiPrefix: true });
      expect(formatCategoryName('ticket system', '🎫', format)).toBe('🎫 Ticket System');
    });
  });

  describe('truncation', () => {
    test('truncates to 100 characters', () => {
      const longName = 'a'.repeat(120);
      const result = formatCategoryName(longName, undefined, fmt());
      expect(result.length).toBe(100);
    });

    test('truncates including emoji prefix to 100 characters', () => {
      const longName = 'a'.repeat(99);
      const format = fmt({ casing: 'lower', emojiPrefix: true });
      const result = formatCategoryName(longName, '🎫', format);
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });
});
