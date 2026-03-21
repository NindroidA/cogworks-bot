/**
 * Onboarding Join Event
 *
 * Listens to guildMemberAdd events to send the interactive onboarding
 * flow to new members via DM when onboarding is enabled for the guild.
 */

import type { GuildMember } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { sendOnboardingFlow } from '../utils/onboarding/onboardingEngine';

export default {
  name: 'guildMemberAdd',
  async execute(member: GuildMember, _client: ExtendedClient) {
    // Skip bots
    if (member.user.bot) return;

    // Skip dev guild to avoid polluting analytics
    if (process.env.DEV_GUILD_ID && member.guild.id === process.env.DEV_GUILD_ID) return;

    try {
      const sent = await sendOnboardingFlow(member);
      if (sent) {
        enhancedLogger.debug(
          `Onboarding flow sent to ${member.user.tag} in ${member.guild.name}`,
          LogCategory.SYSTEM,
          { guildId: member.guild.id },
        );
      }
    } catch (error) {
      enhancedLogger.error(
        `Failed to send onboarding flow to ${member.user.tag}`,
        error as Error,
        LogCategory.SYSTEM,
        { guildId: member.guild.id },
      );
    }
  },
};
