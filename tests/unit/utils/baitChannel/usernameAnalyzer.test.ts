import { describe, test, expect } from "bun:test";
import {
  hasDigitSuffix,
  isHexString,
  hasRepeatingChars,
  lacksVowels,
  analyzeUsername,
} from "../../../../src/utils/baitChannel/usernameAnalyzer";

describe("hasDigitSuffix", () => {
  test("detects", () => {
    expect(hasDigitSuffix("user12345")).toBe(true);
  });
  test("needs 4+", () => {
    expect(hasDigitSuffix("user123")).toBe(false);
  });
  test("needs letters", () => {
    expect(hasDigitSuffix("12345")).toBe(false);
  });
  test("normal", () => {
    expect(hasDigitSuffix("cool")).toBe(false);
  });
  test("exactly 4 digits", () => {
    expect(hasDigitSuffix("ab1234")).toBe(true);
  });
  test("mixed case prefix", () => {
    expect(hasDigitSuffix("John8392")).toBe(true);
  });
  test("8+ digits (bot pattern)", () => {
    expect(hasDigitSuffix("user12345678")).toBe(true);
  });
  test("digits in middle ignored", () => {
    expect(hasDigitSuffix("us3r")).toBe(false);
  });
  test("underscore prefix no match", () => {
    expect(hasDigitSuffix("_1234")).toBe(false);
  });
  test("single letter prefix needs 2+", () => {
    expect(hasDigitSuffix("x99999")).toBe(false);
  });
  test("two letter prefix matches", () => {
    expect(hasDigitSuffix("ab99999")).toBe(true);
  });
});

describe("isHexString", () => {
  test("detects hex", () => {
    expect(isHexString("a1b2c3d4e5f6")).toBe(true);
  });
  test("needs 8+", () => {
    expect(isHexString("a1b2c3")).toBe(false);
  });
  test("non-hex", () => {
    expect(isHexString("ghijklmnop")).toBe(false);
  });
  test("exactly 8 hex chars", () => {
    expect(isHexString("abcdef12")).toBe(true);
  });
  test("all digits hex", () => {
    expect(isHexString("12345678")).toBe(true);
  });
  test("uppercase hex", () => {
    expect(isHexString("ABCDEF12")).toBe(true);
  });
  test("mixed case hex", () => {
    expect(isHexString("aBcDeF99")).toBe(true);
  });
  test("7 chars not enough", () => {
    expect(isHexString("abcdef1")).toBe(false);
  });
  test("has non-hex letter g", () => {
    expect(isHexString("abcdefg1")).toBe(false);
  });
  test("has underscore", () => {
    expect(isHexString("abcd_ef1")).toBe(false);
  });
});

describe("hasRepeatingChars", () => {
  test("5+ repeating", () => {
    expect(hasRepeatingChars("aaaaaa")).toBe(true);
  });
  test("4 not enough", () => {
    expect(hasRepeatingChars("aaaa")).toBe(false);
  });
  test("exactly 5 repeating", () => {
    expect(hasRepeatingChars("xxxxx")).toBe(true);
  });
  test("repeating digits", () => {
    expect(hasRepeatingChars("11111")).toBe(true);
  });
  test("repeating in middle", () => {
    expect(hasRepeatingChars("ab00000cd")).toBe(true);
  });
  test("no repeating", () => {
    expect(hasRepeatingChars("abcdefgh")).toBe(false);
  });
  test("alternating chars", () => {
    expect(hasRepeatingChars("ababababab")).toBe(false);
  });
  test("repeating special char", () => {
    expect(hasRepeatingChars("_____")).toBe(true);
  });
});

describe("lacksVowels", () => {
  test("long no vowels", () => {
    expect(lacksVowels("bcdfghjk")).toBe(true);
  });
  test("short exempt", () => {
    expect(lacksVowels("brk")).toBe(false);
  });
  test("has vowels", () => {
    expect(lacksVowels("helloworld")).toBe(false);
  });
  test("exactly 8 chars no vowels", () => {
    expect(lacksVowels("bcdfghjk")).toBe(true);
  });
  test("7 chars no vowels exempt", () => {
    expect(lacksVowels("bcdfghj")).toBe(false);
  });
  test("digits and consonants only", () => {
    expect(lacksVowels("bcd12345")).toBe(true);
  });
  test("underscores and consonants", () => {
    expect(lacksVowels("b_c_d_f_")).toBe(true);
  });
  test("single vowel breaks it", () => {
    expect(lacksVowels("bcdfgahk")).toBe(false);
  });
  test("uppercase vowel breaks it", () => {
    expect(lacksVowels("bcdfgAhk")).toBe(false);
  });
  test("all digits long", () => {
    expect(lacksVowels("12345678")).toBe(true);
  });
});

