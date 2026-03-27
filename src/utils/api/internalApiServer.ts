import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import { MAX } from '../constants';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { ApiError } from './apiError';
import { validateAuth } from './internalApiAuth';
import { type RouteHandler, registerHandlers } from './router';

const MAX_BODY_SIZE = MAX.API_BODY_SIZE;

class InternalApiServer {
  private server: Server | null = null;
  private client: Client | null = null;
  private routes: Map<string, RouteHandler> = new Map();
  private compiledPatterns: Array<{ regex: RegExp; handler: RouteHandler }> = [];

  initialize(client: Client): void {
    this.client = client;
    this.routes = registerHandlers(client);
    // Pre-compile parameterized route patterns for O(n) matching without per-request regex creation
    this.compiledPatterns = [];
    for (const [pattern, handler] of this.routes) {
      if (pattern.includes(':')) {
        const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, '(\\d+)')}$`);
        this.compiledPatterns.push({ regex, handler });
      }
    }
    enhancedLogger.info('Internal API server initialized', LogCategory.SYSTEM);
  }

  start(port = 3002): void {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.server.listen(port, '0.0.0.0', () => {
      enhancedLogger.info(`Internal API server listening on 0.0.0.0:${port}`, LogCategory.SYSTEM);
    });

    this.server.on('error', (error: Error) => {
      enhancedLogger.error('Internal API server error', error, LogCategory.SYSTEM);
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method || 'GET';
    const url = req.url || '/';

    // Auth check
    if (!validateAuth(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    // Only GET and POST allowed
    if (method !== 'GET' && method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    // Parse body for POST requests
    let body: Record<string, unknown> = {};
    if (method === 'POST') {
      try {
        body = await parseBody(req);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
    }

    // Try non-guild routes first (e.g. GET /internal/guilds, GET /internal/health)
    const urlPath = url.split('?')[0].replace(/\/$/, ''); // strip query params and trailing slash
    const topLevelKey = `${method} ${urlPath}`;
    const topLevelHandler = this.matchRoute(topLevelKey);
    if (topLevelHandler) {
      enhancedLogger.debug(`Internal API: ${method} ${url}`, LogCategory.API);
      try {
        const result = await topLevelHandler('', body, url);
        sendJson(res, 200, result);
      } catch (error) {
        if (error instanceof ApiError) {
          sendJson(res, error.statusCode, { error: error.message });
          return;
        }
        enhancedLogger.error(
          `Internal API handler error: ${url}`,
          error instanceof Error ? error : undefined,
          LogCategory.API,
          { url },
        );
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    // Extract guildId from URL pattern: /internal/guilds/:guildId/...
    const guildMatch = url.match(/^\/internal\/guilds\/(\d+)(\/.*)?$/);
    if (!guildMatch) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const guildId = guildMatch[1];
    const rawSubPath = guildMatch[2] || '';
    const subPath = rawSubPath.split('?')[0]; // strip query params for route matching

    // Validate bot is in guild
    if (!this.client?.guilds.cache.has(guildId)) {
      sendJson(res, 404, { error: 'Guild not found' });
      return;
    }

    // Find matching route
    const routeKey = `${method} ${subPath}`;
    const handler = this.matchRoute(routeKey);

    if (!handler) {
      sendJson(res, 404, { error: 'Endpoint not found' });
      return;
    }

    enhancedLogger.debug(`Internal API: ${method} ${url}`, LogCategory.API, {
      guildId,
    });

    try {
      const result = await handler(guildId, body, url);
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      enhancedLogger.error(
        `Internal API handler error: ${url}`,
        error instanceof Error ? error : undefined,
        LogCategory.API,
        { guildId, url },
      );
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private matchRoute(routeKey: string): RouteHandler | null {
    // Try exact match first
    const exact = this.routes.get(routeKey);
    if (exact) return exact;

    // Try pre-compiled parameterized patterns (no per-request regex creation)
    for (const { regex, handler } of this.compiledPatterns) {
      if (regex.test(routeKey)) return handler;
    }

    return null;
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        enhancedLogger.info('Internal API server stopped', LogCategory.SYSTEM);
        this.server = null;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

export const internalApiServer = new InternalApiServer();
