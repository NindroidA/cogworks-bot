import { describe, test, expect } from "bun:test";
import {
  isDiscordInvite,
  isShortenedUrl,
  isPhishingUrl,
  analyzeUrls,
} from "../../../../src/utils/baitChannel/urlAnalyzer";

describe("isDiscordInvite", () => {
  test("discord.gg", () => {
    expect(isDiscordInvite("https://discord.gg/abc")).toBe(true);
  });
  test("discord.com/invite", () => {
    expect(isDiscordInvite("https://discord.com/invite/abc")).toBe(true);
  });
  test("discordapp.com/invite", () => {
    expect(isDiscordInvite("https://discordapp.com/invite/abc")).toBe(true);
  });
  test("case insensitive discord.gg", () => {
    expect(isDiscordInvite("https://Discord.GG/abc")).toBe(true);
  });
  test("case insensitive discord.com", () => {
    expect(isDiscordInvite("https://DISCORD.COM/invite/abc")).toBe(true);
  });
  test("invite with query params", () => {
    expect(isDiscordInvite("https://discord.gg/abc?event=123")).toBe(true);
  });
  test("regular", () => {
    expect(isDiscordInvite("https://example.com")).toBe(false);
  });
  test("discord.com non-invite path", () => {
    expect(isDiscordInvite("https://discord.com/channels/123")).toBe(false);
  });
});

describe("isShortenedUrl", () => {
  test("bit.ly", () => {
    expect(isShortenedUrl("https://bit.ly/abc")).toBe(true);
  });
  test("t.co", () => {
    expect(isShortenedUrl("https://t.co/abc")).toBe(true);
  });
  test("goo.gl", () => {
    expect(isShortenedUrl("https://goo.gl/maps/abc")).toBe(true);
  });
  test("tinyurl.com", () => {
    expect(isShortenedUrl("https://tinyurl.com/y1234abc")).toBe(true);
  });
  test("is.gd", () => {
    expect(isShortenedUrl("https://is.gd/short")).toBe(true);
  });
  test("rb.gy", () => {
    expect(isShortenedUrl("https://rb.gy/xyz")).toBe(true);
  });
  test("cutt.ly", () => {
    expect(isShortenedUrl("https://cutt.ly/abc")).toBe(true);
  });
  test("shorturl.at", () => {
    expect(isShortenedUrl("https://shorturl.at/abc")).toBe(true);
  });
  test("v.gd", () => {
    expect(isShortenedUrl("https://v.gd/abc")).toBe(true);
  });
  test("ow.ly", () => {
    expect(isShortenedUrl("https://ow.ly/abc")).toBe(true);
  });
  test("tiny.cc", () => {
    expect(isShortenedUrl("https://tiny.cc/abc")).toBe(true);
  });
  test("regular", () => {
    expect(isShortenedUrl("https://example.com")).toBe(false);
  });
  test("invalid", () => {
    expect(isShortenedUrl("not a url")).toBe(false);
  });
  test("shortener with query params", () => {
    expect(isShortenedUrl("https://bit.ly/abc?ref=123")).toBe(true);
  });
  test("shortener with fragment", () => {
    expect(isShortenedUrl("https://tinyurl.com/abc#section")).toBe(true);
  });
});

describe("isPhishingUrl", () => {
  test("discord lookalike", () => {
    expect(isPhishingUrl("https://dlscord.com/nitro")).toBe(true);
  });
  test("disc0rd lookalike", () => {
    expect(isPhishingUrl("https://disc0rd.com/free")).toBe(true);
  });
  test("discorcl lookalike", () => {
    expect(isPhishingUrl("https://discorcl.com/gift")).toBe(true);
  });
  test("discord-nitro lookalike", () => {
    expect(isPhishingUrl("https://discord-nitro.com/claim")).toBe(true);
  });
  test("discordgift lookalike", () => {
    expect(isPhishingUrl("https://discordgift.com/free")).toBe(true);
  });
  test("steam lookalike", () => {
    expect(isPhishingUrl("https://steamcommunlty.com/gift")).toBe(true);
  });
  test("steampovered lookalike", () => {
    expect(isPhishingUrl("https://steampovered.com/login")).toBe(true);
  });
  test("store-steampowered lookalike", () => {
    expect(isPhishingUrl("https://store-steampowered.com/app")).toBe(true);
  });
  test("stearncommun lookalike", () => {
    expect(isPhishingUrl("https://stearncommun.com/trade")).toBe(true);
  });
  test("legit discord", () => {
    expect(isPhishingUrl("https://discord.com/channels")).toBe(false);
  });
  test("legit discord.gg", () => {
    expect(isPhishingUrl("https://discord.gg/abc")).toBe(false);
  });
  test("legit discordapp.com", () => {
    expect(isPhishingUrl("https://discordapp.com/api")).toBe(false);
  });
  test("legit cdn.discordapp.com", () => {
    expect(isPhishingUrl("https://cdn.discordapp.com/attachments/123")).toBe(
      false,
    );
  });
  test("legit media.discordapp.net", () => {
    expect(isPhishingUrl("https://media.discordapp.net/img.png")).toBe(false);
  });
  test("legit steamcommunity.com", () => {
    expect(isPhishingUrl("https://steamcommunity.com/id/user")).toBe(false);
  });
  test("legit store.steampowered.com", () => {
    expect(isPhishingUrl("https://store.steampowered.com/app/730")).toBe(false);
  });
  test("legit help.steampowered.com", () => {
    expect(isPhishingUrl("https://help.steampowered.com/wizard")).toBe(false);
  });
  test("sus TLD + keyword", () => {
    expect(isPhishingUrl("https://free-nitro.xyz/claim")).toBe(true);
  });
  test("sus TLD .tk + keyword", () => {
    expect(isPhishingUrl("https://discord-gift.tk/verify")).toBe(true);
  });
  test("sus TLD .ml + keyword", () => {
    expect(isPhishingUrl("https://free-steam.ml/login")).toBe(true);
  });
  test("sus TLD .cf + keyword", () => {
    expect(isPhishingUrl("https://nitro-gift.cf/reward")).toBe(true);
  });
  test("sus TLD .top + keyword", () => {
    expect(isPhishingUrl("https://claim-nitro.top/free")).toBe(true);
  });
  test("sus TLD .buzz + keyword", () => {
    expect(isPhishingUrl("https://steam-gift.buzz/claim")).toBe(true);
  });
  test("sus TLD .click + keyword", () => {
    expect(isPhishingUrl("https://free-nitro.click/verify")).toBe(true);
  });
  test("sus TLD no keyword", () => {
    expect(isPhishingUrl("https://mysite.xyz/hello")).toBe(false);
  });
  test("sus TLD .tk no keyword", () => {
    expect(isPhishingUrl("https://mysite.tk/about")).toBe(false);
  });
  test("normal .com with suspicious path", () => {
    expect(isPhishingUrl("https://example.com/nitro/claim")).toBe(false);
  });
  test("URL with port number", () => {
    expect(isPhishingUrl("https://example.com:8080/page")).toBe(false);
  });
  test("IP-based URL not flagged without signals", () => {
    expect(isPhishingUrl("http://192.168.1.1/admin")).toBe(false);
  });
  test("invalid", () => {
    expect(isPhishingUrl("not a url")).toBe(false);
  });
  test("case insensitive lookalike detection", () => {
    expect(isPhishingUrl("https://DLSCORD.COM/nitro")).toBe(true);
  });
});

