import { describe, test, expect } from 'bun:test';
import { hasDigitSuffix, isHexString, hasRepeatingChars, lacksVowels, analyzeUsername } from '../../../../src/utils/baitChannel/usernameAnalyzer';

describe('hasDigitSuffix', () => {
  test('detects', () => { expect(hasDigitSuffix('user12345')).toBe(true); });
  test('needs 4+', () => { expect(hasDigitSuffix('user123')).toBe(false); });
  test('needs letters', () => { expect(hasDigitSuffix('12345')).toBe(false); });
  test('normal', () => { expect(hasDigitSuffix('cool')).toBe(false); });
});

describe('isHexString', () => {
  test('detects hex', () => { expect(isHexString('a1b2c3d4e5f6')).toBe(true); });
  test('needs 8+', () => { expect(isHexString('a1b2c3')).toBe(false); });
  test('non-hex', () => { expect(isHexString('ghijklmnop')).toBe(false); });
});

describe('hasRepeatingChars', () => {
  test('5+ repeating', () => { expect(hasRepeatingChars('aaaaaa')).toBe(true); });
  test('4 not enough', () => { expect(hasRepeatingChars('aaaa')).toBe(false); });
});

describe('lacksVowels', () => {
  test('long no vowels', () => { expect(lacksVowels('bcdfghjk')).toBe(true); });
  test('short exempt', () => { expect(lacksVowels('brk')).toBe(false); });
  test('has vowels', () => { expect(lacksVowels('helloworld')).toBe(false); });
});

describe('analyzeUsername', () => {
  test('hex suspicious', () => { expect(analyzeUsername('a1b2c3d4e5f6').isSuspicious).toBe(true); });
  test('7+ repeat suspicious', () => { expect(analyzeUsername('aaaaaaaa').isSuspicious).toBe(true); });
  test('single weak not suspicious', () => { expect(analyzeUsername('user12345').isSuspicious).toBe(false); });
  test('two weak suspicious', () => { expect(analyzeUsername('bcdfg1234').isSuspicious).toBe(true); });
  test('normal not suspicious', () => { expect(analyzeUsername('CoolGamer').isSuspicious).toBe(false); });
  test('empty', () => { expect(analyzeUsername('').isSuspicious).toBe(false); });
  test('CJK safe', () => { expect(analyzeUsername('\u4f60\u597d\u4e16\u754c').isSuspicious).toBe(false); });
  test('single char', () => { expect(analyzeUsername('a').isSuspicious).toBe(false); });
});
