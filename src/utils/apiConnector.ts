/**
 * API Connector Module
 *
 * Enhanced connector class for communicating with external API.
 * Features:
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern for fault tolerance
 * - Health monitoring and metrics tracking
 * - Request/response logging
 * - Graceful degradation
 */

import type { Client } from 'discord.js';
import { version } from '../../package.json';
import { INTERVALS } from './constants';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';
import { sleep } from './time';

/**
 * Bot stats data sent to API (v1.3.0 format)
 */
interface BotStatsPayload {
  botId: string;
  username: string;
  guilds: number;
  users: number;
  uptime: number;
  memoryUsage: number;
  version: string;
  environment: string;
}

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * API request statistics for monitoring
 */
interface APIMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalRetries: number;
  averageResponseTime: number;
  lastRequestTime: number;
  lastSuccessTime: number;
  lastErrorTime: number;
  consecutiveFailures: number;
}

/**
 * Retry configuration options
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxAttempts: number;
}

/**
 * Enhanced connector class for communicating with API.
 * Uses native fetch — no external HTTP library needed.
 */
export class APIConnector {
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;
  private statsInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private registerRetryTimer: NodeJS.Timeout | null = null;
  private registerRetries = 0;
  private stopped = false;
  private isConnected: boolean = false;
  /** True when COGWORKS_API_TOKEN is unset and the Discord bot token is sent instead. */
  private readonly usingLegacyToken: boolean;
  private legacyTokenWarned = false;

  // Circuit breaker state
  private circuitState: CircuitState = CircuitState.CLOSED;
  private circuitStateChangedAt: number = Date.now();
  private halfOpenAttempts: number = 0;

