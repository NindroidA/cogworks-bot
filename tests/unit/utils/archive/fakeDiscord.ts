/**
 * Hand-rolled discord.js + repository fakes shared by the export-then-delete
 * tests (transcript capture, /archive cleanup, /bot-reset cleanup).
 */

export const GUILD = '100000000000000001';

export function apiError(code: number): Error {
  return Object.assign(new Error(`Discord API error ${code}`), { code });
}

function makeMsg(id: string, content: string): any {
  return {
    id,
    author: { username: 'alice', id: '111', bot: false },
    content,
    cleanContent: content,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    attachments: new Map(),
    embeds: [],
    stickers: new Map(),
    poll: null,
    reference: undefined,
    system: false,
    components: [],
  };
}

export interface FakeChannel {
  id: string;
  guildId: string;
  name: string;
  parentId: string | null;
  deleted: boolean;
  /** Single messages deleted via messages.fetch(id), as the bot-message sweep does. */
  deletedMessageIds: string[];
  lastMessageId: string | null;
  isTextBased: () => boolean;
  isThread: () => boolean;
  messages: { fetch: (arg?: unknown) => Promise<unknown> };
  /** Post a new message, as a ticket close appending to an existing archive thread does. */
  post: (text: string) => void;
  delete: () => Promise<void>;
}

/** A text channel/thread (a thread when `parentId` is set) holding `texts`. `deleteError` makes delete() throw that code. */
export function makeChannel(
  id: string,
  texts: string[] = [],
  opts: { guildId?: string; parentId?: string; deleteError?: number; readError?: number } = {},
): FakeChannel {
  let served = false;
  const messages = texts.map((t, i) => makeMsg(`${id}-m${i}`, t)).reverse(); // newest-first, like Discord
  const channel: FakeChannel = {
    id,
    guildId: opts.guildId ?? GUILD,
    name: `channel-${id}`,
    parentId: opts.parentId ?? null,
    deleted: false,
    deletedMessageIds: [],
    lastMessageId: messages[0]?.id ?? null,
    isTextBased: () => true,
    isThread: () => !!opts.parentId,
    messages: {
      fetch: async (arg?: unknown) => {
        if (opts.readError) throw apiError(opts.readError);
        if (typeof arg === 'string') return { id: arg, delete: async () => void channel.deletedMessageIds.push(arg) };
        const batch = served ? [] : messages;
        served = true;
        return { size: batch.length, values: () => batch.values(), last: () => batch[batch.length - 1] };
      },
    },
    post: text => {
      const msg = makeMsg(`${id}-m${messages.length}`, text);
      messages.unshift(msg);
      channel.lastMessageId = msg.id;
    },
    delete: async () => {
      if (opts.deleteError) throw apiError(opts.deleteError);
      channel.deleted = true;
    },
  };
  return channel;
}

/**
 * Client whose channels.fetch serves `channels`; unknown IDs throw 10003, Error values are thrown as-is.
 * Without `botId`, messageCleanup's phase 3 (bot-message sweep) is skipped; with it, the guild
 * message search returns `searchHits` (message id + channel_id) once.
 */
export function makeClient(
  channels: Record<string, FakeChannel | Error>,
  opts: { botId?: string; searchHits?: Array<{ id: string; channel_id: string }> } = {},
): any {
  return {
    user: opts.botId ? { id: opts.botId } : undefined,
    rest: {
      get: async (route: string) => ({
        messages: route.includes('offset=0') ? (opts.searchHits ?? []).map(h => [h]) : [],
      }),
    },
    guilds: { cache: new Map() },
    channels: {
      fetch: async (id: string) => {
        const channel = channels[id];
        if (channel instanceof Error) throw channel;
        if (!channel) throw apiError(10003);
        return channel;
      },
    },
  };
}

/** Values of a TypeORM `In([...])` / `Not(x)` operator, or the plain value. */
function operatorValue(value: any): any {
  return value && typeof value === 'object' && '_type' in value ? value._value : value;
}

function matches(row: Record<string, any>, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '_type' in expected) {
      if (expected._type === 'in') return (expected._value as unknown[]).includes(row[key]);
      if (expected._type === 'isNull') return row[key] == null;
      if (expected._type === 'not') {
        const inner = operatorValue(expected._value);
        return inner && typeof inner === 'object' && inner._type === 'isNull' ? row[key] != null : row[key] !== inner;
      }
      return true;
    }
    return row[key] === expected;
  });
}

export interface FakeRepo {
  rows: Record<string, any>[];
  deletedWhere: Record<string, any>[];
  find: (opts?: { where?: Record<string, any> }) => Promise<any[]>;
  findOneBy: (where: Record<string, any>) => Promise<any | null>;
  delete: (where: Record<string, any>) => Promise<{ affected: number }>;
}

/** In-memory repository understanding the where-clauses these flows use (equality, In, Not, Not(IsNull)). */
export function makeRepo(rows: Record<string, any>[] = []): FakeRepo {
  const repo: FakeRepo = {
    rows,
    deletedWhere: [],
    find: async opts => repo.rows.filter(r => matches(r, opts?.where)).map(r => ({ ...r })), // copies, like TypeORM
    findOneBy: async where => repo.rows.find(r => matches(r, where)) ?? null,
    delete: async where => {
      repo.deletedWhere.push(where);
      const before = repo.rows.length;
      repo.rows = repo.rows.filter(r => !matches(r, where));
      return { affected: before - repo.rows.length };
    },
  };
  return repo;
}

type GetRepository = (entity: any) => unknown;

/** Route AppDataSource.getRepository by entity class name; returns a restore function. */
export async function patchRepositories(repos: () => Record<string, FakeRepo>): Promise<() => void> {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: GetRepository };
  const original = ds.getRepository;
  ds.getRepository = (entity: any) => repos()[entity?.name] ?? makeRepo();
  return () => {
    ds.getRepository = original;
  };
}
