import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ErrorCategory, ErrorSeverity } from '../../../../src/utils/errorHandler';
import { errorReporter } from '../../../../src/utils/monitoring/errorReporter';

// These tests drive the singleton directly. We stub `fetch` on the global
// object to observe outbound webhook traffic without touching Discord.
// The reporter's report() method is fire-and-forget (void-returning), so we
// flush the microtask queue via `await Promise.resolve()` cycles before
// asserting.

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

const realFetch = globalThis.fetch;
let calls: FetchCall[] = [];
let nextMessageId = 1;

function installFetchStub(
  opts: {
    postStatus?: number;
    patchStatus?: number;
  } = {},
): void {
  calls = [];
  nextMessageId = 1;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });

    if (method === 'PATCH') {
      const status = opts.patchStatus ?? 200;
      return new Response(JSON.stringify({ id: 'patched' }), { status });
    }
    const status = opts.postStatus ?? 200;
    const id = String(nextMessageId++);
    return new Response(JSON.stringify({ id }), { status });
  }) as typeof fetch;
}

// Each report() is async internally — flush pending microtasks.
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function makeReport(message = 'boom', severity = ErrorSeverity.HIGH) {
  const err = new Error(message);
  // Minimal, deterministic stack so fingerprints stay stable across runs.
  err.stack = `Error: ${message}\n    at fakeFrame (src/fake.ts:1:1)`;
  return {
    error: err,
    category: ErrorCategory.UNKNOWN,
    severity,
    context: { traceId: 'abc' },
    guildId: 'guild-1',
    userId: 'user-1',
    command: 'ping',
  };
}

beforeEach(() => {
  errorReporter.reset();
  errorReporter.configure({
    webhookUrl: 'https://example.test/webhooks/1/tok',
    enabled: true,
    dedupeWindowMs: 60_000,
    maxReportsPerMinute: 3,
    minSeverity: ErrorSeverity.MEDIUM,
  });
  installFetchStub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  errorReporter.reset();
});

describe('enablement gate', () => {
  test('no-ops when no webhook URL is configured', async () => {
    errorReporter.configure({ webhookUrl: undefined });
    errorReporter.report(makeReport());
    await flushAsync();
    expect(calls).toHaveLength(0);
  });

  test('no-ops when enabled=false', async () => {
    errorReporter.configure({ enabled: false });
    errorReporter.report(makeReport());
    await flushAsync();
    expect(calls).toHaveLength(0);
  });

  test('isEnabled() reflects webhook + enabled flags', () => {
    expect(errorReporter.isEnabled()).toBe(true);
    errorReporter.configure({ enabled: false });
    expect(errorReporter.isEnabled()).toBe(false);
    errorReporter.configure({ enabled: true, webhookUrl: undefined });
    expect(errorReporter.isEnabled()).toBe(false);
  });
});

describe('severity gate', () => {
  test('drops reports below minSeverity', async () => {
    errorReporter.configure({ minSeverity: ErrorSeverity.HIGH });
    errorReporter.report(makeReport('medium', ErrorSeverity.MEDIUM));
    await flushAsync();
    expect(calls).toHaveLength(0);
  });

  test('forwards reports at or above minSeverity', async () => {
    errorReporter.configure({ minSeverity: ErrorSeverity.MEDIUM });
    errorReporter.report(makeReport('medium', ErrorSeverity.MEDIUM));
    await flushAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
  });
});

describe('POST transport', () => {
  test('first occurrence posts a new message with ?wait=true', async () => {
    errorReporter.report(makeReport());
    await flushAsync();

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('?wait=true');
    const body = calls[0].body as { embeds: Array<Record<string, unknown>> };
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toContain('HIGH');
  });

  test('includes command / guild / user / context fields in embed', async () => {
    errorReporter.report(makeReport());
    await flushAsync();

    const body = calls[0].body as {
      embeds: Array<{ fields?: Array<{ name: string; value: string }> }>;
    };
    const fields = body.embeds[0].fields ?? [];
    const names = fields.map(f => f.name);
    expect(names).toContain('Category');
    expect(names).toContain('Severity');
    expect(names).toContain('Command');
    expect(names).toContain('Guild');
    expect(names).toContain('User');
  });
});

describe('deduplication', () => {
  test('identical error within window PATCHes the original message', async () => {
    errorReporter.report(makeReport('dup'));
    await flushAsync();
    errorReporter.report(makeReport('dup'));
    await flushAsync();
    errorReporter.report(makeReport('dup'));
    await flushAsync();

    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    const patches = calls.filter(c => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[0].url).toContain('/messages/1');
  });

  test('patched embed includes an Occurrences field with the updated count', async () => {
    errorReporter.report(makeReport('dup'));
    await flushAsync();
    errorReporter.report(makeReport('dup'));
    await flushAsync();

    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch).toBeTruthy();
    const body = patch?.body as { embeds: Array<{ fields: Array<{ name: string; value: string }> }> };
    const occurrences = body.embeds[0].fields.find(f => f.name === 'Occurrences');
    expect(occurrences).toBeTruthy();
    expect(occurrences?.value).toBe('2');
  });

  test('different errors are NOT deduplicated', async () => {
    errorReporter.report(makeReport('first'));
    await flushAsync();
    errorReporter.report(makeReport('second'));
    await flushAsync();

    expect(calls.filter(c => c.method === 'POST')).toHaveLength(2);
    expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(0);
  });
});

describe('rate limiting', () => {
  test('drops reports past maxReportsPerMinute (distinct fingerprints)', async () => {
    errorReporter.configure({ maxReportsPerMinute: 2 });

    errorReporter.report(makeReport('one'));
    await flushAsync();
    errorReporter.report(makeReport('two'));
    await flushAsync();
    errorReporter.report(makeReport('three')); // rate limited
    await flushAsync();

    expect(calls.filter(c => c.method === 'POST')).toHaveLength(2);
  });

  test('dedupe edits do not consume the per-minute budget', async () => {
    errorReporter.configure({ maxReportsPerMinute: 2 });

    errorReporter.report(makeReport('same'));
    await flushAsync();
    errorReporter.report(makeReport('same'));
    await flushAsync();
    errorReporter.report(makeReport('same'));
    await flushAsync();
    errorReporter.report(makeReport('new')); // distinct, still within budget
    await flushAsync();

    expect(calls.filter(c => c.method === 'POST')).toHaveLength(2);
  });
});

describe('fault tolerance', () => {
  test('fetch rejection is swallowed — reporter never throws', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    expect(() => errorReporter.report(makeReport())).not.toThrow();
    await flushAsync();
    // No further assertions — the point is that no exception escaped.
  });

  test('non-2xx POST response does not crash subsequent reports', async () => {
    installFetchStub({ postStatus: 500 });
    errorReporter.report(makeReport('crashy'));
    await flushAsync();
    // New distinct error should still attempt to post.
    errorReporter.report(makeReport('different'));
    await flushAsync();
    expect(calls.filter(c => c.method === 'POST').length).toBeGreaterThanOrEqual(2);
  });
});
