/**
 * Error Handler Module
 *
 * Centralized error handling system providing consistent error handling,
 * logging, and user feedback across the bot.
 * Features:
 * - Error classification by category and severity
 * - Structured error logging
 * - User-friendly error messages
 * - Interaction error handling
 * - Global error handlers
 * - Safe database operation wrapper
 */

import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import { E } from './emojis';
import { logger } from './index';

// ============================================================================
// Enums & Types
// ============================================================================

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  /** Low severity - expected errors */
  LOW = 'LOW',
  /** Medium severity - unexpected but recoverable errors */
  MEDIUM = 'MEDIUM',
  /** High severity - serious errors that need attention */
  HIGH = 'HIGH',
  /** Critical severity - system-breaking errors */
  CRITICAL = 'CRITICAL',
}

/**
 * Error categories for better organization
 */
export enum ErrorCategory {
  /** Database-related errors */
  DATABASE = 'DATABASE',
  /** Discord API errors */
  DISCORD_API = 'DISCORD_API',
  /** Permission-related errors */
  PERMISSIONS = 'PERMISSIONS',
  /** Validation errors */
  VALIDATION = 'VALIDATION',
  /** Configuration errors */
  CONFIGURATION = 'CONFIGURATION',
  /** External API errors */
  EXTERNAL_API = 'EXTERNAL_API',
  /** Unknown errors */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Structured error information
 */
export interface ErrorInfo {
  /** Error category */
  category: ErrorCategory;
  /** Error severity */
  severity: ErrorSeverity;
  /** Error message */
  message: string;
  /** Original error object */
  error: unknown;
  /** Context about where error occurred */
  context?: {
    command?: string;
    guildId?: string;
    userId?: string;
    channelId?: string;
    [key: string]: unknown;
  };
}

/**
 * User-friendly error messages based on category
 */
const USER_ERROR_MESSAGES: Record<ErrorCategory, string> = {
  [ErrorCategory.DATABASE]: `${E.error} Database error occurred. Please try again in a moment.`,
  [ErrorCategory.DISCORD_API]: `${E.error} Discord API error. The issue might be temporary, please try again.`,
  [ErrorCategory.PERMISSIONS]: `${E.error} Permission error. The bot may not have the required permissions.`,
  [ErrorCategory.VALIDATION]: `${E.error} Invalid input. Please check your command and try again.`,
  [ErrorCategory.CONFIGURATION]: `${E.error} Configuration error. Please contact an administrator.`,
  [ErrorCategory.EXTERNAL_API]: `${E.error} External service error. Please try again later.`,
  [ErrorCategory.UNKNOWN]: `${E.error} An unexpected error occurred. Please try again.`,
};

/**
 * Classify an error based on its type and message
 */
export function classifyError(error: unknown): {
  category: ErrorCategory;
  severity: ErrorSeverity;
} {
  const errorMessage =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const errorName = error instanceof Error ? error.name.toLowerCase() : '';

  // Database errors
  if (
    errorMessage.includes('typeorm') ||
    errorMessage.includes('database') ||
    errorMessage.includes('repository') ||
    errorMessage.includes('entity')
  ) {
    return { category: ErrorCategory.DATABASE, severity: ErrorSeverity.MEDIUM };
  }

  // Discord API errors
  if (
    errorName.includes('discordapi') ||
    errorMessage.includes('discord') ||
    errorMessage.includes('rest api') ||
    errorMessage.includes('unknown interaction')
  ) {
    return { category: ErrorCategory.DISCORD_API, severity: ErrorSeverity.MEDIUM };
  }

  // Permission errors
  if (
    errorMessage.includes('permission') ||
    errorMessage.includes('missing access') ||
    errorMessage.includes('forbidden')
  ) {
    return { category: ErrorCategory.PERMISSIONS, severity: ErrorSeverity.LOW };
  }

  // Validation errors
  if (
    errorMessage.includes('invalid') ||
    errorMessage.includes('required') ||
    errorMessage.includes('validation') ||
    errorMessage.includes('not found')
  ) {
    return { category: ErrorCategory.VALIDATION, severity: ErrorSeverity.LOW };
  }

  // Configuration errors
  if (
    errorMessage.includes('config') ||
    errorMessage.includes('setup') ||
    errorMessage.includes('not configured')
  ) {
    return { category: ErrorCategory.CONFIGURATION, severity: ErrorSeverity.MEDIUM };
  }

  // External API errors
  if (
    errorMessage.includes('api') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('request failed')
  ) {
    return { category: ErrorCategory.EXTERNAL_API, severity: ErrorSeverity.MEDIUM };
  }

  // Default to unknown
  return { category: ErrorCategory.UNKNOWN, severity: ErrorSeverity.MEDIUM };
}

/**
 * Log error with appropriate severity
 */
export function logError(errorInfo: ErrorInfo): void {
  const { category, severity, message, error, context } = errorInfo;

  const contextStr = context ? ` | Context: ${JSON.stringify(context)}` : '';
  const fullMessage = `[${category}] ${message}${contextStr}`;

  // Log based on severity
  switch (severity) {
    case ErrorSeverity.LOW:
      logger(fullMessage, 'WARN');
      break;
    case ErrorSeverity.MEDIUM:
    case ErrorSeverity.HIGH:
    case ErrorSeverity.CRITICAL:
      logger(fullMessage, 'ERROR');
      if (error instanceof Error) {
        logger(`Stack: ${error.stack}`, 'ERROR');
      }
      break;
  }

  // For critical errors, could send to monitoring service (Sentry, etc.)
  if (severity === ErrorSeverity.CRITICAL) {
    // TODO: Send to error monitoring service
    logger(`${E.alert} CRITICAL ERROR - Immediate attention required!`, 'ERROR');
  }
}

/**
 * Create user-friendly error embed with full error details
 */
export function createDetailedErrorEmbed(errorInfo: ErrorInfo): EmbedBuilder {
  const { category, message } = errorInfo;
  const userMessage = USER_ERROR_MESSAGES[category];

  return new EmbedBuilder()
    .setTitle(`${E.error} Error`)
    .setDescription(userMessage)
    .setColor(0xff0000) // Red
    .addFields({
      name: 'Details',
      value: message || 'No additional details available.',
      inline: false,
    })
    .setFooter({ text: 'If this persists, please contact an administrator.' })
    .setTimestamp();
}

/**
 * Handle error in interaction context
 */
export async function handleInteractionError(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  error: unknown,
  customMessage?: string,
): Promise<void> {
  try {
    // Classify error
    const { category, severity } = classifyError(error);

    // Build error info
    const errorInfo: ErrorInfo = {
      category,
      severity,
      message: customMessage || (error instanceof Error ? error.message : String(error)),
      error,
      context: {
        command: 'commandName' in interaction ? interaction.commandName : 'button/modal',
        guildId: interaction.guildId || 'DM',
        userId: interaction.user.id,
        channelId: interaction.channelId || undefined,
      },
    };

    // Log error
    logError(errorInfo);

    // Send user-friendly message
    const errorEmbed = createDetailedErrorEmbed(errorInfo);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        embeds: [errorEmbed],
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.reply({
        embeds: [errorEmbed],
        flags: [MessageFlags.Ephemeral],
      });
    }
  } catch (followUpError) {
    // Last resort - just log it
    logger(`Failed to handle interaction error: ${followUpError}`, 'ERROR');
    logger(`Original error: ${error}`, 'ERROR');
  }
}

