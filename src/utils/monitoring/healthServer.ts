/**
 * Health Server Module
 * 
 * HTTP server that exposes bot health metrics for external monitoring.
 * Allows load balancers, uptime monitors, and dashboards to check bot status.
 * 
 * Endpoints:
 * - GET /health - Comprehensive health status with all metrics
 * - GET /health/ready - Readiness probe (is bot ready to handle commands?)
 * - GET /health/live - Liveness probe (is bot process running?)
 * 
 * Usage:
 *   import { healthServer } from './utils';
 *   healthServer.start(3000);  // Start server on port 3000
 *   healthServer.stop();        // Stop server gracefully
 */

import { Client } from 'discord.js';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { version } from '../../../package.json';
import { enhancedLogger, LogCategory } from './enhancedLogger';
import { healthMonitor } from './healthMonitor';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Health check response format
 */
interface HealthResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    uptime: number;
    version: string;
    checks: {
        database: HealthCheckResult;
        discord: HealthCheckResult;
        memory: HealthCheckResult;
        commands: HealthCheckResult;
        errors: HealthCheckResult;
    };
    metrics?: {
        guilds: number;
        commands: {
            total: number;
            commandsPerMinute: number;
        };
        memory: {
            heapUsedMB: string;
            heapTotalMB: string;
            rssMB: string;
            heapPercentage: string;
        };
        errors: {
            total: number;
            recent: number;
            errorRate: number;
        };
    };
}

/**
 * Individual health check result
 */
interface HealthCheckResult {
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Readiness probe response
 */
interface ReadinessResponse {
    ready: boolean;
    message: string;
    timestamp: string;
}

/**
 * Liveness probe response
 */
interface LivenessResponse {
    alive: boolean;
    message: string;
    timestamp: string;
    uptime: number;
}

// ============================================================================
// Health Server Class
// ============================================================================

/**
 * HTTP server that exposes bot health metrics.
 * 
 * This server provides standardized health check endpoints for monitoring systems.
 * It integrates with the healthMonitor to provide real-time bot metrics.
 */
class HealthServer {
    private server: Server | null = null;
    private port: number = 3000;
    private client: Client | null = null;

    /**
     * Initialize the health server.
     * 
     * @param client Discord.js client instance
     */
    initialize(client: Client): void {
        this.client = client;
        enhancedLogger.info('Health server initialized', LogCategory.SYSTEM, {
            clientReady: client.isReady()
        });
    }

    /**
     * Start the HTTP health server.
     * 
     * @param port Port number to listen on (default: 3000)
     */
    start(port: number = 3000): void {
        if (this.server) {
            enhancedLogger.warn('Health server already running', LogCategory.SYSTEM, {
                port: this.port
            });
            return;
        }

        this.port = port;

        this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
            this.handleRequest(req, res);
        });

        this.server.listen(port, () => {
            enhancedLogger.info(`Health server listening on port ${port}`, LogCategory.SYSTEM, {
                port,
                endpoints: ['/health', '/health/ready', '/health/live']
            });
        });