describe("analyzeUsername", () => {
  test("hex suspicious", () => {
    expect(analyzeUsername("a1b2c3d4e5f6").isSuspicious).toBe(true);
  });
  test("7+ repeat suspicious", () => {
    expect(analyzeUsername("aaaaaaaa").isSuspicious).toBe(true);
  });
  test("single weak not suspicious", () => {
    expect(analyzeUsername("user12345").isSuspicious).toBe(false);
  });
  test("two weak suspicious", () => {
    expect(analyzeUsername("bcdfg1234").isSuspicious).toBe(true);
  });
  test("normal not suspicious", () => {
    expect(analyzeUsername("CoolGamer").isSuspicious).toBe(false);
  });
  test("empty", () => {
    expect(analyzeUsername("").isSuspicious).toBe(false);
  });
  test("CJK safe", () => {
    expect(analyzeUsername("\u4f60\u597d\u4e16\u754c").isSuspicious).toBe(
      false,
    );
  });
  test("single char", () => {
    expect(analyzeUsername("a").isSuspicious).toBe(false);
  });
  test("unicode emoji username safe", () => {
    expect(
      analyzeUsername("\u{1F525}\u{1F525}\u{1F525}\u{1F525}\u{1F525}")
        .isSuspicious,
    ).toBe(false);
  });
  test("Cyrillic username safe", () => {
    expect(
      analyzeUsername("\u041F\u0440\u0438\u0432\u0435\u0442\u041C\u0438\u0440")
        .isSuspicious,
    ).toBe(false);
  });
  test("Arabic username safe", () => {
    expect(
      analyzeUsername(
        "\u0645\u0631\u062D\u0628\u0627\u0628\u0627\u0644\u0639\u0627\u0644\u0645",
      ).isSuspicious,
    ).toBe(false);
  });
  test("very long normal username", () => {
    expect(analyzeUsername("TheAmazingCoolGamerPerson").isSuspicious).toBe(
      false,
    );
  });
  test("entirely numbers short", () => {
    expect(analyzeUsername("1234").isSuspicious).toBe(false);
  });
  test("entirely numbers long (hex match)", () => {
    expect(analyzeUsername("12345678").isSuspicious).toBe(true);
  });
  test("username with dots", () => {
    expect(analyzeUsername("cool.gamer.99").isSuspicious).toBe(false);
  });
  test("username with underscores", () => {
    expect(analyzeUsername("cool_gamer").isSuspicious).toBe(false);
  });
  test("bot pattern user + 8 digits not suspicious alone", () => {
    expect(analyzeUsername("user12345678").isSuspicious).toBe(false);
  });
  test("bot pattern + no vowels suspicious", () => {
    expect(analyzeUsername("bcrdf1234567").isSuspicious).toBe(true);
  });
  test("patterns array empty when not suspicious", () => {
    expect(analyzeUsername("CoolGamer").patterns).toHaveLength(0);
  });
  test("patterns array populated when suspicious", () => {
    const result = analyzeUsername("a1b2c3d4e5f6");
    expect(result.patterns).toContain("hex string");
  });
  test("strong repeat returns patterns", () => {
    const result = analyzeUsername("aaaaaaaa");
    expect(result.patterns).toContain("repeating chars");
  });
  test("two weak signals reports both patterns", () => {
    const result = analyzeUsername("bcdfg1234");
    expect(result.patterns).toContain("digit suffix");
    expect(result.patterns).toContain("no vowels");
  });
  test("mixed case with digits normal", () => {
    expect(analyzeUsername("GaMeR42").isSuspicious).toBe(false);
  });
  test("legitimate looking but hex", () => {
    expect(analyzeUsername("deadbeef00").isSuspicious).toBe(true);
  });
  test("null-like input", () => {
    expect(analyzeUsername(null as unknown as string).isSuspicious).toBe(false);
  });
  test("5 repeating alone not suspicious", () => {
    expect(analyzeUsername("xxxxxHello").isSuspicious).toBe(false);
  });
  test("6 repeating alone not suspicious", () => {
    expect(analyzeUsername("xxxxxxHello").isSuspicious).toBe(false);
  });
  test("7 repeating alone suspicious (strong)", () => {
    expect(analyzeUsername("xxxxxxxHello").isSuspicious).toBe(true);
  });
});
