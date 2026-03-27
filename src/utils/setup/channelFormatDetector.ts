/**
 * Channel Format Detector
 *
 * Analyzes a guild's existing channel names to detect naming patterns:
 * emoji prefixes, separators, casing conventions. Used by auto-channel
 * creation to match the guild's existing style.
 */

import type { Guild } from 'discord.js';
import { ChannelType } from 'discord.js';

export interface ChannelFormat {
  /** Most common separator between name segments (e.g., '-', '︱', '│', '・') */
  separator: string;
  /** Casing convention: 'lower', 'title', 'upper' */
  casing: 'lower' | 'title' | 'upper';
  /** Whether channels commonly start with an emoji */
  emojiPrefix: boolean;
  /** Confidence score 0-1 for how consistent the pattern is */
  confidence: number;
}

// Common separators used in Discord channel names
const SEPARATORS = ['︱', '│', '┃', '・', '⟩', '»', '|', '-'];

// Regex to detect emoji at the start of a channel name (Unicode emoji or custom emoji text)
const EMOJI_PREFIX_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;

// Regex to strip emoji prefix and separator for casing analysis
const STRIP_PREFIX_REGEX = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*[︱│┃・⟩»|-]?\s*/u;

/**
 * Detect the channel naming format used by a guild.
 *
 * Analyzes text and voice channels (not categories, threads, or DMs)
 * to find the most common separator, casing, and emoji prefix usage.
 */
export function detectGuildChannelFormat(guild: Guild): ChannelFormat {
  const channels = guild.channels.cache
    .filter(
      ch =>
        ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildForum,
    )
    .map(ch => ch.name);

  if (channels.length < 3) {
    // Not enough channels to detect a pattern
    return {
      separator: '-',
      casing: 'lower',
      emojiPrefix: false,
      confidence: 0,
    };
  }

  const names = channels;

  // --- Separator detection ---
  const separatorCounts = new Map<string, number>();
  for (const sep of SEPARATORS) {
    let count = 0;
    for (const name of names) {
      if (name.includes(sep)) count++;
    }
    if (count > 0) separatorCounts.set(sep, count);
  }

  let bestSeparator = '-';
  let bestSepCount = 0;
  for (const [sep, count] of separatorCounts) {
    if (count > bestSepCount) {
      bestSeparator = sep;
      bestSepCount = count;
    }
  }

  // --- Emoji prefix detection ---
  let emojiCount = 0;
  for (const name of names) {
    if (EMOJI_PREFIX_REGEX.test(name)) emojiCount++;
  }
  const emojiPrefix = emojiCount / names.length > 0.4; // >40% have emoji prefix

  // --- Casing detection ---
  let lowerCount = 0;
  let titleCount = 0;
  let upperCount = 0;

  for (const name of names) {
    // Strip emoji prefix and separator for clean text analysis
    const textPart = name
      .replace(STRIP_PREFIX_REGEX, '')
      .replace(/[︱│┃・⟩»|-]/g, ' ')
      .trim();
    if (!textPart) continue;

    const words = textPart.split(/\s+/);
    const firstWord = words[0];

    if (firstWord === firstWord.toLowerCase()) {
      lowerCount++;
    } else if (firstWord === firstWord.toUpperCase() && firstWord.length > 1) {
      upperCount++;
    } else if (firstWord[0] === firstWord[0].toUpperCase()) {
      titleCount++;
    }
  }

  let casing: 'lower' | 'title' | 'upper' = 'lower';
  const maxCasing = Math.max(lowerCount, titleCount, upperCount);
  if (maxCasing === titleCount) casing = 'title';
  else if (maxCasing === upperCount) casing = 'upper';

  // --- Confidence calculation ---
  const total = names.length;
  const sepConfidence = bestSepCount / total;
  const casingConfidence = maxCasing / total;
  const confidence = Math.round(((sepConfidence + casingConfidence) / 2) * 100) / 100;

  return { separator: bestSeparator, casing, emojiPrefix, confidence };
}

/**
 * Apply a detected format to a base channel name.
 *
 * @param baseName - Plain name like "tickets" or "ticket archive"
 * @param emoji - Optional emoji to prepend
 * @param format - Detected guild format
 * @returns Formatted channel name
 *
 * @example
 * formatChannelName('tickets', '🎫', { separator: '︱', casing: 'lower', emojiPrefix: true })
 * // Returns: '🎫︱tickets'
 *
 * formatChannelName('ticket archive', undefined, { separator: '-', casing: 'lower', emojiPrefix: false })
 * // Returns: 'ticket-archive'
 */
export function formatChannelName(baseName: string, emoji: string | undefined, format: ChannelFormat): string {
  // Text/forum channels: Discord forces lowercase + hyphens for word separators.
  // Always use hyphens for word separation — fancy Unicode separators (︱│┃) cause
  // visual issues in text channels. Only use the detected separator for emoji prefix.
  let name = baseName.toLowerCase();

  // Replace spaces with hyphens (the only reliable word separator for text channels)
  name = name.replace(/\s+/g, '-');

  // Prepend emoji if format uses emoji prefixes and one is provided
  if (emoji && format.emojiPrefix) {
    // Use detected separator between emoji and name (e.g., 🎫︱tickets)
    const sep = format.separator === '-' ? '-' : format.separator;
    name = `${emoji}${sep}${name}`;
  }

  // Discord channel name constraints: lowercase, max 100 chars
  return name.substring(0, 100);
}

/**
 * Format a category name (categories allow spaces and mixed case).
 */
export function formatCategoryName(baseName: string, emoji: string | undefined, format: ChannelFormat): string {
  let name = baseName;
  switch (format.casing) {
    case 'lower':
      name = baseName.toLowerCase();
      break;
    case 'title':
      name = baseName
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      break;
    case 'upper':
      name = baseName.toUpperCase();
      break;
  }

  if (emoji && format.emojiPrefix) {
    name = `${emoji} ${name}`;
  }

  return name.substring(0, 100);
}
