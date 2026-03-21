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

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import type { Client } from 'discord.js';
import { version } from '../../package.json';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';

/**
 * Bot stats data sent to API (v1.3.0 format)
 */
interface BotStatsPayload {
  botId: string; // client.user.id
  username: string; // client.user.username
  guilds: number; // Number of guilds
  users: number; // Number of users
  uptime: number; // Process uptime in seconds
  memoryUsage: number; // Heap memory usage in bytes
  version: string; // Bot version
  environment: string; // 'production' or 'development'
}

/**
 * Circuit breaker states
 */
enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Too many failures, blocking requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
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
  baseDelay: number; // Initial delay in ms
  maxDelay: number; // Maximum delay in ms
  backoffMultiplier: number;
}

/**
 * Circuit breaker configuration
 */
interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time in ms before attempting half-open
  halfOpenMaxAttempts: number; // Max requests to test in half-open state
}

/**
 * Enhanced connector class for communicating with API.
 * Features:
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern for fault tolerance
 * - Health monitoring and metrics
 * - Request/response logging
 * - Graceful degradation
 */
export class APIConnector {
  private apiClient: AxiosInstance;
  private statsInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;

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
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
  };

  private readonly circuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    halfOpenMaxAttempts: 3,
  };

  /**
   * Initialize the API connector.
   *
   * @param {string} apiUrl Base URL of the API
   * @param {string} botToken Cogworks Bot token for authentication
   */
  constructor(apiUrl: string, botToken: string) {
    this.apiClient = axios.create({
      baseURL: apiUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botToken}`,
      },
    });

    // Add response interceptor for logging and metrics
    this.apiClient.interceptors.response.use(
      response => {
        this.recordSuccess(response.config.url || 'unknown');
        return response;
      },
      (error: AxiosError) => {
        this.recordFailure(error.config?.url || 'unknown', error);
        return Promise.reject(error);
      },
    );
  }

  /**
   * Register the bot with API with retry logic.
   * Sends initial bot data and establishes connection.
   *
   * @param {Client} client Discord.js client instance
   */
  async registerBot(client: Client): Promise<void> {
    try {
      // Verify API is accessible
      await this.makeRequestWithRetry(() => this.apiClient.get('/health'));

      // Send initial bot registration data
      const botData = this.createBotStatsPayload(client);
      await this.makeRequestWithRetry(() => this.apiClient.post('/v2/cogworks/register', botData));

      this.isConnected = true;
      this.startHealthCheck();
      enhancedLogger.info('Bot registered with API', LogCategory.API);
    } catch {
      enhancedLogger.error(
        'Failed to register bot with API',
        new Error('API registration failed'),
        LogCategory.API,
      );
      this.isConnected = false;
      // Don't throw - allow bot to continue without API
    }
  }

  /**
   * Make an HTTP request with retry logic and exponential backoff.
   *
   * @param requestFn Function that makes the axios request
   * @param retryCount Current retry attempt
   * @returns Promise with the response
   */
  private async makeRequestWithRetry<T>(
    requestFn: () => Promise<T>,
    retryCount: number = 0,
  ): Promise<T> {
    // Check circuit breaker
    if (!this.canMakeRequest()) {
      throw new Error('Circuit breaker is OPEN - API is unavailable');
    }

    const startTime = Date.now();
    this.metrics.totalRequests++;
    this.metrics.lastRequestTime = startTime;

    try {
      const response = await requestFn();

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateAverageResponseTime(duration);

      return response;
    } catch (error) {
      this.metrics.totalRetries++;

      // Check if we should retry
      if (retryCount < this.retryConfig.maxRetries && this.shouldRetry(error as Error)) {
        const delay = this.calculateBackoff(retryCount);
        enhancedLogger.warn(
          `API request failed, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.retryConfig.maxRetries})`,
          LogCategory.API,
        );

        await this.sleep(delay);
        return this.makeRequestWithRetry(requestFn, retryCount + 1);
      }

      // All retries exhausted
      throw error;
    }
  }

  /**
   * Check if circuit breaker allows requests
   */
  private canMakeRequest(): boolean {
    const now = Date.now();

    switch (this.circuitState) {
      case CircuitState.CLOSED:
        return true;

      case CircuitState.OPEN:
        // Check if enough time has passed to try half-open
        if (now - this.circuitStateChangedAt >= this.circuitBreakerConfig.resetTimeout) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;

      case CircuitState.HALF_OPEN:
        // Allow limited requests in half-open state
        return this.halfOpenAttempts < this.circuitBreakerConfig.halfOpenMaxAttempts;

      default:
        return false;
    }
  }

  /**
   * Determine if an error is retryable
   */
  private shouldRetry(error: Error): boolean {
    const axiosError = error as AxiosError;

    // Don't retry on 4xx errors (client errors)
    if (
      axiosError.response?.status &&
      axiosError.response.status >= 400 &&
      axiosError.response.status < 500
    ) {
      return false;
    }

    // Retry on network errors, timeouts, and 5xx errors
    return true;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(retryCount: number): number {
    const delay = Math.min(
      this.retryConfig.baseDelay * this.retryConfig.backoffMultiplier ** retryCount,
      this.retryConfig.maxDelay,
    );

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Record successful API request
   */
  private recordSuccess(endpoint: string): void {
    this.metrics.successfulRequests++;
    this.metrics.lastSuccessTime = Date.now();
    this.metrics.consecutiveFailures = 0;

    // Circuit breaker logic
    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.halfOpenAttempts++;

      // If we've had enough successful attempts, close the circuit
      if (this.halfOpenAttempts >= this.circuitBreakerConfig.halfOpenMaxAttempts) {
        this.transitionToClosed();
      }
    }

    enhancedLogger.debug(
      `API Success: ${endpoint} (${this.metrics.successfulRequests}/${this.metrics.totalRequests})`,
      LogCategory.API,
    );
  }

  /**
   * Record failed API request
   */
  private recordFailure(endpoint: string, error: AxiosError): void {
    this.metrics.failedRequests++;
    this.metrics.lastErrorTime = Date.now();
    this.metrics.consecutiveFailures++;

    const status = error.response?.status || 'network error';
    enhancedLogger.warn(
      `API Failure: ${endpoint} (${status}) - ${this.metrics.consecutiveFailures} consecutive failures`,
      LogCategory.API,
      {
        endpoint,
        status,
        consecutiveFailures: this.metrics.consecutiveFailures,
      },
    );

    // Circuit breaker logic
    if (this.circuitState === CircuitState.HALF_OPEN) {
      // Failed in half-open, go back to open
      this.transitionToOpen();
    } else if (
      this.circuitState === CircuitState.CLOSED &&
      this.metrics.consecutiveFailures >= this.circuitBreakerConfig.failureThreshold
    ) {
      // Too many failures, open the circuit
      this.transitionToOpen();
    }
  }

  /**
   * Transition circuit breaker to CLOSED state
   */
  private transitionToClosed(): void {
    enhancedLogger.info('Circuit Breaker: CLOSED (API healthy)', LogCategory.API);
    this.circuitState = CircuitState.CLOSED;
    this.circuitStateChangedAt = Date.now();
    this.halfOpenAttempts = 0;
    this.metrics.consecutiveFailures = 0;
  }

  /**
   * Transition circuit breaker to OPEN state
   */
  private transitionToOpen(): void {
    enhancedLogger.warn(
      'Circuit Breaker: OPEN (API unhealthy, blocking requests)',
      LogCategory.API,
    );
    this.circuitState = CircuitState.OPEN;
    this.circuitStateChangedAt = Date.now();
    this.halfOpenAttempts = 0;
  }

  /**
   * Transition circuit breaker to HALF_OPEN state
   */
  private transitionToHalfOpen(): void {
    enhancedLogger.info('Circuit Breaker: HALF-OPEN (testing API recovery)', LogCategory.API);
    this.circuitState = CircuitState.HALF_OPEN;
    this.circuitStateChangedAt = Date.now();
    this.halfOpenAttempts = 0;
  }

  /**
   * Update average response time metric
   */
  private updateAverageResponseTime(duration: number): void {
    const totalDuration =
      this.metrics.averageResponseTime * (this.metrics.successfulRequests - 1) + duration;
    this.metrics.averageResponseTime = totalDuration / this.metrics.successfulRequests;
  }

  /**
   * Start periodic health checks
   */
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
    }, 300000); // Check every 5 minutes

    enhancedLogger.info('Started API health monitoring (5m interval)', LogCategory.API);
  }

  /**
   * Start periodic stats synchronization with API.
   * Sends updated bot statistics every 5 minutes with retry logic.
   *
   * @param {Client} client - Discord.js client instance
   */
  startStatsSync(client: Client): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }

    this.statsInterval = setInterval(async () => {
      try {
        if (client.isReady() && this.isConnected) {
          const stats = this.createBotStatsPayload(client);
          await this.makeRequestWithRetry(() => this.apiClient.put('/v2/cogworks/stats', stats));
        }
      } catch {
        // Don't throw - just log the error and continue
        enhancedLogger.warn('Failed to sync stats with API', LogCategory.API);
      }
    }, 300000); // 5 minutes

    enhancedLogger.info('Started stats synchronization (5m interval)', LogCategory.API);
  }

  /**
   * Create bot stats payload for API communication (v1.3.0 format)
   *
   * @param {Client} client Discord.js client instance
   * @returns {BotStatsPayload} Formatted bot statistics
   */
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

  /**
   * Send a command execution log to API with retry logic.
   * Useful for tracking bot usage through the API.
   *
   * @param {string} commandName Name of the executed command
   * @param {string} guildId Guild where command was executed
   * @param {string} userId User who executed the command
   */
  async logCommand(commandName: string, guildId: string, userId: string): Promise<void> {
    try {
      if (this.isConnected) {
        await this.makeRequestWithRetry(() =>
          this.apiClient.post('/v2/cogworks/command-log', {
            command: commandName,
            guildId,
            userId,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    } catch {
      // Silent fail for command logging - not critical
      enhancedLogger.warn('Failed to log command to API', LogCategory.API);
    }
  }

  /**
   * Get current API connection status.
   *
   * @returns {boolean} True if connected to API
   */
  isConnectedToAPI(): boolean {
    return this.isConnected && this.circuitState !== CircuitState.OPEN;
  }

  /**
   * Manually trigger a stats sync with retry logic.
   *
   * @param {Client} client Discord.js client instance
   */
  async syncStats(client: Client): Promise<void> {
    if (client.isReady() && this.isConnected) {
      const stats = this.createBotStatsPayload(client);
      await this.makeRequestWithRetry(() => this.apiClient.put('/v2/cogworks/stats', stats));
    }
  }

  /**
   * Test connection to API with circuit breaker awareness.
   *
   * @returns {Promise<boolean>} True if API is accessible
   */
  async testConnection(): Promise<boolean> {
    try {
      if (!this.canMakeRequest()) {
        return false;
      }
      await this.makeRequestWithRetry(() => this.apiClient.get('/health'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current API metrics for monitoring.
   *
   * @returns {APIMetrics} Current API statistics
   */
  getMetrics(): APIMetrics {
    return { ...this.metrics };
  }

  /**
   * Get circuit breaker state.
   *
   * @returns Circuit breaker state and info
   */
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

  /**
   * Reset circuit breaker and metrics (admin function).
   * Use with caution!
   */
  resetCircuitBreaker(): void {
    this.transitionToClosed();
    enhancedLogger.info('Circuit breaker manually reset', LogCategory.API);
  }

  /**
   * Disconnect from API.
   * Stops stats sync, health checks, and cleans up resources.
   */
  async disconnect(): Promise<void> {
    // Stop intervals
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Notify API of disconnect
    if (this.isConnected) {
      try {
        await this.makeRequestWithRetry(() =>
          this.apiClient.post('/v2/cogworks/disconnect', {
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

    // Log final metrics
    this.logMetricsSummary();
  }

  /**
   * Log metrics summary (useful for debugging and monitoring).
   */
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
