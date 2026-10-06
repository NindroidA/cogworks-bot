/**
 * Builds a health-check `CheckContext` from plain objects: a fake guild plus
 * pre-loaded rows per entity (`null` = that entity failed to load).
 */
import type { Guild } from 'discord.js';
import {
  type CheckContext,
  createRestFetcher,
  type LoadedRows,
  type RestFetcher,
} from '../../src/utils/health/context';
import { makeFakeGuild } from './fakeGuild';

export function makeCheckContext(
  opts: { guild?: Guild; rows?: LoadedRows; deep?: boolean; rest?: RestFetcher } = {},
): CheckContext {
  const guild = opts.guild ?? makeFakeGuild();
  return {
    guildId: guild.id,
    guild,
    me: guild.members.me,
    deep: opts.deep ?? false,
    rest: opts.rest ?? createRestFetcher(),
    rows: opts.rows ?? {},
  };
}