describe("analyzeUrls", () => {
  test("no URLs", () => {
    const r = analyzeUrls("hello");
    expect(r.regularLinks).toHaveLength(0);
  });
  test("empty", () => {
    const r = analyzeUrls("");
    expect(r.regularLinks).toHaveLength(0);
  });
  test("regular", () => {
    expect(analyzeUrls("https://example.com").regularLinks).toHaveLength(1);
  });
  test("invite", () => {
    expect(analyzeUrls("https://discord.gg/abc").inviteLinks).toHaveLength(1);
  });
  test("phishing", () => {
    expect(analyzeUrls("https://dlscord.com/nitro").phishingLinks).toHaveLength(
      1,
    );
  });
  test("shortened", () => {
    expect(analyzeUrls("https://bit.ly/abc").shortenedLinks).toHaveLength(1);
  });
  test("mixed", () => {
    const r = analyzeUrls(
      "https://example.com https://discord.gg/abc https://bit.ly/x",
    );
    expect(r.regularLinks).toHaveLength(1);
    expect(r.inviteLinks).toHaveLength(1);
    expect(r.shortenedLinks).toHaveLength(1);
  });
  test("null", () => {
    expect(analyzeUrls(null as unknown as string).regularLinks).toHaveLength(0);
  });
  test("multiple URLs of same type", () => {
    const r = analyzeUrls(
      "https://example.com https://google.com https://github.com",
    );
    expect(r.regularLinks).toHaveLength(3);
  });
  test("multiple phishing URLs", () => {
    const r = analyzeUrls("https://dlscord.com/nitro https://disc0rd.com/free");
    expect(r.phishingLinks).toHaveLength(2);
  });
  test("URL embedded in text", () => {
    const r = analyzeUrls("Check out https://example.com for more info!");
    expect(r.regularLinks).toHaveLength(1);
  });
  test("URL with query params and fragment", () => {
    const r = analyzeUrls("https://example.com/page?id=123&ref=abc#section");
    expect(r.regularLinks).toHaveLength(1);
  });
  test("URL with port", () => {
    const r = analyzeUrls("https://example.com:3000/api");
    expect(r.regularLinks).toHaveLength(1);
  });
  test("IP-based URL categorized as regular", () => {
    const r = analyzeUrls("http://192.168.1.1/admin");
    expect(r.regularLinks).toHaveLength(1);
  });
  test("phishing priority over invite", () => {
    const r = analyzeUrls("https://dlscord.com/invite/abc");
    expect(r.phishingLinks).toHaveLength(1);
    expect(r.inviteLinks).toHaveLength(0);
  });
  test("all four categories in one message", () => {
    const r = analyzeUrls(
      "https://example.com https://discord.gg/abc https://bit.ly/x https://dlscord.com/nitro",
    );
    expect(r.regularLinks).toHaveLength(1);
    expect(r.inviteLinks).toHaveLength(1);
    expect(r.shortenedLinks).toHaveLength(1);
    expect(r.phishingLinks).toHaveLength(1);
  });
  test("legit Discord URL not flagged", () => {
    const r = analyzeUrls("https://discord.com/channels/123/456");
    expect(r.regularLinks).toHaveLength(1);
    expect(r.phishingLinks).toHaveLength(0);
  });
  test("message with no http prefix ignored", () => {
    const r = analyzeUrls("visit example.com for details");
    expect(r.regularLinks).toHaveLength(0);
  });
  test("http URL detected", () => {
    const r = analyzeUrls("http://example.com/page");
    expect(r.regularLinks).toHaveLength(1);
  });
});
