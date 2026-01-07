import chalk from 'chalk';

// ============================================================================
// Language Module Exports
// ============================================================================

/** Re-export lang module with type safety */
export { lang } from '../lang';
export type { Language } from '../lang';

// ============================================================================
// Utility Module Exports
// ============================================================================

// Core utilities
export * from './apiConnector';
export * from './baitChannelManager';
export * from './collectors';
export * from './colors';
export * from './emojis';
export * from './embedBuilders';
export * from './errorHandler';
export * from './types';

// Validation utilities
export * from './validation/permissions';
export * from './validation/permissionValidator';
export * from './validation/validators';

// Monitoring utilities
export * from './monitoring/enhancedLogger';
export * from './monitoring/healthMonitor';
export * from './monitoring/healthServer';

// Database utilities
export * from './database/ensureDefaultTicketTypes';
export * from './database/guildQueries';

// Forum utilities
export * from './forumTagManager';

// Security utilities
export * from './security/rateLimiter';

// ============================================================================
// String Utilities
// ============================================================================

/**
 * Formats a language template string with arguments
 * @param template - Template string with {0}, {1}, etc. placeholders
 * @param args - Arguments to replace placeholders with
 * @returns Formatted string
 * @example
 * LANGF("Hello {0}, you have {1} messages", "John", 5)
 * // Returns: "Hello John, you have 5 messages"
 */
export function LANGF(template: string, ...args: (string | number)[]): string {
	return template.replace(/\{(\d+)\}/g, (match, index) => {
		const argIndex = parseInt(index);
		return args[argIndex] !== undefined ? String(args[argIndex]) : match;
	});
}

/**
 * Extracts Discord ID from a mention string
 * @param mention - Discord mention string (e.g., "<@123456789>" or "<@&123456789>")
 * @returns Extracted ID or null if invalid format
 * @example
 * extractIdFromMention("<@123456789>") // Returns: "123456789"
 * extractIdFromMention("<@&987654321>") // Returns: "987654321"
 */
export function extractIdFromMention(mention: string): string | null {
	const matches = mention.match(/^<@&?(\d+)>$/);
	return matches ? matches[1] : null;
}

// ============================================================================
// Number Utilities
// ============================================================================

/**
 * Formats bytes into human-readable string
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 * @example
 * formatBytes(1024) // Returns: "1 KB"
 * formatBytes(1536000) // Returns: "1.46 MB"
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================================
// Date & Time Utilities
// ============================================================================

/**
 * Gets current timestamp formatted for logging
 * @returns Formatted time string (e.g., "3:45 pm")
 */
export function getTimestamp(): string {
	return new Date().toLocaleTimeString('en-US', { 
		hour: 'numeric', 
		minute: '2-digit',
		hour12: true 
	}).toLowerCase();
}

/**
 * Parses time input string into Date object
 * @param timeInput - Time string in format "YYYY-MM-DD HH:MM AM/PM"
 * @returns Parsed Date object or null if invalid
 * @example
 * parseTimeInput("2025-10-27 3:45 PM")
 * // Returns: Date object for October 27, 2025 at 3:45 PM CST
 */
export function parseTimeInput(timeInput: string): Date | null {
	try {
		// Parse YYYY-MM-DD HH:MM AM/PM format
		const match = timeInput.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
		if (!match) return null;

		const [, year, month, day, hourStr, minute, ampm] = match;
		
		// Convert to 24-hour format
		let hour = parseInt(hourStr);
		if (ampm.toUpperCase() === 'PM' && hour !== 12) {
			hour += 12;
		} else if (ampm.toUpperCase() === 'AM' && hour === 12) {
			hour = 0;
		}

		// Format hour with leading zero if needed
		const hourFormatted = hour.toString().padStart(2, '0');
		
		// Assuming timezone CST (UTC-6)
		const centralTime = new Date(`${year}-${month}-${day}T${hourFormatted}:${minute}:00-05:00`);
		
		return centralTime;
	} catch {
		return null;
	}
}

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Logs a message to console with colored formatting
 * @param message - Message to log
 * @param level - Log level (INFO, WARN, ERROR)
 * @example
 * logger("Bot started successfully") // INFO level
 * logger("Deprecated feature used", "WARN") // WARN level
 * logger("Failed to connect", "ERROR") // ERROR level
 */
export function logger(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
	const prefix = `[${getTimestamp()} - ${level}]`;

	switch (level) {
		case 'ERROR':
			console.error(chalk.redBright(`${prefix} ${message}`));
			break;
		case 'WARN':
			console.warn(chalk.yellow(`${prefix} ${message}`));
			break;
		default:
			console.log(`${prefix} ${message}`);
	}
}