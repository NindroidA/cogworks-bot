/**
 * Health Monitoring System
 * 
 * Tracks bot health metrics including:
 * - Active guild count
 * - Command execution statistics
 * - Database connection status
 * - Memory usage
 * - Error rates
 * - Uptime
 * 
 * Provides /health endpoint data and real-time monitoring
 */

import type { Client } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { enhancedLogger, LogCategory } from './enhancedLogger';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Command execution statistics
 */
export interface CommandStats {
    commandName: string;
    executionCount: number;
    errorCount: number;
    averageExecutionTime: number;
    lastExecuted?: Date;
}

/**
 * Error tracking information
 */
export interface ErrorStats {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    recentErrors: Array<{
        timestamp: Date;
        message: string;
        category: string;
    }>;
    errorRate: number; // errors per minute
}

/**
 * Memory usage information
 */
export interface MemoryStats {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    heapUsedMB: string;
    heapTotalMB: string;
    rssMB: string;
}

/**
 * Database health information
 */
export interface DatabaseHealth {
    connected: boolean;
    responseTime?: number;
    lastCheck: Date;
}

/**
 * Overall health status
 */
export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    uptimeFormatted: string;
    activeGuilds: number;
    totalCommands: number;
    commandsPerMinute: number;
    memory: MemoryStats;
    database: DatabaseHealth;
    errors: ErrorStats;
    timestamp: Date;
}

// ============================================================================
// Health Monitor Class
// ============================================================================

class HealthMonitor {
    private client?: Client;
    private startTime: Date = new Date();
    private commandStats: Map<string, CommandStats> = new Map();
    private errorLog: Array<{ timestamp: Date; message: string; category: string }> = [];
    private maxErrorLogSize = 100;
    private statsWindow = 60000; // 1 minute for rate calculations

    /**
     * Initialize health monitor with Discord client
     */
    public initialize(client: Client): void {
        this.client = client;
        this.startTime = new Date();
        
        enhancedLogger.info(
            'Health monitor initialized',
            LogCategory.SYSTEM
        );

        // Start periodic health checks
        this.startPeriodicChecks();
    }

    /**
     * Start periodic health checks
     */
    private startPeriodicChecks(): void {
        // Check database connection every 5 minutes
        setInterval(() => {
            this.checkDatabaseHealth();
        }, 300000);

        // Clean up old errors every 5 minutes
        setInterval(() => {
            this.cleanupOldErrors();
        }, 300000);
    }

    /**
     * Record command execution
     */
    public recordCommand(
        commandName: string,
        executionTime: number,
        isError: boolean = false
    ): void {
        const stats = this.commandStats.get(commandName) || {
            commandName,
            executionCount: 0,
            errorCount: 0,
            averageExecutionTime: 0
        };

        stats.executionCount++;
        if (isError) stats.errorCount++;
        
        // Update average execution time
        stats.averageExecutionTime = 
            ((stats.averageExecutionTime * (stats.executionCount - 1)) + executionTime) / 
            stats.executionCount;
        
        stats.lastExecuted = new Date();

        this.commandStats.set(commandName, stats);
    }

    /**
     * Record an error
     */
    public recordError(message: string, category: string = 'UNKNOWN'): void {
        this.errorLog.push({
            timestamp: new Date(),
            message,
            category
        });

        // Keep log size manageable
        if (this.errorLog.length > this.maxErrorLogSize) {
            this.errorLog.shift();
        }
    }

    /**
     * Clean up errors older than the stats window
     */
    private cleanupOldErrors(): void {
        const cutoff = Date.now() - (this.statsWindow * 10); // Keep 10 minutes
        this.errorLog = this.errorLog.filter(e => e.timestamp.getTime() > cutoff);
    }