        this.server.on('error', (error: Error) => {
            enhancedLogger.error('Health server error', error, LogCategory.SYSTEM, { port });
        });
    }

    /**
     * Handle incoming HTTP requests.
     * Routes to appropriate handler based on URL path.
     */
    private handleRequest(req: IncomingMessage, res: ServerResponse): void {
        const url = req.url || '/';
        const method = req.method || 'GET';

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle OPTIONS preflight
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Only allow GET requests
        if (method !== 'GET') {
            this.sendResponse(res, 405, {
                error: 'Method Not Allowed',
                message: 'Only GET requests are supported'
            });
            return;
        }

        // Route to appropriate handler
        switch (url) {
        case '/health':
            this.handleHealthCheck(res);
            break;
        case '/health/ready':
            this.handleReadinessCheck(res);
            break;
        case '/health/live':
            this.handleLivenessCheck(res);
            break;
        default:
            this.sendResponse(res, 404, {
                error: 'Not Found',
                message: 'Valid endpoints: /health, /health/ready, /health/live'
            });
        }
    }

    /**
     * Handle comprehensive health check request.
     * Returns detailed health status with all metrics.
     */
    private async handleHealthCheck(res: ServerResponse): Promise<void> {
        try {
            const healthStatus = await healthMonitor.getHealthStatus();
            const status = healthStatus.status;

            // Build health response
            const response: HealthResponse = {
                status,
                timestamp: new Date().toISOString(),
                uptime: healthStatus.uptime,
                version,
                checks: {
                    database: this.checkDatabase(healthStatus.database),
                    discord: this.checkDiscord(),
                    memory: this.checkMemory(healthStatus.memory),
                    commands: this.checkCommands(healthStatus.totalCommands),
                    errors: this.checkErrors(healthStatus.errors)
                },
                metrics: {
                    guilds: healthStatus.activeGuilds,
                    commands: {
                        total: healthStatus.totalCommands,
                        commandsPerMinute: healthStatus.commandsPerMinute
                    },
                    memory: {
                        heapUsedMB: healthStatus.memory.heapUsedMB,
                        heapTotalMB: healthStatus.memory.heapTotalMB,
                        rssMB: healthStatus.memory.rssMB,
                        heapPercentage: `${((parseInt(healthStatus.memory.heapUsedMB) / parseInt(healthStatus.memory.heapTotalMB)) * 100).toFixed(1)}%`
                    },
                    errors: {
                        total: healthStatus.errors.totalErrors,
                        recent: healthStatus.errors.recentErrors.length,
                        errorRate: healthStatus.errors.errorRate
                    }
                }
            };

            // Return appropriate status code based on health
            const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
            this.sendResponse(res, statusCode, response);

            enhancedLogger.debug('Health check requested', LogCategory.SYSTEM, {
                status,
                statusCode
            });

        } catch (error) {
            enhancedLogger.error('Health check failed', error as Error, LogCategory.SYSTEM);

            this.sendResponse(res, 500, {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: 'Failed to retrieve health status'
            });
        }
    }

    /**
     * Handle readiness probe request.
     * Checks if bot is ready to handle commands (database + Discord connected).
     */
    private async handleReadinessCheck(res: ServerResponse): Promise<void> {
        const isReady = this.client?.isReady() ?? false;
        const healthStatus = await healthMonitor.getHealthStatus();
        const dbHealthy = healthStatus.database.connected;

        const ready = isReady && dbHealthy;

        const response: ReadinessResponse = {
            ready,
            message: ready 
                ? 'Bot is ready to handle commands'
                : !isReady 
                    ? 'Discord client not ready'
                    : 'Database not connected',
            timestamp: new Date().toISOString()
        };

        const statusCode = ready ? 200 : 503;
        this.sendResponse(res, statusCode, response);

        enhancedLogger.debug('Readiness check requested', LogCategory.SYSTEM, {
            ready,
            statusCode
        });
    }

    /**
     * Handle liveness probe request.
     * Simple check that the process is running and responsive.
     */
    private async handleLivenessCheck(res: ServerResponse): Promise<void> {
        const healthStatus = await healthMonitor.getHealthStatus();

        const response: LivenessResponse = {
            alive: true,
            message: 'Bot process is running',
            timestamp: new Date().toISOString(),
            uptime: healthStatus.uptime
        };

        this.sendResponse(res, 200, response);

        enhancedLogger.debug('Liveness check requested', LogCategory.SYSTEM, {
            uptime: healthStatus.uptime
        });
    }

    /**
     * Check database health status.
     */
    private checkDatabase(dbHealth: { connected: boolean; responseTime?: number }): HealthCheckResult {
        if (!dbHealth.connected) {
            return {
                status: 'fail',
                message: 'Database not connected',
                details: { responseTime: dbHealth.responseTime || 0 }
            };
        }

        if (dbHealth.responseTime && dbHealth.responseTime > 1000) {
            return {
                status: 'warn',
                message: 'Database responding slowly',
                details: { responseTime: dbHealth.responseTime }
            };
        }

        return {
            status: 'pass',
            message: 'Database healthy',
            details: { responseTime: dbHealth.responseTime || 0 }
        };
    }

    /**
     * Check Discord connection status.
     */
    private checkDiscord(): HealthCheckResult {
        if (!this.client) {
            return {
                status: 'fail',
                message: 'Discord client not initialized'
            };
        }

        if (!this.client.isReady()) {
            return {
                status: 'fail',
                message: 'Discord client not ready'
            };
        }

        const ping = this.client.ws.ping;
        if (ping > 500) {
            return {
                status: 'warn',
                message: 'High Discord API latency',
                details: { ping }
            };
        }

        return {
            status: 'pass',
            message: 'Discord connection healthy',
            details: { ping }
        };
    }

    /**
     * Check memory usage status.
     */
    private checkMemory(memory: { heapUsedMB: string; heapTotalMB: string; rssMB: string }): HealthCheckResult {
        const heapUsed = parseInt(memory.heapUsedMB);
        const heapTotal = parseInt(memory.heapTotalMB);
        const heapPercentage = (heapUsed / heapTotal) * 100;

        if (heapPercentage > 90) {
            return {
                status: 'warn',
                message: 'High memory usage',
                details: { 
                    heapUsedMB: memory.heapUsedMB,
                    heapTotalMB: memory.heapTotalMB,
                    percentage: `${heapPercentage.toFixed(1)}%`
                }
            };
        }

        return {
            status: 'pass',
            message: 'Memory usage normal',
            details: { 
                heapUsedMB: memory.heapUsedMB,
                heapTotalMB: memory.heapTotalMB,
                percentage: `${heapPercentage.toFixed(1)}%`
            }
        };
    }

    /**
     * Check command execution health.
     */
    private checkCommands(totalCommands: number): HealthCheckResult {
        if (totalCommands === 0) {
            return {
                status: 'pass',
                message: 'No commands executed yet',
                details: { total: 0 }
            };
        }

        return {
            status: 'pass',
            message: 'Commands executing normally',
            details: { 
                total: totalCommands
            }
        };
    }

    /**
     * Check error tracking status.
     */
    private checkErrors(errors: { totalErrors: number; recentErrors: Array<unknown>; errorRate: number }): HealthCheckResult {
        const recentErrorCount = errors.recentErrors.length;

        if (recentErrorCount > 10) {
            return {
                status: 'warn',
                message: 'High recent error count',
                details: { 
                    total: errors.totalErrors,
                    recent: recentErrorCount,
                    errorRate: errors.errorRate
                }
            };
        }

        return {
            status: 'pass',
            message: 'Error rate normal',
            details: { 
                total: errors.totalErrors,
                recent: recentErrorCount,
                errorRate: errors.errorRate
            }
        };
    }

    /**
     * Send JSON response to client.
     */
    private sendResponse(res: ServerResponse, statusCode: number, data: unknown): void {
        res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify(data, null, 2));
    }

    /**
     * Stop the health server gracefully.
     */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                enhancedLogger.warn('Health server not running', LogCategory.SYSTEM);
                resolve();
                return;
            }

            this.server.close(() => {
                enhancedLogger.info('Health server stopped', LogCategory.SYSTEM, {
                    port: this.port
                });
                this.server = null;
                resolve();
            });
        });
    }

    /**
     * Get current server status.
     */
    isRunning(): boolean {
        return this.server !== null;
    }

    /**
     * Get server port if running.
     */
    getPort(): number | null {
        return this.server ? this.port : null;
    }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const healthServer = new HealthServer();
