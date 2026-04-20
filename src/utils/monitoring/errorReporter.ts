/**
 * Error Reporter
 *
 * Fire-and-forget external error transport. Forwards `MEDIUM`+ errors to a
 * Discord webhook as rich embeds, with:
 *
 *   - **Deduplication** — identical errors within `dedupeWindowMs` are
 *     collapsed: the original webhook message is PATCHed to increment a
 *     hit counter instead of spawning a new alert.
 *   - **Rate limiting** — a per-minute ceiling prevents a single crash loop
 *     from burying moderators under hundreds of webhook messages.
 *   - **Bot metadata enrichment** — version, uptime, and guild count are
 *     attached so on-call has enough context without digging through logs.
 *
 * The reporter never throws — webhook failures are swallowed with an internal
 * console.warn so the bot's main code path is never blocked by outbound
 * network issues.
 *
 * Usage:
 *   errorReporter.report({ error, category, severity, context, command });
 *
 * Wire-up (done in index.ts + errorHandler.ts):
 *   errorReporter.configure({ webhookUrl: process.env.ERROR_WEBHOOK_URL, ... });
 *   errorReporter.setClient(client);
 */

import type { Client } from 'discord.js';
import type { ErrorCategory, ErrorSeverity } from '../errorHandler';
import { enhancedLogger, LogCategory } from './enhancedLogger';

// We use `import type` for ErrorSeverity/ErrorCategory to avoid a circular
// module-load cycle: errorHandler.logError() calls into the reporter, and
// the reporter builds severity rank/color tables at module scope. Since
// `ErrorSeverity` is a string enum, referencing its literal string values
// ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') keeps the Record keys aligned with
// the real enum without needing a runtime import.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorReport {
  error: Error;
  category: ErrorCategory;
  severity: ErrorSeverity;
  context?: Record<string, unknown>;
  guildId?: string;
  userId?: string;
  command?: string;
}

export interface ErrorReporterConfig {
  /** Discord webhook URL. Reporter is disabled when this is empty/undefined. */
  webhookUrl?: string;
  /** Master enable flag. Also requires `webhookUrl`. */
  enabled: boolean;
  /** Window during which identical errors increment a counter instead of
   *  producing a new message. Default: 60_000 ms. */
  dedupeWindowMs: number;
  /** Maximum number of NEW (non-dedupe) reports per rolling minute. Dedupe
   *  edits do not count toward this limit. Default: 10. */
  maxReportsPerMinute: number;
  /** Minimum severity to report. Default: MEDIUM. */
  minSeverity: ErrorSeverity;
}