  // Metrics
  private metrics: APIMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalRetries: 0,
    averageResponseTime: 0,
    lastRequestTime: 0,
    lastSuccessTime: 0,
    lastErrorTime: 0,
    consecutiveFailures: 0,
  };

  // Configuration
  private readonly retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
  };

  private readonly circuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 60000,
    halfOpenMaxAttempts: 3,
  };

  /**
   * @param apiToken  Dedicated bot -> API secret (COGWORKS_API_TOKEN)
   * @param legacyBotToken  Discord bot token, sent only while apiToken is unset.
   *   Deprecated: it leaks the Discord credential to ninsys-api and its logs.
   */
  constructor(apiUrl: string, apiToken: string | undefined, legacyBotToken: string) {
    this.baseURL = apiUrl;
    const dedicated = apiToken?.trim();
    this.usingLegacyToken = !dedicated;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${dedicated || legacyBotToken}`,
    };
  }

  /** One warning per process; names the env vars only, never a value. */
  private warnIfLegacyToken(): void {
    if (!this.usingLegacyToken || this.legacyTokenWarned) return;
    this.legacyTokenWarned = true;
    enhancedLogger.warn(
      'COGWORKS_API_TOKEN is not set, so the bot authenticates to the API with its Discord bot token. ' +
        'This fallback is deprecated: set the same COGWORKS_API_TOKEN on the bot and on ninsys-api.',
      LogCategory.SECURITY,
    );
  }

  /**
   * Make an HTTP request using native fetch.
   */
  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const options: RequestInit = {
      method,
      headers: this.headers,
      signal: AbortSignal.timeout(10000), // 10s timeout
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = new Error(`API ${method} ${path} failed: ${response.status} ${response.statusText}`) as Error & {
        status: number;
      };
      error.status = response.status;
      throw error;
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return (await response.json()) as T;
    }
    return undefined as T;
  }

  /**
   * Register the bot with API with retry logic.
   */
  async registerBot(client: Client): Promise<void> {
    this.warnIfLegacyToken();
    try {
      await this.makeRequestWithRetry(() => this.request('GET', '/health'));

      const botData = this.createBotStatsPayload(client);
      await this.makeRequestWithRetry(() => this.request('POST', '/v2/cogworks/register', botData));

      this.isConnected = true;
      this.startHealthCheck();
      enhancedLogger.info('Bot registered with API', LogCategory.API);
    } catch (error) {
      // The message carries method, path and status only — no headers.
      enhancedLogger.error('Failed to register bot with API', new Error('API registration failed'), LogCategory.API, {
        reason: error instanceof Error ? error.message : String(error),
      });
      this.isConnected = false;
    }
  }

  /**
   * Register and start stats sync. If the API is unreachable (for example it
   * restarted together with the bot), keep retrying in the background —
   * 30s, 60s, 2m, 4m, then every 5m — instead of staying offline until the
   * next bot restart. Resolves with the first attempt's outcome.
   */
  async connect(client: Client): Promise<boolean> {
    // No API configured (API_URL unset): nothing to register with or retry.
    if (!this.baseURL) return false;
    this.stopped = false;
    await this.registerBot(client);
    if (this.isConnected) {
      this.startStatsSync(client);
      return true;
    }
    this.scheduleRegisterRetry(client);
    return false;
  }

  private scheduleRegisterRetry(client: Client): void {
    if (this.stopped || this.registerRetryTimer) return;
    const delay = Math.min(
      INTERVALS.API_REGISTER_RETRY_BASE * 2 ** this.registerRetries,
      INTERVALS.API_REGISTER_RETRY_MAX,
    );
    this.registerRetries++;
    enhancedLogger.warn(`API registration will be retried in ${Math.round(delay / 1000)}s`, LogCategory.API, {
      retry: this.registerRetries,
    });
    this.registerRetryTimer = setTimeout(() => {
      this.registerRetryTimer = null;
      void this.retryRegistration(client);
    }, delay);
  }

  private async retryRegistration(client: Client): Promise<void> {
    if (this.stopped) return;
    await this.registerBot(client);
    if (this.stopped) return;
    if (this.isConnected) {
      this.registerRetries = 0;
      this.startStatsSync(client);
      enhancedLogger.info('Registered with API after retrying', LogCategory.API);
    } else {
      this.scheduleRegisterRetry(client);
    }
  }

  /**
   * Make an HTTP request with retry logic and exponential backoff.
   */
  private async makeRequestWithRetry<T>(requestFn: () => Promise<T>, retryCount: number = 0): Promise<T> {
    if (!this.canMakeRequest()) {
      throw new Error('Circuit breaker is OPEN - API is unavailable');
    }

    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      const response = await requestFn();

      const duration = Date.now() - startTime;
      this.updateAverageResponseTime(duration);
      this.recordSuccess();

      return response;
    } catch (error) {
      this.metrics.totalRetries++;
      this.recordFailure(error as Error);

      if (retryCount < this.retryConfig.maxRetries && this.shouldRetry(error as Error)) {
        const delay = this.calculateBackoff(retryCount);
        enhancedLogger.warn(
          `API request failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.retryConfig.maxRetries})`,
          LogCategory.API,
        );

        await sleep(delay);
        return this.makeRequestWithRetry(requestFn, retryCount + 1);
      }

      throw error;
    }
  }

  private canMakeRequest(): boolean {
    const now = Date.now();
    switch (this.circuitState) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        if (now - this.circuitStateChangedAt >= this.circuitBreakerConfig.resetTimeout) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;
      case CircuitState.HALF_OPEN:
        return this.halfOpenAttempts < this.circuitBreakerConfig.halfOpenMaxAttempts;
      default:
        return false;
    }
  }

  private shouldRetry(error: Error): boolean {
    const status = (error as Error & { status?: number }).status;
    // Don't retry on 4xx client errors
    if (status && status >= 400 && status < 500) {
      return false;
    }
    return true;
  }

  private calculateBackoff(retryCount: number): number {
    const delay = Math.min(
      this.retryConfig.baseDelay * this.retryConfig.backoffMultiplier ** retryCount,
      this.retryConfig.maxDelay,
    );
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  private recordSuccess(): void {
    this.metrics.successfulRequests++;
    this.metrics.lastSuccessTime = Date.now();
    this.metrics.consecutiveFailures = 0;

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.circuitBreakerConfig.halfOpenMaxAttempts) {
        this.transitionToClosed();
      }
    }
  }

  private recordFailure(error: Error): void {
    this.metrics.failedRequests++;
    this.metrics.lastErrorTime = Date.now();
    this.metrics.consecutiveFailures++;

    const status = (error as Error & { status?: number }).status || 'network error';
    enhancedLogger.warn(
      `API Failure (${status}) - ${this.metrics.consecutiveFailures} consecutive failures`,
      LogCategory.API,
      {
        status,
        consecutiveFailures: this.metrics.consecutiveFailures,
      },
    );

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.transitionToOpen();
    } else if (
      this.circuitState === CircuitState.CLOSED &&
      this.metrics.consecutiveFailures >= this.circuitBreakerConfig.failureThreshold
    ) {
      this.transitionToOpen();
    }
  }

  private transitionToClosed(): void {
    enhancedLogger.info('Circuit Breaker: CLOSED (API healthy)', LogCategory.API);
    this.circuitState = CircuitState.CLOSED;
    this.circuitStateChangedAt = Date.now();
    this.halfOpenAttempts = 0;
    this.metrics.consecutiveFailures = 0;
  }

  private transitionToOpen(): void {
    enhancedLogger.warn('Circuit Breaker: OPEN (API unhealthy, blocking requests)', LogCategory.API);
    this.circuitState = CircuitState.OPEN;
    this.circuitStateChangedAt = Date.now();
    this.halfOpenAttempts = 0;
  }

  private transitionToHalfOpen(): void {
    enhancedLogger.info('Circuit Breaker: HALF-OPEN (testing API recovery)', LogCategory.API);
    this.circuitState = CircuitState.HALF_OPEN;
    this.circuitStateChangedAt = Date.now();
    this.halfOpenAttempts = 0;
  }

  private updateAverageResponseTime(duration: number): void {
    const totalDuration = this.metrics.averageResponseTime * (this.metrics.successfulRequests - 1) + duration;
    this.metrics.averageResponseTime = totalDuration / this.metrics.successfulRequests;
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.testConnection();
        if (!isHealthy && this.isConnected) {
          enhancedLogger.warn('API health check failed', LogCategory.API);
        }
      } catch {
        // Silent fail for health checks
      }
    }, 300000);

    enhancedLogger.info('Started API health monitoring (5m interval)', LogCategory.API);
  }

  startStatsSync(client: Client): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = setInterval(async () => {
      try {
        if (client.isReady() && this.isConnected) {
          const stats = this.createBotStatsPayload(client);
          await this.makeRequestWithRetry(() => this.request('PUT', '/v2/cogworks/stats', stats));
        }
      } catch {
        enhancedLogger.warn('Failed to sync stats with API', LogCategory.API);
      }
    }, 300000);

    enhancedLogger.info('Started stats synchronization (5m interval)', LogCategory.API);
  }

  private createBotStatsPayload(client: Client): BotStatsPayload {
    return {
      botId: client.user?.id || 'unknown',
      username: client.user?.username || 'Cogworks Bot',
      guilds: client.guilds.cache.size,
      users: client.users.cache.size,
      uptime: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage().heapUsed,
      version,
      environment: process.env.RELEASE === 'dev' ? 'development' : 'production',
    };
  }

  async logCommand(commandName: string, guildId: string, userId: string): Promise<void> {
    try {
      if (this.isConnected) {
        await this.makeRequestWithRetry(() =>
          this.request('POST', '/v2/cogworks/command-log', {
            command: commandName,
            guildId,
            userId,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    } catch {
      enhancedLogger.warn('Failed to log command to API', LogCategory.API);
    }
  }

  isConnectedToAPI(): boolean {
    return this.isConnected && this.circuitState !== CircuitState.OPEN;
  }

  async syncStats(client: Client): Promise<void> {
    if (client.isReady() && this.isConnected) {
      const stats = this.createBotStatsPayload(client);
      await this.makeRequestWithRetry(() => this.request('PUT', '/v2/cogworks/stats', stats));
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.canMakeRequest()) {
        return false;
      }
      await this.makeRequestWithRetry(() => this.request('GET', '/health'));
      return true;
    } catch {
      return false;
    }
  }

  getMetrics(): APIMetrics {
    return { ...this.metrics };
  }

  getCircuitBreakerStatus(): {
    state: CircuitState;
    stateChangedAt: number;
    consecutiveFailures: number;
    canMakeRequest: boolean;
  } {
    return {
      state: this.circuitState,
      stateChangedAt: this.circuitStateChangedAt,
      consecutiveFailures: this.metrics.consecutiveFailures,
      canMakeRequest: this.canMakeRequest(),
    };
  }

  resetCircuitBreaker(): void {
    this.transitionToClosed();
    enhancedLogger.info('Circuit breaker manually reset', LogCategory.API);
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.registerRetryTimer) {
      clearTimeout(this.registerRetryTimer);
      this.registerRetryTimer = null;
    }

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.isConnected) {
      try {
        await this.makeRequestWithRetry(() =>
          this.request('POST', '/v2/cogworks/disconnect', {
            timestamp: new Date().toISOString(),
            metrics: this.metrics,
          }),
        );
      } catch {
        enhancedLogger.warn('Error during API disconnect', LogCategory.API);
      }
    }

    this.isConnected = false;
    enhancedLogger.info('Disconnected from API', LogCategory.API);
    this.logMetricsSummary();
  }

  private logMetricsSummary(): void {
    const successRate =
      this.metrics.totalRequests > 0
        ? Math.round((this.metrics.successfulRequests / this.metrics.totalRequests) * 100)
        : 0;
    enhancedLogger.info('API Metrics Summary', LogCategory.API, {
      totalRequests: this.metrics.totalRequests,
      successful: this.metrics.successfulRequests,
      successRate: `${successRate}%`,
      failed: this.metrics.failedRequests,
      totalRetries: this.metrics.totalRetries,
      avgResponseTime: `${Math.round(this.metrics.averageResponseTime)}ms`,
      circuitBreakerState: this.circuitState,
    });
  }
}
