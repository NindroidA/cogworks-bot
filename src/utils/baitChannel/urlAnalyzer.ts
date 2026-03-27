export interface UrlAnalysis {
  regularLinks: string[];
  inviteLinks: string[];
  phishingLinks: string[];
  shortenedLinks: string[];
}

// Pre-compiled URL extraction regex
const URL_RE = /(https?:\/\/[^\s]+)/gi;

// Discord invite patterns (case-insensitive hostname match)
const INVITE_PATTERNS = [/discord\.gg\//i, /discord\.com\/invite\//i, /discordapp\.com\/invite\//i];

// Legitimate Discord/Steam domains — never flag as phishing
const LEGITIMATE_DOMAINS = new Set([
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'steamcommunity.com',
  'store.steampowered.com',
  'steampowered.com',
  'help.steampowered.com',
]);

// Known URL shortener domains (O(1) lookup)
const SHORTENER_DOMAINS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'is.gd',
  'rb.gy',
  'cutt.ly',
  'shorturl.at',
  'v.gd',
  'ow.ly',
  'tiny.cc',
]);

// Discord lookalike patterns (typosquats / scam domains)
const DISCORD_LOOKALIKES = [
  'discorcl',
  'dlscord',
  'disc0rd',
  'discordapp.gift',
  'discord-nitro',
  'discordgift',
  'discord.gift',
  'discordnitro',
  'discorl',
  'dlscored',
];

// Steam lookalike patterns
const STEAM_LOOKALIKES = [
  'steamcommunlty',
  'steampovered',
  'store-steampowered',
  'steamcommunity-',
  'stearncommun',
  'steamcomrnunity',
];

// Suspicious TLDs (only flagged when combined with suspicious path keywords)
const SUSPICIOUS_TLDS = new Set(['.xyz', '.tk', '.ml', '.cf', '.ga', '.gq', '.top', '.buzz', '.click']);

// Suspicious path keywords (trigger phishing flag only with suspicious TLD)
const SUSPICIOUS_PATH_KEYWORDS = ['nitro', 'gift', 'free', 'login', 'verify', 'claim', 'reward', 'steam'];

/**
 * Parse hostname from a URL string safely.
 * Returns null if the URL is malformed.
 */
function parseHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Check if a URL is a Discord invite link.
 */
export function isDiscordInvite(url: string): boolean {
  return INVITE_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Check if a URL uses a known URL shortener service.
 */
export function isShortenedUrl(url: string): boolean {
  const hostname = parseHostname(url);
  if (!hostname) return false;
  return SHORTENER_DOMAINS.has(hostname);
}

/**
 * Check if a URL matches known phishing/scam patterns.
 *
 * Detection strategy:
 * 1. Skip legitimate domains (discord.com, steamcommunity.com, etc.)
 * 2. Check for Discord/Steam lookalike hostnames
 * 3. Check for suspicious TLD + suspicious path keyword combination
 */
export function isPhishingUrl(url: string): boolean {
  const hostname = parseHostname(url);
  if (!hostname) return false;

  // Never flag legitimate domains
  if (LEGITIMATE_DOMAINS.has(hostname)) return false;

  // Check Discord lookalikes
  for (const pattern of DISCORD_LOOKALIKES) {
    if (hostname.includes(pattern)) return true;
  }

  // Check Steam lookalikes
  for (const pattern of STEAM_LOOKALIKES) {
    if (hostname.includes(pattern)) return true;
  }

  // Check suspicious TLD + path keyword combination
  const hasSuspiciousTld = Array.from(SUSPICIOUS_TLDS).some(tld => hostname.endsWith(tld));
  if (hasSuspiciousTld) {
    const lowerUrl = url.toLowerCase();
    const hasSuspiciousPath = SUSPICIOUS_PATH_KEYWORDS.some(keyword => lowerUrl.includes(keyword));
    if (hasSuspiciousPath) return true;
  }

  return false;
}

/**
 * Analyze all URLs in a message content string.
 *
 * Each URL is categorized into exactly one category with this priority:
 * phishing > invite > shortened > regular
 *
 * Malformed URLs are treated as regular links (never crash).
 */
export function analyzeUrls(content: string): UrlAnalysis {
  const result: UrlAnalysis = {
    regularLinks: [],
    inviteLinks: [],
    phishingLinks: [],
    shortenedLinks: [],
  };

  if (!content) return result;

  const urls = content.match(URL_RE);
  if (!urls) return result;

  for (const url of urls) {
    // Priority order: phishing > invite > shortened > regular
    if (isPhishingUrl(url)) {
      result.phishingLinks.push(url);
    } else if (isDiscordInvite(url)) {
      result.inviteLinks.push(url);
    } else if (isShortenedUrl(url)) {
      result.shortenedLinks.push(url);
    } else {
      result.regularLinks.push(url);
    }
  }

  return result;
}
