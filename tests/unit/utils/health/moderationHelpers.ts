/**
 * Shared setup for the moderation health-check suites (rules, reaction roles,
 * memory): run one registered check against a fake guild, and give fake
 * channels and guilds the REST lookups deep mode uses.
 */
import { type Guild, PermissionFlagsBits } from 'discord.js';
import type { LoadedRows } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck } from '../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../src/utils/health/types';
import { FAKE_GUILD_ID, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

export const G = FAKE_GUILD_ID;
export const ADMIN_BOT: FakeGuildInit = { botPermissions: [PermissionFlagsBits.Administrator] };

/** A Discord REST error with a JSON error code, as `classifyRestError` reads it. */
export const restError = (code: number) => Object.assign(new Error(`rest ${code}`), { code });

/** Runs one registered check through runCheck, so it only sees the entities it declared. */
export async function runChecks(
  checkId: string,
  rows: LoadedRows,
  guild: Guild | FakeGuildInit = ADMIN_BOT,
  opts: { deep?: boolean } = {},
): Promise<HealthFinding[]> {
  const check = getChecks().find(c => c.id === checkId);
  if (!check) throw new Error(`no check ${checkId}`);
  const fake = 'channels' in guild && 'roles' in guild && 'members' in guild ? (guild as Guild) : makeFakeGuild(guild);
  const ctx = makeCheckContext({ guild: fake, rows, deep: opts.deep });
  return (await runCheck(check, ctx)).findings;
}

export const codes = (findings: HealthFinding[]) => findings.map(f => f.code);

/** Gives a fake channel `messages.fetch`: listed ids exist, others are Unknown Message (10008). */
export function withMessages(guild: Guild, channelId: string, existing: string[]): string[] {
  const fetched: string[] = [];
  const channel = guild.channels.cache.get(channelId) as unknown as Record<string, unknown>;
  channel.messages = {
    fetch: async ({ message }: { message: string }) => {
      fetched.push(message);
      if (existing.includes(message)) return { id: message };
      throw restError(10008);
    },
  };
  return fetched;
}

/** Gives a fake guild `channels.fetch` for uncached threads: listed ids exist, others are Unknown Channel (10003). */
export function withThreadFetch(guild: Guild, existing: string[]): string[] {
  const fetched: string[] = [];
  (guild.channels as unknown as Record<string, unknown>).fetch = async (id: string) => {
    fetched.push(id);
    if (existing.includes(id)) return { id };
    throw restError(10003);
  };
  return fetched;
}
