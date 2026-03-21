import type { GuildMember } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { BaitChannelConfig } from '../typeorm/entities/BaitChannelConfig';
import { JoinEvent } from '../typeorm/entities/bait/JoinEvent';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';

export default {
  name: 'guildMemberAdd',
  async execute(member: GuildMember, client: ExtendedClient) {
    const extClient = client;

    // Only track joins for guilds with bait channel enabled
    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    let config: BaitChannelConfig | null;
    try {
      config = await configRepo.findOne({
        where: { guildId: member.guild.id },
      });
    } catch {
      return; // DB error — skip silently
    }

    if (!config?.enabled) return;

    // Skip join tracking for dev guild to avoid polluting analytics
    if (process.env.DEV_GUILD_ID && member.guild.id === process.env.DEV_GUILD_ID) return;

    // Record in-memory for burst detection
    if (extClient.joinVelocityTracker) {
      extClient.joinVelocityTracker.recordJoin(member.guild.id);
    }

    // Record persistent JoinEvent for analytics and repeat offender detection
    try {
      const joinEventRepo = AppDataSource.getRepository(JoinEvent);
      await joinEventRepo.save(
        joinEventRepo.create({
          guildId: member.guild.id,
          userId: member.id,
          joinedAt: member.joinedAt || new Date(),
          accountCreatedAt: member.user.createdAt,
          hasDefaultAvatar: member.user.avatar === null,
          roleCount: member.roles.cache.size,
        }),
      );
    } catch (error) {
      enhancedLogger.debug(
        `Failed to record JoinEvent for ${member.user.tag} in ${member.guild.id}`,
        LogCategory.DATABASE,
        { error: (error as Error).message },
      );
    }
  },
};
