import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Client } from 'discord.js';
import { MAX } from '../constants';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { ApiError } from './apiError';
import { getBindHost } from './bindHost';
import { validateAuth } from './internalApiAuth';
import { type RouteHandler, registerHandlers } from './router';

const MAX_BODY_SIZE = MAX.API_BODY_SIZE;

/** Top-level routes live under /internal/ (e.g. GET /internal/guilds); every other key is guild-scoped. */
const TOP_LEVEL_PREFIX = '/internal/';

interface RouteTable {
  exact: Map<string, RouteHandler>;
  patterns: Array<{ regex: RegExp; handler: RouteHandler }>;
}

const emptyTable = (): RouteTable => ({ exact: new Map(), patterns: [] });

export class InternalApiServer {
  private server: Server | null = null;
  private client: Client | null = null;
  private routes: Map<string, RouteHandler> = new Map();
  // Separate tables so a guild handler is only reachable behind
  // /internal/guilds/:id (which checks the bot is in that guild) and a
  // top-level handler never runs with a guildId.
  private topLevel: RouteTable = emptyTable();
  private guildScoped: RouteTable = emptyTable();

  initialize(client: Client): void {
    this.client = client;
    this.routes = registerHandlers(client);
    this.recompilePatterns();
    enhancedLogger.info('Internal API server initialized', LogCategory.SYSTEM);
  }

  /** Register additional routes after initialization (e.g., status handlers that need StatusManager) */
  registerLateRoutes(register: (routes: Map<string, RouteHandler>) => void): void {
    register(this.routes);
    this.recompilePatterns();
  }

  private recompilePatterns(): void {
    // Pre-compile parameterized route patterns for O(n) matching without per-request regex creation
    this.topLevel = emptyTable();
    this.guildScoped = emptyTable();
    for (const [key, handler] of this.routes) {
      const path = key.slice(key.indexOf(' ') + 1);
      const table = path.startsWith(TOP_LEVEL_PREFIX) ? this.topLevel : this.guildScoped;
      if (key.includes(':')) {
        const regex = new RegExp(`^${key.replace(/:(\w+)/g, '(\\d+)')}$`);
        table.patterns.push({ regex, handler });
      } else {
        table.exact.set(key, handler);
      }
    }
  }

  start(port = 3002): void {
    if (this.server) return;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    const host = getBindHost();
    this.server.listen(port, host, () => {
      enhancedLogger.info(`Internal API server listening on ${host}:${port}`, LogCategory.SYSTEM);
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

    // Only GET, POST, and DELETE allowed
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
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

    // Top-level routes (e.g. GET /internal/guilds, GET /internal/health)
    const urlPath = url.split('?')[0].replace(/\/$/, ''); // strip query params and trailing slash
    const topLevelHandler = matchRoute(this.topLevel, `${method} ${urlPath}`);
    if (topLevelHandler) {
      enhancedLogger.debug(`Internal API: ${method} ${url}`, LogCategory.API);
      await runHandler(res, topLevelHandler, '', body, url);
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
    const handler = matchRoute(this.guildScoped, `${method} ${subPath}`);

    if (!handler) {
      sendJson(res, 404, { error: 'Endpoint not found' });
      return;
    }

    enhancedLogger.debug(`Internal API: ${method} ${url}`, LogCategory.API, {
      guildId,
    });

    await runHandler(res, handler, guildId, body, url);
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

function matchRoute(table: RouteTable, routeKey: string): RouteHandler | null {
  const exact = table.exact.get(routeKey);
  if (exact) return exact;
  for (const { regex, handler } of table.patterns) {
    if (regex.test(routeKey)) return handler;
  }
  return null;
}

/** Run a handler: 200 with its result, the ApiError's status, or a logged 500. */
async function runHandler(
  res: ServerResponse,
  handler: RouteHandler,
  guildId: string,
  body: Record<string, unknown>,
  url: string,
): Promise<void> {
  try {
    sendJson(res, 200, await handler(guildId, body, url));
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    enhancedLogger.error(
      `Internal API handler error: ${url}`,
      error instanceof Error ? error : undefined,
      LogCategory.API,
      guildId ? { guildId, url } : { url },
    );
    sendJson(res, 500, { error: 'Internal server error' });
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
        const parsed: unknown = raw ? JSON.parse(raw) : {};
        // Handlers index body[field]; null, arrays and primitives are a 400, not a 500
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          reject(new Error('Body must be a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

export const internalApiServer = new InternalApiServer();
