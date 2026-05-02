/**
 * guildMemberRemove — fires on both intentional leaves and kicks/bans.
 *
 * We do not distinguish here: all exits count toward the daily leaves tally
 * for the analytics snapshot. If future work needs to separate kicks from
 * organic leaves it should live in a dedicated handler fed by audit-log
 * events, not by overloading this one.
 */

import type { GuildMember, PartialGuildMember } from 'discord.js';
import { enhancedLogger, LogCategory } from '../utils';
import { activityTracker } from '../utils/analytics/activityTracker';

export default {
  name: 'guildMemberRemove',
  async execute(member: GuildMember | PartialGuildMember): Promise<void> {
    try {
      if (!member.guild) return;
      // Dev guild skipped to match guildMemberAdd / messageCreate — keeps
      // the dev bot's /insights clean during testing.
      if (process.env.DEV_GUILD_ID && member.guild.id === process.env.DEV_GUILD_ID) return;

      activityTracker.recordMemberLeave(member.guild.id);
    } catch (error) {
      enhancedLogger.error('guildMemberRemove handler failed', error as Error, LogCategory.ERROR);
    }
  },
};
