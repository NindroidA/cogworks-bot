/**
 * Re-proves, right before a repair write, that the Discord object a step
 * relies on is still gone. Only `missing` lets the write go ahead: `ok` means
 * it came back, and `inaccessible`, `unknown` or a spent budget can't prove
 * anything, so the step is skipped unverified.
 */
import type { Guild, GuildBasedChannel } from 'discord.js';
import type { RestFetcher, RestOutcome } from '../context';
import { fetchGuildChannel, type RefStatus, resolveChannel, resolveRole } from '../refs';
import type { RepairProof } from './types';

export type ProofStatus = RefStatus | 'skipped';

/** A channel that may be an uncached (archived) thread: the cache first, then one REST lookup. */
async function lookupChannel(
  guild: Guild,
  id: string,
  rest: RestFetcher,
): Promise<RestOutcome<GuildBasedChannel> | { status: 'ok'; value: GuildBasedChannel }> {
  const cached = resolveChannel(guild, id, { mayBeThread: true });
  if (cached.status === 'ok' || !guild.available) return cached;
  return rest.fetch('repair:channel', () => fetchGuildChannel(guild, id));
}

/**
 * `channel` and `role` read the guild cache, which holds every role and
 * non-thread channel while the guild is available. `thread` falls back to one
 * guild-scoped REST lookup. `message` looks up its channel the same way (a
 * deleted channel took the message with it), then fetches the message.
 */
export async function verifyProof(guild: Guild, proof: RepairProof, rest: RestFetcher): Promise<ProofStatus> {
  switch (proof.kind) {
    case 'role':
      return resolveRole(guild, proof.id).status;
    case 'channel':
      return resolveChannel(guild, proof.id).status;
    case 'thread':
      return (await lookupChannel(guild, proof.id, rest)).status;
    case 'message': {
      if (!proof.channelId) return 'unknown';
      const channel = await lookupChannel(guild, proof.channelId, rest);
      if (channel.status !== 'ok') return channel.status;
      if (!('messages' in channel.value)) return 'unknown';
      const { messages } = channel.value;
      return (await rest.fetch('repair:message', () => messages.fetch({ message: proof.id, cache: false }))).status;
    }
  }
}
