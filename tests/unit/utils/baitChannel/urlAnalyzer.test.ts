import {
  analyzeUrls,
  isDiscordInvite,
  isPhishingUrl,
  isShortenedUrl,
} from '../../../../src/utils/baitChannel/urlAnalyzer';

describe('urlAnalyzer', () => {
  describe('isDiscordInvite', () => {
    it('should detect discord.gg invites', () => {
      expect(isDiscordInvite('https://discord.gg/coolserver')).toBe(true);
    });

    it('should detect discord.com/invite', () => {
      expect(isDiscordInvite('https://discord.com/invite/abc123')).toBe(true);
    });

    it('should detect discordapp.com/invite', () => {
      expect(isDiscordInvite('https://discordapp.com/invite/xyz')).toBe(true);
    });

    it('should NOT flag regular discord.com URLs', () => {
      expect(isDiscordInvite('https://discord.com/channels/123/456')).toBe(false);
    });
  });

  describe('isShortenedUrl', () => {
    it('should detect bit.ly', () => {
      expect(isShortenedUrl('https://bit.ly/abc123')).toBe(true);
    });

    it('should detect tinyurl.com', () => {
      expect(isShortenedUrl('https://tinyurl.com/something')).toBe(true);
    });

    it('should detect t.co', () => {
      expect(isShortenedUrl('https://t.co/abcdef')).toBe(true);
    });

    it('should NOT flag regular URLs', () => {
      expect(isShortenedUrl('https://google.com')).toBe(false);
      expect(isShortenedUrl('https://github.com/repo')).toBe(false);
    });

    it('should handle malformed URLs gracefully', () => {
      expect(isShortenedUrl('not-a-url')).toBe(false);
    });
  });

  describe('isPhishingUrl', () => {
    it('should detect Discord lookalike domains', () => {
      expect(isPhishingUrl('https://discorcl.com/nitro')).toBe(true);
      expect(isPhishingUrl('https://dlscord.gift/free')).toBe(true);
      expect(isPhishingUrl('https://disc0rd.com/verify')).toBe(true);
    });

    it('should detect Steam lookalike domains', () => {
      expect(isPhishingUrl('https://steamcommunlty.com/login')).toBe(true);
    });

    it('should detect suspicious TLD + path keyword combos', () => {
      expect(isPhishingUrl('https://example.xyz/free-nitro')).toBe(true);
      expect(isPhishingUrl('https://fakesite.tk/claim-gift')).toBe(true);
    });

    it('should NOT flag suspicious TLD without suspicious path', () => {
      expect(isPhishingUrl('https://example.xyz/about')).toBe(false);
      expect(isPhishingUrl('https://mysite.xyz')).toBe(false);
    });

    it('should NOT flag legitimate Discord domains', () => {
      expect(isPhishingUrl('https://discord.com')).toBe(false);
      expect(isPhishingUrl('https://discord.com/channels/123')).toBe(false);
      expect(isPhishingUrl('https://discord.gg/server')).toBe(false);
      expect(isPhishingUrl('https://discordapp.com')).toBe(false);
    });

    it('should NOT flag legitimate Steam domains', () => {
      expect(isPhishingUrl('https://steamcommunity.com')).toBe(false);
      expect(isPhishingUrl('https://store.steampowered.com')).toBe(false);
    });

    it('should handle malformed URLs gracefully', () => {
      expect(isPhishingUrl('not-a-url')).toBe(false);
    });
  });

  describe('analyzeUrls', () => {
    it('should categorize invite links', () => {
      const result = analyzeUrls('Check out https://discord.gg/coolserver');
      expect(result.inviteLinks).toHaveLength(1);
      expect(result.regularLinks).toHaveLength(0);
    });

    it('should categorize multiple invite links', () => {
      const result = analyzeUrls('Join https://discord.gg/a and https://discord.gg/b');
      expect(result.inviteLinks).toHaveLength(2);
    });

    it('should categorize phishing links', () => {
      const result = analyzeUrls('Free nitro at https://discorcl.com/nitro');
      expect(result.phishingLinks).toHaveLength(1);
      expect(result.regularLinks).toHaveLength(0);
    });

    it('should categorize shortened links', () => {
      const result = analyzeUrls('Click https://bit.ly/abc123');
      expect(result.shortenedLinks).toHaveLength(1);
    });

    it('should categorize regular links', () => {
      const result = analyzeUrls('Visit https://google.com and https://github.com/repo');
      expect(result.regularLinks).toHaveLength(2);
      expect(result.phishingLinks).toHaveLength(0);
      expect(result.inviteLinks).toHaveLength(0);
      expect(result.shortenedLinks).toHaveLength(0);
    });

    it('should handle mixed content correctly', () => {
      const result = analyzeUrls(
        'Check https://discorcl.com/nitro and https://discord.gg/server and https://google.com',
      );
      expect(result.phishingLinks).toHaveLength(1);
      expect(result.inviteLinks).toHaveLength(1);
      expect(result.regularLinks).toHaveLength(1);
    });

    it('should return empty arrays for no links', () => {
      const result = analyzeUrls('Hello world, no links here!');
      expect(result.regularLinks).toHaveLength(0);
      expect(result.inviteLinks).toHaveLength(0);
      expect(result.phishingLinks).toHaveLength(0);
      expect(result.shortenedLinks).toHaveLength(0);
    });

    it('should handle empty string', () => {
      const result = analyzeUrls('');
      expect(result.regularLinks).toHaveLength(0);
    });

    it('should prioritize phishing over invite', () => {
      // A discord-nitro.xyz/gift URL matches both phishing patterns
      const result = analyzeUrls('https://discord-nitro.xyz/gift');
      expect(result.phishingLinks).toHaveLength(1);
      expect(result.inviteLinks).toHaveLength(0);
    });

    it('should handle URLs with query strings and fragments', () => {
      const result = analyzeUrls('https://google.com/search?q=test#section');
      expect(result.regularLinks).toHaveLength(1);
    });

    it('should handle very long URLs without crashing', () => {
      const longPath = 'a'.repeat(500);
      const result = analyzeUrls(`https://example.com/${longPath}`);
      expect(result.regularLinks).toHaveLength(1);
    });
  });
});
