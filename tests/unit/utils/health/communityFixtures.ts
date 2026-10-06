/**
 * Shared fixture for the community feature check suites: a fake guild with one
 * channel or role per case, and a runner for one registered check.
 */
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { LoadedRows } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck } from '../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../src/utils/health/types';
import { FAKE_GUILD_ID, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

export const G = FAKE_GUILD_ID;

export const TEXT = '300000000000000001';
export const NEWS = '300000000000000002';
export const VOICE = '300000000000000003';
export const CATEGORY = '300000000000000004';
/** A text channel where the bot can only view. */
export const LOCKED = '300000000000000005';
export const GONE_CHANNEL = '300000000000000666';

/** ROLE and ROLE_2 sit below the bot's highest role (10), HIGH_ROLE above it. */
export const ROLE = '200000000000000001';
export const ROLE_2 = '200000000000000002';
export const HIGH_ROLE = '200000000000000003';
export const MANAGED_ROLE = '200000000000000004';
export const MUTED_ROLE = '200000000000000005';
export const GONE_ROLE = '200000000000000666';

/** Everything the community features need, except MentionEveryone. */
export const BOT_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageRoles,
];

export function guildInit(overrides: FakeGuildInit = {}): FakeGuildInit {
  return {
    botPermissions: BOT_PERMS,
    channels: [
      { id: TEXT },
      { id: NEWS, type: ChannelType.GuildAnnouncement },
      { id: VOICE, type: ChannelType.GuildVoice },
      { id: CATEGORY, type: ChannelType.GuildCategory },
      { id: LOCKED, botPermissions: [PermissionFlagsBits.ViewChannel] },
    ],
    roles: [
      { id: ROLE, position: 1, mentionable: true },
      { id: ROLE_2, position: 2, mentionable: true },
      { id: HIGH_ROLE, position: 20 },
      { id: MANAGED_ROLE, position: 1, managed: true },
      { id: MUTED_ROLE, position: 1, mentionable: false },
    ],
    ...overrides,
  };
}

/** Runs one registered check through runCheck, so it only sees the entities it declared. */
export async function runOne(
  checkId: string,
  rows: LoadedRows,
  guild: FakeGuildInit = {},
  opts: { deep?: boolean; patch?: (guild: any) => void } = {},
): Promise<HealthFinding[]> {
  const check = getChecks().find(c => c.id === checkId);
  if (!check) throw new Error(`no check ${checkId}`);
  const fake = makeFakeGuild(guildInit(guild));
  opts.patch?.(fake);
  const result = await runCheck(check, makeCheckContext({ guild: fake, rows, deep: opts.deep }));
  return result.findings;
}

export const codes = (findings: HealthFinding[]) => findings.map(f => f.code);
