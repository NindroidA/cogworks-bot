import {
  analyzeUsername,
  hasDigitSuffix,
  hasRepeatingChars,
  isHexString,
  lacksVowels,
} from '../../../../src/utils/baitChannel/usernameAnalyzer';

describe('usernameAnalyzer', () => {
  describe('hasDigitSuffix', () => {
    it('should detect usernames ending with 4+ digits', () => {
      expect(hasDigitSuffix('user12345')).toBe(true);
      expect(hasDigitSuffix('john8392')).toBe(true);
      expect(hasDigitSuffix('ab12345678')).toBe(true);
    });

    it('should NOT flag usernames with 3 or fewer trailing digits', () => {
      expect(hasDigitSuffix('bob123')).toBe(false);
      expect(hasDigitSuffix('user99')).toBe(false);
      expect(hasDigitSuffix('hello1')).toBe(false);
    });

    it('should NOT flag usernames that are only digits', () => {
      // Requires 2+ letter prefix
      expect(hasDigitSuffix('12345')).toBe(false);
      expect(hasDigitSuffix('1')).toBe(false);
    });

    it('should NOT flag normal usernames', () => {
      expect(hasDigitSuffix('JohnDoe')).toBe(false);
      expect(hasDigitSuffix('gaming_pro')).toBe(false);
    });
  });

  describe('isHexString', () => {
    it('should detect 8+ character hex strings', () => {
      expect(isHexString('a3f8b2c1')).toBe(true);
      expect(isHexString('a3f8b2c1d9e0')).toBe(true);
      expect(isHexString('ABCDEF01')).toBe(true);
    });

    it('should NOT flag strings shorter than 8 hex chars', () => {
      expect(isHexString('a3f8b2c')).toBe(false);
      expect(isHexString('abc')).toBe(false);
    });

    it('should NOT flag strings with non-hex characters', () => {
      expect(isHexString('a3f8b2g1')).toBe(false); // 'g' is not hex
      expect(isHexString('hello world')).toBe(false);
    });
  });

  describe('hasRepeatingChars', () => {
    it('should detect 5+ identical consecutive characters', () => {
      expect(hasRepeatingChars('aaaaaaa')).toBe(true);
      expect(hasRepeatingChars('xxxxx')).toBe(true);
      expect(hasRepeatingChars('testzzzzz')).toBe(true);
    });

    it('should NOT flag 4 or fewer consecutive repeats', () => {
      expect(hasRepeatingChars('aaaa')).toBe(false);
      expect(hasRepeatingChars('aabb')).toBe(false);
      expect(hasRepeatingChars('test')).toBe(false);
    });
  });

  describe('lacksVowels', () => {
    it('should flag long strings (8+) with no vowels', () => {
      expect(lacksVowels('bcdfghjk')).toBe(true);
      expect(lacksVowels('xyzwqrst12')).toBe(true);
    });

    it('should NOT flag short strings (< 8 chars)', () => {
      expect(lacksVowels('brk')).toBe(false);
      expect(lacksVowels('xyz')).toBe(false);
      expect(lacksVowels('bcdfghj')).toBe(false); // exactly 7
    });

    it('should NOT flag strings containing vowels', () => {
      expect(lacksVowels('beautiful')).toBe(false);
      expect(lacksVowels('bcdfghja')).toBe(false); // has 'a'
    });
  });

  describe('analyzeUsername', () => {
    it('should NOT flag normal usernames', () => {
      const normalNames = [
        'JohnDoe',
        'CoolUser2023',
        'gaming_pro',
        'xXDragonSlayerXx',
        'sarah',
        'bob123', // only 3 digits
      ];
      for (const name of normalNames) {
        const result = analyzeUsername(name);
        expect(result.isSuspicious).toBe(false);
        expect(result.patterns).toEqual([]);
      }
    });

    it('should flag hex string usernames (strong signal)', () => {
      const result = analyzeUsername('a3f8b2c1d9e0f4');
      expect(result.isSuspicious).toBe(true);
      expect(result.patterns).toContain('hex string');
    });

    it('should flag strong repeating chars (7+)', () => {
      const result = analyzeUsername('aaaaaaaaaa');
      expect(result.isSuspicious).toBe(true);
      expect(result.patterns).toContain('repeating chars');
    });

    it('should flag when 2+ weak patterns match', () => {
      // digit suffix + no vowels = 2 patterns
      const result = analyzeUsername('bcdfg1234');
      expect(result.isSuspicious).toBe(true);
      expect(result.patterns.length).toBeGreaterThanOrEqual(2);
    });

    it('should NOT flag single weak pattern alone', () => {
      // Only digit suffix, nothing else
      const result = analyzeUsername('user1234');
      expect(result.isSuspicious).toBe(false);
    });

    it('should handle empty string without crashing', () => {
      const result = analyzeUsername('');
      expect(result.isSuspicious).toBe(false);
      expect(result.patterns).toEqual([]);
    });

    it('should handle single character', () => {
      const result = analyzeUsername('a');
      expect(result.isSuspicious).toBe(false);
    });

    it('should NOT flag unicode usernames', () => {
      const result = analyzeUsername('\u5927\u548C\u592A\u90CE');
      expect(result.isSuspicious).toBe(false);
    });

    it('should NOT flag CJK usernames', () => {
      const result = analyzeUsername('\uD55C\uAD6D\uC5B4\uC0AC\uC6A9\uC790');
      expect(result.isSuspicious).toBe(false);
    });

    it('should handle very long usernames', () => {
      const longName = 'a'.repeat(200);
      // This has repeating chars (strong signal)
      const result = analyzeUsername(longName);
      expect(result.isSuspicious).toBe(true);
    });

    it('should flag 5 repeating chars only when combined with another signal', () => {
      // 'xxxxx' alone — repeating chars is 1 weak signal
      // But xxxxx is only 5 chars long so lacksVowels won't trigger (< 8)
      // and no digit suffix, no hex → only 1 pattern → NOT suspicious
      const result = analyzeUsername('xxxxx');
      expect(result.isSuspicious).toBe(false);
    });
  });
});
