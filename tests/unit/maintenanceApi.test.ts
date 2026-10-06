/**
 * Maintenance-mode internal API auth.
 *
 * The listener compared JS string lengths and then called timingSafeEqual,
 * which compares byte lengths. A header with the right character count and
 * one non-ASCII character threw a RangeError inside the request listener,
 * which reached the global uncaughtException handler and shut the bot down.
 * It now uses the full-mode validateAuth and catches anything else.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleMaintenanceApiRequest, listenLogged } from '../../src/maintenance';

const TOKEN = 'maintenance-test-token';
const original = process.env.COGWORKS_INTERNAL_API_TOKEN;

beforeAll(() => {
  process.env.COGWORKS_INTERNAL_API_TOKEN = TOKEN;
});

afterAll(() => {
  if (original === undefined) delete process.env.COGWORKS_INTERNAL_API_TOKEN;
  else process.env.COGWORKS_INTERNAL_API_TOKEN = original;
});

function request(authorization: string | undefined, url = '/internal/maintenance') {
  const req = { url, headers: authorization === undefined ? {} : { authorization } } as unknown as IncomingMessage;
  const out = { status: 0, body: null as unknown, headersSent: false };
  const res = {
    get headersSent() {
      return out.headersSent;
    },
    writeHead(status: number) {
      out.status = status;
      out.headersSent = true;
    },
    end(data: string) {
      out.body = JSON.parse(data);
    },
  } as unknown as ServerResponse;
  handleMaintenanceApiRequest(req, res);
  return out;
}

describe('maintenance internal API', () => {
  test('a same-length header with a multi-byte character is a 401, not a crash', () => {
    const expected = `Bearer ${TOKEN}`;
    const header = `${expected.slice(0, -1)}é`;
    expect(header.length).toBe(expected.length);
    expect(Buffer.byteLength(header)).not.toBe(Buffer.byteLength(expected));

    expect(() => request(header)).not.toThrow();
    expect(request(header).status).toBe(401);
  });

  test('missing or wrong auth is a 401', () => {
    expect(request(undefined).status).toBe(401);
    expect(request('Bearer nope').status).toBe(401);
  });

  test('the right token reaches the maintenance status', () => {
    const out = request(`Bearer ${TOKEN}`);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ active: true });
  });

  test('other paths answer 503 while in maintenance', () => {
    expect(request(`Bearer ${TOKEN}`, '/internal/guilds/1/rules/setup').status).toBe(503);
  });
});

describe('maintenance servers: listen errors', () => {
  test('a bind failure (bad BOT_INTERNAL_HOST) is logged, not thrown as an uncaught error', async () => {
    const savedHost = process.env.BOT_INTERNAL_HOST;
    // TEST-NET-1 address: never assigned to a local interface, so bind fails (EADDRNOTAVAIL)
    process.env.BOT_INTERNAL_HOST = '192.0.2.1';
    let logged!: (args: unknown[]) => void;
    const loggedOnce = new Promise<unknown[]>(resolve => {
      logged = resolve;
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => logged(args));
    const server = createServer();
    try {
      // listenLogged's handler is the only 'error' listener: without it the
      // bind failure would be an unhandled 'error' event (uncaughtException).
      listenLogged(server, 0, 'Test server');
      expect(server.listenerCount('error')).toBe(1);
      const [message, error] = await loggedOnce;
      expect(String(message)).toContain('Test server failed on 192.0.2.1:0');
      expect(error).toBeInstanceOf(Error);
    } finally {
      errorSpy.mockRestore();
      server.close();
      if (savedHost === undefined) delete process.env.BOT_INTERNAL_HOST;
      else process.env.BOT_INTERNAL_HOST = savedHost;
    }
  });
});
