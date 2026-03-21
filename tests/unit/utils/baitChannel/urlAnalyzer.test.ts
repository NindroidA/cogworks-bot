import { describe, test, expect } from 'bun:test';
import { isDiscordInvite, isShortenedUrl, isPhishingUrl, analyzeUrls } from '../../../../src/utils/baitChannel/urlAnalyzer';

describe('isDiscordInvite', () => {
  test('discord.gg', () => { expect(isDiscordInvite('https://discord.gg/abc')).toBe(true); });
  test('discord.com/invite', () => { expect(isDiscordInvite('https://discord.com/invite/abc')).toBe(true); });
  test('regular', () => { expect(isDiscordInvite('https://example.com')).toBe(false); });
});

describe('isShortenedUrl', () => {
  test('bit.ly', () => { expect(isShortenedUrl('https://bit.ly/abc')).toBe(true); });
  test('t.co', () => { expect(isShortenedUrl('https://t.co/abc')).toBe(true); });
  test('regular', () => { expect(isShortenedUrl('https://example.com')).toBe(false); });
  test('invalid', () => { expect(isShortenedUrl('not a url')).toBe(false); });
});

describe('isPhishingUrl', () => {
  test('discord lookalike', () => { expect(isPhishingUrl('https://dlscord.com/nitro')).toBe(true); });
  test('steam lookalike', () => { expect(isPhishingUrl('https://steamcommunlty.com/gift')).toBe(true); });
  test('legit discord', () => { expect(isPhishingUrl('https://discord.com/channels')).toBe(false); });
  test('sus TLD + keyword', () => { expect(isPhishingUrl('https://free-nitro.xyz/claim')).toBe(true); });
  test('sus TLD no keyword', () => { expect(isPhishingUrl('https://mysite.xyz/hello')).toBe(false); });
  test('invalid', () => { expect(isPhishingUrl('not a url')).toBe(false); });
});

describe('analyzeUrls', () => {
  test('no URLs', () => { const r = analyzeUrls('hello'); expect(r.regularLinks).toHaveLength(0); });
  test('empty', () => { const r = analyzeUrls(''); expect(r.regularLinks).toHaveLength(0); });
  test('regular', () => { expect(analyzeUrls('https://example.com').regularLinks).toHaveLength(1); });
  test('invite', () => { expect(analyzeUrls('https://discord.gg/abc').inviteLinks).toHaveLength(1); });
  test('phishing', () => { expect(analyzeUrls('https://dlscord.com/nitro').phishingLinks).toHaveLength(1); });
  test('shortened', () => { expect(analyzeUrls('https://bit.ly/abc').shortenedLinks).toHaveLength(1); });
  test('mixed', () => {
    const r = analyzeUrls('https://example.com https://discord.gg/abc https://bit.ly/x');
    expect(r.regularLinks).toHaveLength(1); expect(r.inviteLinks).toHaveLength(1); expect(r.shortenedLinks).toHaveLength(1);
  });
  test('null', () => { expect(analyzeUrls(null as unknown as string).regularLinks).toHaveLength(0); });
});