    /**
     * Get memory statistics
     */
    private getMemoryStats(): MemoryStats {
        const usage = process.memoryUsage();
        
        return {
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            external: usage.external,
            rss: usage.rss,
            heapUsedMB: (usage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            heapTotalMB: (usage.heapTotal / 1024 / 1024).toFixed(2) + ' MB',
            rssMB: (usage.rss / 1024 / 1024).toFixed(2) + ' MB'
        };
    }

    /**
     * Check database health
     */
    private async checkDatabaseHealth(): Promise<DatabaseHealth> {
        const startTime = Date.now();
        
        try {
            if (!AppDataSource.isInitialized) {
                return {
                    connected: false,
                    lastCheck: new Date()
                };
            }

            // Simple query to test connection
            await AppDataSource.query('SELECT 1');
            
            const responseTime = Date.now() - startTime;

            return {
                connected: true,
                responseTime,
                lastCheck: new Date()
            };
        } catch (error) {
            enhancedLogger.error(
                'Database health check failed',
                error as Error,
                LogCategory.DATABASE
            );

            return {
                connected: false,
                lastCheck: new Date()
            };
        }
    }

    /**
     * Get error statistics
     */
    private getErrorStats(): ErrorStats {
        const now = Date.now();
        const recentWindow = now - this.statsWindow;
        
        // Get errors in the last minute
        const recentErrors = this.errorLog.filter(e => 
            e.timestamp.getTime() > recentWindow
        );

        // Group by category
        const errorsByCategory: Record<string, number> = {};
        this.errorLog.forEach(e => {
            errorsByCategory[e.category] = (errorsByCategory[e.category] || 0) + 1;
        });

        // Calculate error rate (per minute)
        const errorRate = recentErrors.length;

        return {
            totalErrors: this.errorLog.length,
            errorsByCategory,
            recentErrors: this.errorLog.slice(-10).map(e => ({
                timestamp: e.timestamp,
                message: e.message,
                category: e.category
            })),
            errorRate
        };
    }

    /**
     * Format uptime duration
     */
    private formatUptime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Calculate commands per minute
     */
    private getCommandsPerMinute(): number {
        const now = Date.now();
        const windowStart = now - this.statsWindow;
        
        let recentCommandCount = 0;
        this.commandStats.forEach(stats => {
            if (stats.lastExecuted && stats.lastExecuted.getTime() > windowStart) {
                recentCommandCount++;
            }
        });

        return recentCommandCount;
    }

    /**
     * Get overall health status
     */
    public async getHealthStatus(): Promise<HealthStatus> {
        const uptime = Date.now() - this.startTime.getTime();
        const memory = this.getMemoryStats();
        const database = await this.checkDatabaseHealth();
        const errors = this.getErrorStats();
        const activeGuilds = this.client?.guilds.cache.size || 0;
        const totalCommands = Array.from(this.commandStats.values())
            .reduce((sum, stat) => sum + stat.executionCount, 0);
        const commandsPerMinute = this.getCommandsPerMinute();

        // Determine overall status
        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

        if (!database.connected) {
            status = 'unhealthy';
        } else if (errors.errorRate > 10 || memory.heapUsed / memory.heapTotal > 0.9) {
            status = 'degraded';
        }

        return {
            status,
            uptime,
            uptimeFormatted: this.formatUptime(uptime),
            activeGuilds,
            totalCommands,
            commandsPerMinute,
            memory,
            database,
            errors,
            timestamp: new Date()
        };
    }

    /**
     * Get command statistics
     */
    public getCommandStats(): CommandStats[] {
        return Array.from(this.commandStats.values())
            .sort((a, b) => b.executionCount - a.executionCount);
    }

    /**
     * Get statistics for a specific command
     */
    public getCommandStat(commandName: string): CommandStats | undefined {
        return this.commandStats.get(commandName);
    }

    /**
     * Reset all statistics (useful for testing)
     */
    public resetStats(): void {
        this.commandStats.clear();
        this.errorLog = [];
        this.startTime = new Date();
        
        enhancedLogger.info(
            'Health monitor statistics reset',
            LogCategory.SYSTEM
        );
    }

    /**
     * Get uptime in milliseconds
     */
    public getUptime(): number {
        return Date.now() - this.startTime.getTime();
    }

    /**
     * Get formatted uptime string
     */
    public getUptimeFormatted(): string {
        return this.formatUptime(this.getUptime());
    }

    /**
     * Check if bot is healthy
     */
    public async isHealthy(): Promise<boolean> {
        const status = await this.getHealthStatus();
        return status.status === 'healthy';
    }

    /**
     * Log current health status
     */
    public async logHealthStatus(): Promise<void> {
        const status = await this.getHealthStatus();
        
        enhancedLogger.info(
            `Health Check: ${status.status.toUpperCase()} | ` +
            `Guilds: ${status.activeGuilds} | ` +
            `Commands: ${status.totalCommands} | ` +
            `Uptime: ${status.uptimeFormatted} | ` +
            `Memory: ${status.memory.heapUsedMB}/${status.memory.heapTotalMB}`,
            LogCategory.SYSTEM,
            {
                status: status.status,
                guilds: status.activeGuilds,
                memory: status.memory,
                database: status.database
            }
        );
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global health monitor instance
 */
export const healthMonitor = new HealthMonitor();

export default healthMonitor;
