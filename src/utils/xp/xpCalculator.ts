/**
 * XP & Level Calculation Utilities
 *
 * Pure functions for the XP/leveling system.
 * Uses MEE6-compatible formula: level = floor(0.1 * sqrt(xp))
 */

/**
 * Calculate level from total XP.
 * Formula: level = floor(0.1 * sqrt(xp))
 */
export function calculateLevel(xp: number): number {
  if (xp <= 0) return 0;
  return Math.floor(0.1 * Math.sqrt(xp));
}

/**
 * Calculate total XP required to reach the start of a given level.
 * Inverse of calculateLevel: xp = (level / 0.1)^2 = level^2 * 100
 */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  return level * level * 100;
}

/**
 * Calculate total XP required to reach the next level.
 * Formula: (level + 1)^2 * 100
 */
export function xpForNextLevel(level: number): number {
  return (level + 1) * (level + 1) * 100;
}

/**
 * Get XP progress within the current level.
 * Returns current XP into level, XP needed for next, and percentage.
 */
export function xpProgress(xp: number, level: number): { current: number; needed: number; percentage: number } {
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForNextLevel(level);
  const current = xp - currentLevelXp;
  const needed = nextLevelXp - currentLevelXp;
  const percentage = needed > 0 ? Math.min(100, Math.floor((current / needed) * 100)) : 100;

  return { current, needed, percentage };
}

/**
 * Generate a random XP amount between min and max (inclusive).
 */
export function randomXp(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Build a text-based progress bar.
 * Example: [████████░░░░░░░░] 52%
 */
export function buildProgressBar(percentage: number, length = 16): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * length);
  const empty = length - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  return `[${bar}] ${clamped}%`;
}
