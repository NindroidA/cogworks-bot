import chalk from 'chalk';

/**
 * Gets current timestamp formatted for logging
 * @returns Formatted time string (e.g., "3:45 pm")
 */
export function getTimestamp(): string {
  return new Date()
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase();
}

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
