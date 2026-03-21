import { describe, expect, test } from 'bun:test';
import {
  buildProgressBar,
  calculateLevel,
  randomXp,
  xpForLevel,
  xpForNextLevel,
  xpProgress,
} from '../../../../src/utils/xp/xpCalculator';

// ===========================================================================
// calculateLevel
// ===========================================================================
describe('calculateLevel()', () => {
  test('returns 0 for 0 XP', () => {
    expect(calculateLevel(0)).toBe(0);
  });

  test('returns 0 for negative XP', () => {
    expect(calculateLevel(-100)).toBe(0);
  });

  test('returns 0 for XP just below level 1 threshold', () => {
    // Level 1 requires xp >= (1/0.1)^2 = 100
    expect(calculateLevel(99)).toBe(0);
  });

  test('returns 1 at exactly 100 XP', () => {
    expect(calculateLevel(100)).toBe(1);
  });

  test('returns 1 for XP between 100 and 399', () => {
    expect(calculateLevel(200)).toBe(1);
    expect(calculateLevel(399)).toBe(1);
  });

  test('returns 2 at exactly 400 XP', () => {
    expect(calculateLevel(400)).toBe(2);
  });

  test('returns 3 at exactly 900 XP', () => {
    expect(calculateLevel(900)).toBe(3);
  });

  test('returns 5 at exactly 2500 XP', () => {
    expect(calculateLevel(2500)).toBe(5);
  });

  test('returns 10 at exactly 10000 XP', () => {
    expect(calculateLevel(10000)).toBe(10);
  });

  test('returns 100 at exactly 1000000 XP', () => {
    expect(calculateLevel(1_000_000)).toBe(100);
  });

  test('handles large XP values', () => {
    expect(calculateLevel(10_000_000)).toBe(316);
  });

  test('formula: floor(0.1 * sqrt(xp))', () => {
    for (const xp of [50, 150, 500, 1000, 5000, 25000]) {
      expect(calculateLevel(xp)).toBe(Math.floor(0.1 * Math.sqrt(xp)));
    }
  });
});

// ===========================================================================
// xpForLevel
// ===========================================================================
describe('xpForLevel()', () => {
  test('returns 0 for level 0', () => {
    expect(xpForLevel(0)).toBe(0);
  });

  test('returns 0 for negative level', () => {
    expect(xpForLevel(-1)).toBe(0);
  });

  test('returns 100 for level 1', () => {
    expect(xpForLevel(1)).toBe(100);
  });

  test('returns 400 for level 2', () => {
    expect(xpForLevel(2)).toBe(400);
  });

  test('returns 10000 for level 10', () => {
    expect(xpForLevel(10)).toBe(10000);
  });

  test('formula: level^2 * 100', () => {
    for (const level of [1, 3, 5, 7, 15, 50]) {
      expect(xpForLevel(level)).toBe(level * level * 100);
    }
  });

  test('xpForLevel is inverse of calculateLevel at exact boundaries', () => {
    for (const level of [1, 2, 5, 10, 20, 50]) {
      const xp = xpForLevel(level);
      expect(calculateLevel(xp)).toBe(level);
    }
  });
});

// ===========================================================================
// xpForNextLevel
// ===========================================================================
describe('xpForNextLevel()', () => {
  test('returns 100 for level 0 (XP needed for level 1)', () => {
    expect(xpForNextLevel(0)).toBe(100);
  });

  test('returns 400 for level 1 (XP needed for level 2)', () => {
    expect(xpForNextLevel(1)).toBe(400);
  });

  test('returns 900 for level 2', () => {
    expect(xpForNextLevel(2)).toBe(900);
  });

  test('returns 12100 for level 10', () => {
    expect(xpForNextLevel(10)).toBe(12100);
  });

  test('formula: (level+1)^2 * 100', () => {
    for (const level of [0, 1, 5, 10, 25, 99]) {
      expect(xpForNextLevel(level)).toBe((level + 1) ** 2 * 100);
    }
  });

  test('xpForNextLevel(level) equals xpForLevel(level+1)', () => {
    for (const level of [0, 1, 3, 7, 20]) {
      expect(xpForNextLevel(level)).toBe(xpForLevel(level + 1));
    }
  });
});

