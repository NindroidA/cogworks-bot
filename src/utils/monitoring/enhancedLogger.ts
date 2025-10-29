/**
 * Enhanced Logger System
 * 
 * Provides comprehensive logging with:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR, CRITICAL)
 * - Log categories for better organization
 * - Structured logging for easier parsing
 * - Optional file output with rotation
 * - Performance tracking
 * - Error context capture
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types & Enums
// ============================================================================

/**
 * Log levels in order of severity
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    CRITICAL = 4
}

/**
 * Log categories for organizing log messages
 */
export enum LogCategory {
    SYSTEM = 'SYSTEM',
    GUILD_LIFECYCLE = 'GUILD_LIFECYCLE',
    COMMAND_EXECUTION = 'COMMAND_EXECUTION',
    DATABASE = 'DATABASE',
    SECURITY = 'SECURITY',
    RATE_LIMIT = 'RATE_LIMIT',
    PERMISSION = 'PERMISSION',
    API = 'API',
    ERROR = 'ERROR',
    PERFORMANCE = 'PERFORMANCE'
}

/**
 * Structured log entry
 */
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    category: LogCategory;
    message: string;
    metadata?: Record<string, unknown>;
    error?: Error;
    guildId?: string;
    userId?: string;
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
    minLevel: LogLevel;
    enableConsole: boolean;
    enableFile: boolean;
    logDirectory?: string;
    maxFileSize?: number; // in bytes
    maxFiles?: number;
    includeTimestamp?: boolean;
    includeCategory?: boolean;
    colorize?: boolean;
}

// ============================================================================
// Enhanced Logger Class
// ============================================================================

class EnhancedLogger {
    private config: LoggerConfig;
    private currentLogFile?: string;
    private logQueue: LogEntry[] = [];
    private isWriting = false;

    constructor(config?: Partial<LoggerConfig>) {
        this.config = {
            minLevel: LogLevel.INFO,
            enableConsole: true,
            enableFile: false,
            logDirectory: './logs',
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            includeTimestamp: true,
            includeCategory: true,
            colorize: true,
            ...config
        };

        if (this.config.enableFile) {
            this.initializeFileLogging();
        }
    }

    /**
     * Initialize file logging system
     */
    private initializeFileLogging(): void {
        if (!this.config.logDirectory) return;

        // Create logs directory if it doesn't exist
        if (!fs.existsSync(this.config.logDirectory)) {
            fs.mkdirSync(this.config.logDirectory, { recursive: true });
        }

        // Create new log file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.currentLogFile = path.join(this.config.logDirectory, `bot-${timestamp}.log`);

        // Rotate old logs if needed
        this.rotateLogsIfNeeded();
    }

    /**
     * Rotate log files if max count exceeded
     */
    private rotateLogsIfNeeded(): void {
        if (!this.config.logDirectory || !this.config.maxFiles) return;

        const files = fs.readdirSync(this.config.logDirectory)
            .filter(f => f.startsWith('bot-') && f.endsWith('.log'))
            .map(f => ({
                name: f,
                path: path.join(this.config.logDirectory!, f),
                time: fs.statSync(path.join(this.config.logDirectory!, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        // Delete oldest files if we exceed max
        if (files.length >= this.config.maxFiles) {
            files.slice(this.config.maxFiles - 1).forEach(file => {
                fs.unlinkSync(file.path);
            });
        }
    }

    /**
     * Format timestamp for display
     */
    private formatTimestamp(date: Date): string {
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    /**
     * Get color for log level
     */
    private getLevelColor(level: LogLevel): chalk.Chalk {
        switch (level) {
            case LogLevel.DEBUG:
                return chalk.gray;
            case LogLevel.INFO:
                return chalk.blue;
            case LogLevel.WARN:
                return chalk.yellow;
            case LogLevel.ERROR:
                return chalk.red;
            case LogLevel.CRITICAL:
                return chalk.bgRed.white;
            default:
                return chalk.white;
        }
    }

    /**
     * Get string name for log level
     */
    private getLevelName(level: LogLevel): string {
        return LogLevel[level];
    }

    /**
     * Format log entry for console output
     */
    private formatConsoleMessage(entry: LogEntry): string {
        const parts: string[] = [];

        // Timestamp
        if (this.config.includeTimestamp) {
            const timestamp = `[${this.formatTimestamp(entry.timestamp)}]`;
            parts.push(this.config.colorize ? chalk.gray(timestamp) : timestamp);
        }

        // Level
        const levelName = `[${this.getLevelName(entry.level)}]`;
        parts.push(this.config.colorize ? this.getLevelColor(entry.level)(levelName) : levelName);

        // Category
        if (this.config.includeCategory) {
            const category = `[${entry.category}]`;
            parts.push(this.config.colorize ? chalk.cyan(category) : category);
        }

        // Message
        parts.push(entry.message);

        // Guild/User context
        const context: string[] = [];
        if (entry.guildId) context.push(`Guild: ${entry.guildId}`);
        if (entry.userId) context.push(`User: ${entry.userId}`);
        if (context.length > 0) {
            const contextStr = `(${context.join(', ')})`;
            parts.push(this.config.colorize ? chalk.gray(contextStr) : contextStr);
        }

        return parts.join(' ');
    }

    /**
     * Format log entry for file output
     */
    private formatFileMessage(entry: LogEntry): string {
        const base = {
            timestamp: entry.timestamp.toISOString(),
            level: LogLevel[entry.level],
            category: entry.category,
            message: entry.message,
            ...(entry.guildId && { guildId: entry.guildId }),
            ...(entry.userId && { userId: entry.userId }),
            ...(entry.metadata && { metadata: entry.metadata }),
            ...(entry.error && {
                error: {
                    message: entry.error.message,
                    stack: entry.error.stack
                }
            })
        };

        return JSON.stringify(base);
    }

    /**
     * Write log entry to file
     */
    private async writeToFile(entry: LogEntry): Promise<void> {
        if (!this.config.enableFile || !this.currentLogFile) return;

        // Add to queue
        this.logQueue.push(entry);

        // Start writing if not already in progress
        if (!this.isWriting) {
            await this.flushQueue();
        }
    }

    /**
     * Flush log queue to file
     */
    private async flushQueue(): Promise<void> {
        if (this.isWriting || this.logQueue.length === 0 || !this.currentLogFile) return;

        this.isWriting = true;

        try {
            const entries = [...this.logQueue];
            this.logQueue = [];

            const messages = entries.map(e => this.formatFileMessage(e) + '\n').join('');
            
            await fs.promises.appendFile(this.currentLogFile, messages, 'utf8');

            // Check file size and rotate if needed
            const stats = await fs.promises.stat(this.currentLogFile);
            if (stats.size > (this.config.maxFileSize || 10485760)) {
                this.initializeFileLogging();
            }
        } catch (error) {
            console.error('Failed to write to log file:', error);
        } finally {
            this.isWriting = false;

            // Process any new entries that came in while writing
            if (this.logQueue.length > 0) {
                await this.flushQueue();
            }
        }
    }

    /**
     * Core logging method
     */
    private log(entry: LogEntry): void {
        // Skip if below minimum level
        if (entry.level < this.config.minLevel) return;

        // Console output
        if (this.config.enableConsole) {
            const message = this.formatConsoleMessage(entry);
            
            switch (entry.level) {
                case LogLevel.ERROR:
                case LogLevel.CRITICAL:
                    console.error(message);
                    if (entry.error) {
                        console.error(entry.error.stack);
                    }
                    break;
                case LogLevel.WARN:
                    console.warn(message);
                    break;
                default:
                    console.log(message);
            }
        }

        // File output
        if (this.config.enableFile) {
            this.writeToFile(entry);
        }
    }

    /**
     * Log a debug message
     */
    public debug(
        message: string,
        category: LogCategory = LogCategory.SYSTEM,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.DEBUG,
            category,
            message,
            metadata
        });
    }

    /**
     * Log an info message
     */
    public info(
        message: string,
        category: LogCategory = LogCategory.SYSTEM,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.INFO,
            category,
            message,
            metadata
        });
    }

    /**
     * Log a warning message
     */
    public warn(
        message: string,
        category: LogCategory = LogCategory.SYSTEM,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.WARN,
            category,
            message,
            metadata
        });
    }

