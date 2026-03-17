/**
 * Enhanced Logger Unit Tests
 * 
 * Tests logging system with multiple levels, categories, and outputs
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { LogCategory, LogLevel, enhancedLogger } from '../../../src/utils/monitoring/enhancedLogger';

// Spy on console methods
let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

describe('EnhancedLogger', () => {
    beforeEach(() => {
        // Reset logger configuration to defaults
        enhancedLogger.configure({
            minLevel: LogLevel.DEBUG,
            enableConsole: true,
            enableFile: false,
            includeTimestamp: true,
            includeCategory: true,
            colorize: true
        });

        // Spy on console methods
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        // Restore console methods
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    describe('Basic Logging', () => {
        test('should log debug messages', () => {
            enhancedLogger.debug('Debug message', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Debug message');
            expect(call).toContain('DEBUG');
        });

        test('should log info messages', () => {
            enhancedLogger.info('Info message', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Info message');
            expect(call).toContain('INFO');
        });

        test('should log warn messages', () => {
            enhancedLogger.warn('Warning message', LogCategory.SYSTEM);

            expect(consoleWarnSpy).toHaveBeenCalled();
            const call = consoleWarnSpy.mock.calls[0][0] as string;
            expect(call).toContain('Warning message');
            expect(call).toContain('WARN');
        });

        test('should log error messages', () => {
            enhancedLogger.error('Error message');

            expect(consoleErrorSpy).toHaveBeenCalled();
            const call = consoleErrorSpy.mock.calls[0][0] as string;
            expect(call).toContain('Error message');
            expect(call).toContain('ERROR');
        });

        test('should log critical messages', () => {
            enhancedLogger.critical('Critical error');

            expect(consoleErrorSpy).toHaveBeenCalled();
            const call = consoleErrorSpy.mock.calls[0][0] as string;
            expect(call).toContain('Critical error');
            expect(call).toContain('CRITICAL');
        });
    });

    describe('Log Level Filtering', () => {
        test('should filter out debug logs when minLevel is INFO', () => {
            enhancedLogger.configure({ minLevel: LogLevel.INFO });
            
            enhancedLogger.debug('Debug message', LogCategory.SYSTEM);
            enhancedLogger.info('Info message', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Info message');
        });

        test('should filter out info and debug when minLevel is WARN', () => {
            enhancedLogger.configure({ minLevel: LogLevel.WARN });
            
            enhancedLogger.debug('Debug message', LogCategory.SYSTEM);
            enhancedLogger.info('Info message', LogCategory.SYSTEM);
            enhancedLogger.warn('Warn message', LogCategory.SYSTEM);

            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        });

        test('should only log critical when minLevel is CRITICAL', () => {
            enhancedLogger.configure({ minLevel: LogLevel.CRITICAL });
            
            enhancedLogger.error('Error message');
            enhancedLogger.critical('Critical message');

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            const call = consoleErrorSpy.mock.calls[0][0] as string;
            expect(call).toContain('Critical message');
        });
    });

    describe('Category-Specific Logging', () => {
        test('should log guild events', () => {
            enhancedLogger.guildEvent('Guild joined', 'guild-123');

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Guild joined');
            expect(call).toContain('GUILD_LIFECYCLE');
        });

        test('should log command execution', () => {
            enhancedLogger.command('Command executed', 'user-456', 'guild-123');

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Command executed');
            expect(call).toContain('COMMAND_EXECUTION');
        });

        test('should log security events', () => {
            enhancedLogger.security('Unauthorized access attempt', 'user-789', 'guild-123');

            expect(consoleWarnSpy).toHaveBeenCalled();
            const call = consoleWarnSpy.mock.calls[0][0] as string;
            expect(call).toContain('Unauthorized access');
            expect(call).toContain('SECURITY');
        });

        test('should log rate limit events', () => {
            enhancedLogger.rateLimit('Rate limit exceeded', 'user-123', 'guild-456');

            expect(consoleWarnSpy).toHaveBeenCalled();
            const call = consoleWarnSpy.mock.calls[0][0] as string;
            expect(call).toContain('Rate limit');
            expect(call).toContain('RATE_LIMIT');
        });

        test('should log permission denied events', () => {
            enhancedLogger.permissionDenied('Missing admin permission', 'user-456', 'guild-123');

            expect(consoleWarnSpy).toHaveBeenCalled();
            const call = consoleWarnSpy.mock.calls[0][0] as string;
            expect(call).toContain('permission');
            expect(call).toContain('PERMISSION');
        });

        test('should log database events', () => {
            enhancedLogger.database('Query executed', LogLevel.DEBUG, { query: 'SELECT * FROM users' });

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Query executed');
            expect(call).toContain('DATABASE');
        });

        test('should log performance metrics', () => {
            enhancedLogger.performance('Command completed', 150, { commandName: 'test' });

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Command completed');
            expect(call).toContain('PERFORMANCE');
        });
    });

    describe('Metadata Handling', () => {
        test('should include metadata in logs', () => {
            enhancedLogger.info('Test message', LogCategory.SYSTEM, {
                userId: '123',
                action: 'test'
            });

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Test message');
        });

        test('should handle error objects', () => {
            const error = new Error('Test error');
            enhancedLogger.error('Error occurred', error);

            expect(consoleErrorSpy).toHaveBeenCalled();
            const call = consoleErrorSpy.mock.calls[0][0] as string;
            expect(call).toContain('Error occurred');
        });
    });

    describe('Configuration', () => {
        test('should disable console logging when configured', () => {
            enhancedLogger.configure({ enableConsole: false });
            enhancedLogger.info('Test message', LogCategory.SYSTEM);

            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        test('should update configuration', () => {
            enhancedLogger.configure({
                minLevel: LogLevel.WARN,
                enableConsole: true
            });

            const config = enhancedLogger.getConfig();
            expect(config.minLevel).toBe(LogLevel.WARN);
            expect(config.enableConsole).toBe(true);
        });

        test('should preserve existing config when partially updating', () => {
            enhancedLogger.configure({ enableConsole: true, minLevel: LogLevel.DEBUG });
            enhancedLogger.configure({ minLevel: LogLevel.WARN });

            const config = enhancedLogger.getConfig();
            expect(config.minLevel).toBe(LogLevel.WARN);
            expect(config.enableConsole).toBe(true);
        });
    });

    describe('Category Formatting', () => {
        test('should include category when enabled', () => {
            enhancedLogger.configure({ includeCategory: true });
            enhancedLogger.info('Test', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('SYSTEM');
        });

        test('should exclude category when disabled', () => {
            enhancedLogger.configure({ includeCategory: false });
            enhancedLogger.info('Test', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            // Still contains the level and message
            expect(call).toContain('Test');
        });
    });

    describe('Timestamp Formatting', () => {
        test('should include timestamp when enabled', () => {
            enhancedLogger.configure({ includeTimestamp: true });
            enhancedLogger.info('Test', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            // Should contain time format (HH:MM)
            expect(call).toMatch(/\d{1,2}:\d{2}/);
        });

        test('should exclude timestamp when disabled', () => {
            enhancedLogger.configure({ includeTimestamp: false });
            enhancedLogger.info('Test', LogCategory.SYSTEM);

            expect(consoleLogSpy).toHaveBeenCalled();
            const call = consoleLogSpy.mock.calls[0][0] as string;
            expect(call).toContain('Test');
        });
    });
});