interface DedupeEntry {
  /** ID of the Discord message we posted for the first occurrence. */
  messageId: string | null;
  /** When the first occurrence was reported. */
  firstSeen: number;
  /** Wall-clock of the most recent occurrence. */
  lastSeen: number;
  /** Total occurrences seen within the dedupe window. */
  count: number;
  /** Parameters frozen from the first report — used when editing the embed. */
  snapshot: ErrorReport;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ErrorReporterConfig = {
  webhookUrl: undefined,
  enabled: false,
  dedupeWindowMs: 60_000,
  maxReportsPerMinute: 10,
  minSeverity: 'MEDIUM' as ErrorSeverity,
};

const SEVERITY_RANK: Record<ErrorSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const SEVERITY_COLOR: Record<ErrorSeverity, number> = {
  LOW: 0xcccccc, // gray
  MEDIUM: 0xffcc00, // yellow
  HIGH: 0xff8800, // orange
  CRITICAL: 0xff0000, // red
};

// Discord embed description limit is 4096; we stay well under it.
const STACK_CHAR_LIMIT = 1400;
const MESSAGE_CHAR_LIMIT = 1000;

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export class ErrorReporter {
  private config: ErrorReporterConfig = { ...DEFAULT_CONFIG };
  private client: Client | null = null;
  private startTime = Date.now();

  /** Sliding window of report timestamps from the last minute. */
  private recentReportTimes: number[] = [];

  /** fingerprint → DedupeEntry. Pruned lazily as entries age past the window. */
  private dedupeCache = new Map<string, DedupeEntry>();

  // ----- Configuration -----

  public configure(overrides: Partial<ErrorReporterConfig>): void {
    this.config = { ...this.config, ...overrides };
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  /** Test/introspection helpers. */
  public getConfig(): Readonly<ErrorReporterConfig> {
    return { ...this.config };
  }

  public isEnabled(): boolean {
    return Boolean(this.config.enabled && this.config.webhookUrl);
  }

  /** For tests: reset all runtime state (dedupe cache, rate limit window). */
  public reset(): void {
    this.config = { ...DEFAULT_CONFIG };
    this.client = null;
    this.recentReportTimes = [];
    this.dedupeCache.clear();
    this.startTime = Date.now();
  }

  // ----- Public entry point -----

  /**
   * Report an error. Fire-and-forget: never throws, never blocks the caller.
   * Safe to invoke from hot paths.
   */
  public report(report: ErrorReport): void {
    // Kick off async work without awaiting — callers should not pay latency
    // for a logging/transport side channel.
    void this.reportInternal(report).catch(err => {
      // Last-resort log. We deliberately don't re-report this error to avoid
      // infinite loops through our own pipeline.
      console.warn('[errorReporter] internal failure:', err instanceof Error ? err.message : String(err));
    });
  }

  // ----- Internal pipeline -----

  private async reportInternal(report: ErrorReport): Promise<void> {
    if (!this.isEnabled()) return;

    // Severity gate.
    if (SEVERITY_RANK[report.severity] < SEVERITY_RANK[this.config.minSeverity]) return;

    const fingerprint = this.fingerprint(report.error, report.category);
    const now = Date.now();

    // Dedupe path — identical error within window.
    const cached = this.dedupeCache.get(fingerprint);
    if (cached && now - cached.firstSeen < this.config.dedupeWindowMs) {
      cached.count += 1;
      cached.lastSeen = now;
      // Edits don't count toward rate limit; they're replacing an existing
      // message, not producing a new one.
      await this.editExistingMessage(cached);
      return;
    }

    // Rate limit path — only applies to NEW reports.
    this.prunePastMinute(now);
    if (this.recentReportTimes.length >= this.config.maxReportsPerMinute) {
      // Drop silently. Stdout logger already captured this error upstream, so
      // nothing is lost — we just don't page external transport.
      return;
    }

    // New report.
    this.recentReportTimes.push(now);
    const entry: DedupeEntry = {
      messageId: null,
      firstSeen: now,
      lastSeen: now,
      count: 1,
      snapshot: report,
    };
    this.dedupeCache.set(fingerprint, entry);
    entry.messageId = await this.postNewMessage(entry);

    // Lazy cleanup of aged entries so the map doesn't grow unbounded.
    this.pruneDedupeCache(now);
  }

  // ----- Fingerprint -----

  /**
   * Fingerprint for dedupe. Combines category + error name + first
   * stack-trace frame (which is the deepest user-code frame in most Node
   * stacks). This groups "same error from same code path" while separating
   * unrelated errors that happen to share a message.
   */
  private fingerprint(error: Error, category: ErrorCategory): string {
    const name = error.name || 'Error';
    const message = (error.message || '').slice(0, 200);
    const frame = this.firstStackFrame(error.stack);
    return `${category}|${name}|${message}|${frame}`;
  }

  private firstStackFrame(stack: string | undefined): string {
    if (!stack) return '';
    const lines = stack.split('\n');
    // Skip the header (`Error: message`); the first frame is line index 1.
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith('at ')) return line;
    }
    return '';
  }

  // ----- Window pruning -----

  private prunePastMinute(now: number): void {
    const cutoff = now - 60_000;
    // Small buffer; expected to stay <= maxReportsPerMinute in steady state.
    this.recentReportTimes = this.recentReportTimes.filter(t => t >= cutoff);
  }

  private pruneDedupeCache(now: number): void {
    // Entries are safe to drop once their window closes — a later identical
    // error becomes a new alert rather than an edit, which is correct.
    for (const [key, entry] of this.dedupeCache) {
      if (now - entry.firstSeen >= this.config.dedupeWindowMs) {
        this.dedupeCache.delete(key);
      }
    }
  }

  // ----- Embed construction -----