    /**
     * Log an error message
     */
    public error(
        message: string,
        error?: Error,
        category: LogCategory = LogCategory.ERROR,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.ERROR,
            category,
            message,
            error,
            metadata
        });
    }

    /**
     * Log a critical error message
     */
    public critical(
        message: string,
        error?: Error,
        category: LogCategory = LogCategory.ERROR,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.CRITICAL,
            category,
            message,
            error,
            metadata
        });
    }

    /**
     * Log guild lifecycle event
     */
    public guildEvent(
        message: string,
        guildId: string,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.INFO,
            category: LogCategory.GUILD_LIFECYCLE,
            message,
            guildId,
            metadata
        });
    }

    /**
     * Log command execution
     */
    public command(
        message: string,
        userId: string,
        guildId?: string,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.INFO,
            category: LogCategory.COMMAND_EXECUTION,
            message,
            userId,
            guildId,
            metadata
        });
    }

    /**
     * Log security event
     */
    public security(
        message: string,
        userId?: string,
        guildId?: string,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.WARN,
            category: LogCategory.SECURITY,
            message,
            userId,
            guildId,
            metadata
        });
    }

    /**
     * Log rate limit event
     */
    public rateLimit(
        message: string,
        userId?: string,
        guildId?: string,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.WARN,
            category: LogCategory.RATE_LIMIT,
            message,
            userId,
            guildId,
            metadata
        });
    }

    /**
     * Log permission check failure
     */
    public permissionDenied(
        message: string,
        userId: string,
        guildId?: string,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.WARN,
            category: LogCategory.PERMISSION,
            message,
            userId,
            guildId,
            metadata
        });
    }

    /**
     * Log database operation
     */
    public database(
        message: string,
        level: LogLevel = LogLevel.DEBUG,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level,
            category: LogCategory.DATABASE,
            message,
            metadata
        });
    }

    /**
     * Log performance metrics
     */
    public performance(
        message: string,
        durationMs: number,
        metadata?: Record<string, unknown>
    ): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.DEBUG,
            category: LogCategory.PERFORMANCE,
            message: `${message} (${durationMs}ms)`,
            metadata: {
                ...metadata,
                durationMs
            }
        });
    }

    /**
     * Update logger configuration
     */
    public configure(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config };

        // Reinitialize file logging if config changed
        if (config.enableFile && !this.currentLogFile) {
            this.initializeFileLogging();
        }
    }

    /**
     * Get current configuration
     */
    public getConfig(): LoggerConfig {
        return { ...this.config };
    }

    /**
     * Flush any pending log writes
     */
    public async flush(): Promise<void> {
        await this.flushQueue();
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global enhanced logger instance
 * 
 * Default configuration:
 * - Console logging enabled
 * - File logging disabled (enable for production)
 * - Minimum level: INFO
 * - Colorized output
 */
export const enhancedLogger = new EnhancedLogger({
    minLevel: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
    enableConsole: true,
    enableFile: process.env.NODE_ENV === 'production',
    colorize: process.env.NODE_ENV !== 'production'
});

// ============================================================================
// Convenience Exports
// ============================================================================

export default enhancedLogger;