/**
 * Wrap async handler function with error handling
 */
export function withErrorHandling<T extends Array<unknown>>(
  handler: (...args: T) => Promise<void>,
  handlerName: string,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await handler(...args);
    } catch (error) {
      // Check if first arg is an interaction
      const firstArg = args[0];
      if (firstArg && typeof firstArg === 'object' && 'reply' in firstArg) {
        await handleInteractionError(
          firstArg as ChatInputCommandInteraction,
          error,
          `Error in ${handlerName}`,
        );
      } else {
        // Non-interaction error - just log it
        const { category, severity } = classifyError(error);
        logError({
          category,
          severity,
          message: `Error in ${handlerName}`,
          error,
          context: { handler: handlerName },
        });
      }
    }
  };
}

/**
 * Handle unhandled rejections
 */
export function setupGlobalErrorHandlers(): void {
  process.on('unhandledRejection', (reason, promise) => {
    logger(`${E.alert} Unhandled Promise Rejection!`, 'ERROR');
    logError({
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.HIGH,
      message: 'Unhandled promise rejection',
      error: reason,
      context: {
        promise: String(promise),
      },
    });
  });

  process.on('uncaughtException', error => {
    logger(`${E.alert} Uncaught Exception!`, 'ERROR');
    logError({
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.CRITICAL,
      message: 'Uncaught exception - process may be unstable',
      error,
      context: {},
    });

    // Give time to log before exiting
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
}

/**
 * Safe database operation wrapper
 */
export async function safeDbOperation<T>(
  operation: () => Promise<T>,
  errorContext: string,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    logError({
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.MEDIUM,
      message: `Database operation failed: ${errorContext}`,
      error,
      context: { operation: errorContext },
    });
    return null;
  }
}