  private buildEmbed(entry: DedupeEntry): Record<string, unknown> {
    const { snapshot, count } = entry;
    const { error, category, severity, context, guildId, userId, command } = snapshot;

    const stack = this.truncate(error.stack ?? '', STACK_CHAR_LIMIT);
    const message = this.truncate(error.message || error.name || 'Unknown error', MESSAGE_CHAR_LIMIT);

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: 'Category', value: category, inline: true },
      { name: 'Severity', value: severity, inline: true },
    ];
    if (count > 1) fields.push({ name: 'Occurrences', value: String(count), inline: true });
    if (command) fields.push({ name: 'Command', value: command, inline: true });
    if (guildId) fields.push({ name: 'Guild', value: guildId, inline: true });
    if (userId) fields.push({ name: 'User', value: userId, inline: true });

    const extraContext = this.formatContext(context);
    if (extraContext) fields.push({ name: 'Context', value: extraContext, inline: false });

    const description = stack ? `**${message}**\n\`\`\`\n${stack}\n\`\`\`` : `**${message}**`;

    const version = this.getBotVersion();
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const guildCount = this.client?.guilds?.cache?.size ?? 0;

    return {
      title: `${severity} · ${error.name || 'Error'}`,
      description,
      color: SEVERITY_COLOR[severity],
      fields,
      footer: {
        text: `v${version} · uptime ${this.formatUptime(uptimeSec)} · ${guildCount} guild(s)`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private truncate(input: string, limit: number): string {
    if (input.length <= limit) return input;
    return `${input.slice(0, limit - 20)}\n… (truncated)`;
  }

  private formatContext(context: Record<string, unknown> | undefined): string {
    if (!context) return '';
    try {
      const serialized = JSON.stringify(context, null, 2);
      if (!serialized || serialized === '{}') return '';
      return `\`\`\`json\n${this.truncate(serialized, 900)}\n\`\`\``;
    } catch {
      return '';
    }
  }

  private formatUptime(sec: number): string {
    const d = Math.floor(sec / 86_400);
    const h = Math.floor((sec % 86_400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d${h}h`;
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
  }

  private botVersionCache: string | null = null;
  private getBotVersion(): string {
    if (this.botVersionCache) return this.botVersionCache;
    try {
      // Lazy to avoid top-level JSON import churn; errorReporter is loaded
      // before package.json is guaranteed resolvable in some test harnesses.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../../package.json') as { version?: string };
      this.botVersionCache = pkg.version ?? 'unknown';
    } catch {
      this.botVersionCache = 'unknown';
    }
    return this.botVersionCache;
  }

  // ----- Webhook transport -----

  /** POST a new message. Returns Discord's message ID so we can later PATCH it. */
  private async postNewMessage(entry: DedupeEntry): Promise<string | null> {
    const url = this.config.webhookUrl;
    if (!url) return null;
    try {
      const embed = this.buildEmbed(entry);
      // ?wait=true makes Discord return the created message body (including id).
      const response = await fetch(`${url}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!response.ok) {
        this.logTransportFailure('POST', response.status, await this.readBodySafe(response));
        return null;
      }
      const body = (await response.json()) as { id?: string };
      return body?.id ?? null;
    } catch (err) {
      this.logTransportFailure('POST', -1, err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  /** PATCH an existing message to reflect the updated occurrence count. */
  private async editExistingMessage(entry: DedupeEntry): Promise<void> {
    const url = this.config.webhookUrl;
    if (!url || !entry.messageId) return;
    try {
      const embed = this.buildEmbed(entry);
      const response = await fetch(`${url}/messages/${entry.messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!response.ok) {
        // Most likely: the original message was deleted by a human. Drop the
        // dedupe entry so the next occurrence posts a fresh message.
        this.dedupeCache.forEach((value, key) => {
          if (value === entry) this.dedupeCache.delete(key);
        });
        this.logTransportFailure('PATCH', response.status, await this.readBodySafe(response));
      }
    } catch (err) {
      this.logTransportFailure('PATCH', -1, err instanceof Error ? err.message : String(err));
    }
  }

  private async readBodySafe(response: Response): Promise<string> {
    try {
      const text = await response.text();
      return text.slice(0, 300);
    } catch {
      return '';
    }
  }

  private logTransportFailure(method: string, status: number, detail: string): void {
    // Route through enhancedLogger (stdout + file), not through our own
    // pipeline — otherwise a broken webhook would self-report and loop.
    enhancedLogger.warn(`[errorReporter] webhook ${method} failed (status=${status}): ${detail}`, LogCategory.ERROR);
  }
}

// Singleton — mirrors the `enhancedLogger` / `healthMonitor` pattern.
export const errorReporter = new ErrorReporter();
