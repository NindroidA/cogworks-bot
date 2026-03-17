/**
 * Health Monitor Unit Tests
 * 
 * Tests health monitoring system for tracking bot metrics
 */

import { beforeEach, describe, expect, test } from '@jest/globals';
import type { Client } from 'discord.js';
import { healthMonitor } from '../../../src/utils/monitoring/healthMonitor';

// Mock Discord client
const createMockClient = (guildCount: number = 5): Client => {
    return {
        guilds: {
            cache: {
                size: guildCount
            }
        },
        user: {
            tag: 'TestBot#1234'
        }
    } as unknown as Client;
};

describe('HealthMonitor', () => {
    beforeEach(() => {
        // Reset stats before each test
        healthMonitor.resetStats();
    });

    describe('Initialization', () => {
        test('should initialize with Discord client', () => {
            const client = createMockClient(10);
            healthMonitor.initialize(client);

            // Should not throw and should be ready to track
            expect(() => healthMonitor.recordCommand('test', 100)).not.toThrow();
        });
    });

    describe('Command Tracking', () => {
        test('should record command execution', () => {
            healthMonitor.recordCommand('testcommand', 150);

            const stats = healthMonitor.getCommandStat('testcommand');
            expect(stats).toBeDefined();
            expect(stats?.commandName).toBe('testcommand');
            expect(stats?.executionCount).toBe(1);
            expect(stats?.errorCount).toBe(0);
            expect(stats?.averageExecutionTime).toBe(150);
        });

        test('should track multiple executions of same command', () => {
            healthMonitor.recordCommand('testcommand', 100);
            healthMonitor.recordCommand('testcommand', 200);
            healthMonitor.recordCommand('testcommand', 300);

            const stats = healthMonitor.getCommandStat('testcommand');
            expect(stats?.executionCount).toBe(3);
            expect(stats?.errorCount).toBe(0);
            expect(stats?.averageExecutionTime).toBe(200); // (100 + 200 + 300) / 3
        });

        test('should track command errors', () => {
            healthMonitor.recordCommand('testcommand', 100, false);
            healthMonitor.recordCommand('testcommand', 150, true);
            healthMonitor.recordCommand('testcommand', 200, true);

            const stats = healthMonitor.getCommandStat('testcommand');
            expect(stats?.executionCount).toBe(3);
            expect(stats?.errorCount).toBe(2);
        });

        test('should track different commands separately', () => {
            healthMonitor.recordCommand('command1', 100);
            healthMonitor.recordCommand('command2', 200);
            healthMonitor.recordCommand('command3', 300);

            const allStats = healthMonitor.getCommandStats();
            expect(allStats).toHaveLength(3);
            
            const cmd1 = healthMonitor.getCommandStat('command1');
            const cmd2 = healthMonitor.getCommandStat('command2');
            
            expect(cmd1?.averageExecutionTime).toBe(100);
            expect(cmd2?.averageExecutionTime).toBe(200);
        });

        test('should update lastExecuted timestamp', () => {
            const before = new Date();
            healthMonitor.recordCommand('testcommand', 100);
            const after = new Date();

            const stats = healthMonitor.getCommandStat('testcommand');
            expect(stats?.lastExecuted).toBeDefined();
            expect(stats?.lastExecuted!.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(stats?.lastExecuted!.getTime()).toBeLessThanOrEqual(after.getTime());
        });

        test('should return undefined for non-existent command', () => {
            const stats = healthMonitor.getCommandStat('nonexistent');
            expect(stats).toBeUndefined();
        });
    });

    describe('Error Tracking', () => {
        test('should record errors', () => {
            healthMonitor.recordError('Test error', 'TEST_CATEGORY');

            const status = healthMonitor.getHealthStatus();
            expect(status).toBeDefined();
        });

        test('should track errors by category', () => {
            healthMonitor.recordError('Error 1', 'DATABASE');
            healthMonitor.recordError('Error 2', 'DATABASE');
            healthMonitor.recordError('Error 3', 'API');

            // Errors should be tracked (tested via health status)
            expect(() => healthMonitor.getHealthStatus()).not.toThrow();
        });

        test('should handle errors without category', () => {
            healthMonitor.recordError('Generic error');
            
            expect(() => healthMonitor.getHealthStatus()).not.toThrow();
        });
    });

    describe('Statistics Management', () => {
        test('should reset all statistics', () => {
            healthMonitor.recordCommand('cmd1', 100);
            healthMonitor.recordCommand('cmd2', 200);
            healthMonitor.recordError('Test error');

            healthMonitor.resetStats();

            const stats = healthMonitor.getCommandStats();
            expect(stats).toHaveLength(0);
        });

        test('should return all command statistics', () => {
            healthMonitor.recordCommand('cmd1', 100);
            healthMonitor.recordCommand('cmd2', 200);
            healthMonitor.recordCommand('cmd3', 300);

            const allStats = healthMonitor.getCommandStats();
            expect(allStats).toHaveLength(3);
            expect(allStats.map(s => s.commandName)).toContain('cmd1');
            expect(allStats.map(s => s.commandName)).toContain('cmd2');
            expect(allStats.map(s => s.commandName)).toContain('cmd3');
        });

        test('should return empty array when no commands recorded', () => {
            const stats = healthMonitor.getCommandStats();
            expect(stats).toEqual([]);
        });
    });

    describe('Uptime Tracking', () => {
        test('should track uptime in milliseconds', () => {
            // Reset to get fresh start time
            healthMonitor.resetStats();
            
            const uptime = healthMonitor.getUptime();
            expect(uptime).toBeGreaterThanOrEqual(0);
            expect(typeof uptime).toBe('number');
        });

        test('should format uptime as human-readable string', () => {
            const formatted = healthMonitor.getUptimeFormatted();
            
            expect(typeof formatted).toBe('string');
            expect(formatted.length).toBeGreaterThan(0);
            // Should contain time units
            expect(formatted).toMatch(/\d+/);
        });

        test('should increase uptime over time', async () => {
            healthMonitor.resetStats();
            
            const uptime1 = healthMonitor.getUptime();
            await new Promise(resolve => setTimeout(resolve, 10));
            const uptime2 = healthMonitor.getUptime();

            expect(uptime2).toBeGreaterThan(uptime1);
        });
    });

    describe('Health Status', () => {
        test('should return comprehensive health status', async () => {
            const client = createMockClient(5);
            healthMonitor.initialize(client);
            healthMonitor.recordCommand('test', 100);

            const status = await healthMonitor.getHealthStatus();

            expect(status).toBeDefined();
            expect(status.uptime).toBeGreaterThanOrEqual(0);
            expect(status.uptimeFormatted).toBeDefined();
            expect(status.activeGuilds).toBe(5);
            expect(status.memory).toBeDefined();
            expect(status.database).toBeDefined();
            expect(status.errors).toBeDefined();
            expect(status.timestamp).toBeInstanceOf(Date);
        });

        test('should include memory statistics', async () => {
            const status = await healthMonitor.getHealthStatus();

            expect(status.memory).toBeDefined();
            expect(status.memory.heapUsed).toBeGreaterThan(0);
            expect(status.memory.heapTotal).toBeGreaterThan(0);
            expect(status.memory.heapUsedMB).toBeDefined();
            expect(status.memory.heapTotalMB).toBeDefined();
            expect(status.memory.rssMB).toBeDefined();
        });

        test('should include database health', async () => {
            const status = await healthMonitor.getHealthStatus();

            expect(status.database).toBeDefined();
            expect(typeof status.database.connected).toBe('boolean');
            expect(status.database.lastCheck).toBeInstanceOf(Date);
        });

        test('should include error statistics', async () => {
            healthMonitor.recordError('Test error 1', 'TEST');
            healthMonitor.recordError('Test error 2', 'TEST');

            const status = await healthMonitor.getHealthStatus();

            expect(status.errors).toBeDefined();
            expect(status.errors.totalErrors).toBeGreaterThanOrEqual(2);
            expect(status.errors.errorsByCategory).toBeDefined();
            expect(status.errors.recentErrors).toBeDefined();
            expect(Array.isArray(status.errors.recentErrors)).toBe(true);
        });

        test('should calculate commands per minute', async () => {
            healthMonitor.recordCommand('cmd1', 100);
            healthMonitor.recordCommand('cmd2', 150);
            healthMonitor.recordCommand('cmd3', 200);

            const status = await healthMonitor.getHealthStatus();

            expect(status.totalCommands).toBe(3);
            expect(status.commandsPerMinute).toBeGreaterThanOrEqual(0);
        });

        test('should report status as healthy, degraded, or unhealthy', async () => {
            const status = await healthMonitor.getHealthStatus();

            expect(['healthy', 'degraded', 'unhealthy']).toContain(status.status);
        });
    });

    describe('Health Checks', () => {
        test('should determine if bot is healthy', async () => {
            const client = createMockClient(5);
            healthMonitor.initialize(client);

            const isHealthy = await healthMonitor.isHealthy();

            expect(typeof isHealthy).toBe('boolean');
        });

        test('should log health status', async () => {
            const client = createMockClient(3);
            healthMonitor.initialize(client);

            // Should not throw - just verify it completes without error
            await expect(healthMonitor.logHealthStatus()).resolves.toBeUndefined();
        });
    });

    describe('Average Execution Time Calculation', () => {
        test('should correctly calculate average execution time', () => {
            healthMonitor.recordCommand('calc', 100);
            healthMonitor.recordCommand('calc', 200);
            healthMonitor.recordCommand('calc', 300);
            healthMonitor.recordCommand('calc', 400);
            healthMonitor.recordCommand('calc', 500);

            const stats = healthMonitor.getCommandStat('calc');
            expect(stats?.averageExecutionTime).toBe(300);
        });

        test('should handle single execution', () => {
            healthMonitor.recordCommand('single', 123);

            const stats = healthMonitor.getCommandStat('single');
            expect(stats?.averageExecutionTime).toBe(123);
        });

        test('should update average incrementally', () => {
            healthMonitor.recordCommand('incremental', 100);
            let stats = healthMonitor.getCommandStat('incremental');
            expect(stats?.averageExecutionTime).toBe(100);

            healthMonitor.recordCommand('incremental', 200);
            stats = healthMonitor.getCommandStat('incremental');
            expect(stats?.averageExecutionTime).toBe(150);

            healthMonitor.recordCommand('incremental', 300);
            stats = healthMonitor.getCommandStat('incremental');
            expect(stats?.averageExecutionTime).toBe(200);
        });
    });
});