// ===========================================================================
// xpProgress
// ===========================================================================
describe('xpProgress()', () => {
  test('returns 0/100/0% at start of level 0', () => {
    const result = xpProgress(0, 0);
    expect(result.current).toBe(0);
    expect(result.needed).toBe(100);
    expect(result.percentage).toBe(0);
  });

  test('returns 50/100/50% halfway through level 0', () => {
    const result = xpProgress(50, 0);
    expect(result.current).toBe(50);
    expect(result.needed).toBe(100);
    expect(result.percentage).toBe(50);
  });

  test('returns correct progress at exact level boundary', () => {
    const result = xpProgress(100, 1);
    expect(result.current).toBe(0);
    expect(result.needed).toBe(300); // xpForNextLevel(1)=400, xpForLevel(1)=100
    expect(result.percentage).toBe(0);
  });

  test('calculates progress within level 1', () => {
    const result = xpProgress(250, 1);
    expect(result.current).toBe(150); // 250 - 100
    expect(result.needed).toBe(300); // 400 - 100
    expect(result.percentage).toBe(50);
  });

  test('percentage is capped at 100', () => {
    // If xp exceeds next level somehow
    const result = xpProgress(500, 1);
    expect(result.percentage).toBe(100);
  });

  test('percentage is floored (no decimals)', () => {
    // 33.3% should be 33
    const result = xpProgress(199, 1); // current=99, needed=300
    expect(result.percentage).toBe(33);
  });

  test('handles high levels', () => {
    const result = xpProgress(10500, 10);
    expect(result.current).toBe(500); // 10500 - 10000
    expect(result.needed).toBe(2100); // 12100 - 10000
    expect(result.percentage).toBe(23);
  });
});

// ===========================================================================
// randomXp
// ===========================================================================
describe('randomXp()', () => {
  test('returns values within min/max range', () => {
    for (let i = 0; i < 100; i++) {
      const result = randomXp(10, 25);
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(25);
    }
  });

  test('returns exact value when min equals max', () => {
    for (let i = 0; i < 20; i++) {
      expect(randomXp(15, 15)).toBe(15);
    }
  });

  test('returns integer values', () => {
    for (let i = 0; i < 50; i++) {
      const result = randomXp(1, 100);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  test('returns min or max inclusively over many runs', () => {
    const results = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      results.add(randomXp(1, 3));
    }
    expect(results.has(1)).toBe(true);
    expect(results.has(3)).toBe(true);
  });

  test('handles 0 as min', () => {
    for (let i = 0; i < 50; i++) {
      const result = randomXp(0, 5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(5);
    }
  });
});

// ===========================================================================
// buildProgressBar
// ===========================================================================
describe('buildProgressBar()', () => {
  test('returns all empty at 0%', () => {
    const bar = buildProgressBar(0);
    expect(bar).toBe('[\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591] 0%');
  });

  test('returns all filled at 100%', () => {
    const bar = buildProgressBar(100);
    expect(bar).toBe('[\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588] 100%');
  });

  test('returns roughly half filled at 50%', () => {
    const bar = buildProgressBar(50);
    expect(bar).toContain('50%');
    // 50% of 16 = 8 filled
    expect(bar).toContain('\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588');
  });

  test('clamps percentage above 100 to 100', () => {
    const bar = buildProgressBar(150);
    expect(bar).toContain('100%');
  });

  test('clamps negative percentage to 0', () => {
    const bar = buildProgressBar(-20);
    expect(bar).toContain('0%');
  });

  test('respects custom bar length', () => {
    const bar = buildProgressBar(50, 10);
    // 50% of 10 = 5 filled, 5 empty
    const innerBar = bar.slice(1, bar.indexOf(']'));
    expect(innerBar.length).toBe(10);
  });

  test('format is [bar] percentage%', () => {
    const bar = buildProgressBar(25);
    expect(bar).toMatch(/^\[.+\] \d+%$/);
  });

  test('uses correct characters', () => {
    const bar = buildProgressBar(50, 4);
    // 50% of 4 = 2 filled, 2 empty
    expect(bar).toBe('[\u2588\u2588\u2591\u2591] 50%');
  });
});
