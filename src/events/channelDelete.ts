import type { Client, DMChannel, GuildChannel } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { AnnouncementConfig } from '../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../typeorm/entities/BaitChannelConfig';
import { MemoryConfig } from '../typeorm/entities/memory';
import { ReactionRoleMenu } from '../typeorm/entities/reactionRole';
import { RulesConfig } from '../typeorm/entities/rules';
import { ArchivedTicketConfig } from '../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { enhancedLogger, LogCategory } from '../utils';
import type { BaitChannelManager } from '../utils/baitChannelManager';
import { invalidateGuildMenuCache } from '../utils/reactionRole/menuCache';
import { invalidateRulesCache } from './rulesReaction';

export default {
  name: 'channelDelete',
  async execute(channel: DMChannel | GuildChannel, client: Client) {
    // Ignore DM channels
    if (!('guild' in channel)) return;

    const guildId = channel.guild.id;
    const channelId = channel.id;

    enhancedLogger.debug('Channel deleted, checking config references', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });

    const results = await Promise.allSettled([
      // TicketConfig — channelId or categoryId
      (async () => {
        const repo = AppDataSource.getRepository(TicketConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config) return;

        let changed = false;
        if (config.channelId === channelId) {
          config.channelId = '';
          config.messageId = '';
          changed = true;
        }
        if (config.categoryId === channelId) {
          config.categoryId = '' as typeof config.categoryId;
          changed = true;
        }
        if (changed) {
          await repo.save(config);
          enhancedLogger.info(
            'Nullified TicketConfig references for deleted channel',
            LogCategory.SYSTEM,
            { guildId, channelId },
          );
        }
      })(),

      // ArchivedTicketConfig — channelId
      (async () => {
        const repo = AppDataSource.getRepository(ArchivedTicketConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || config.channelId !== channelId) return;

        config.channelId = '';
        config.messageId = '';
        await repo.save(config);
        enhancedLogger.info(
          'Nullified ArchivedTicketConfig references for deleted channel',
          LogCategory.SYSTEM,
          { guildId, channelId },
        );
      })(),

      // ApplicationConfig — channelId or categoryId
      (async () => {
        const repo = AppDataSource.getRepository(ApplicationConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config) return;

        let changed = false;
        if (config.channelId === channelId) {
          config.channelId = '';
          config.messageId = '';
          changed = true;
        }
        if (config.categoryId === channelId) {
          config.categoryId = '' as typeof config.categoryId;
          changed = true;
        }
        if (changed) {
          await repo.save(config);
          enhancedLogger.info(
            'Nullified ApplicationConfig references for deleted channel',
            LogCategory.SYSTEM,
            { guildId, channelId },
          );
        }
      })(),

      // ArchivedApplicationConfig — channelId
      (async () => {
        const repo = AppDataSource.getRepository(ArchivedApplicationConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || config.channelId !== channelId) return;

        config.channelId = '';
        config.messageId = '';
        await repo.save(config);
        enhancedLogger.info(
          'Nullified ArchivedApplicationConfig references for deleted channel',
          LogCategory.SYSTEM,
          { guildId, channelId },
        );
      })(),

      // BaitChannelConfig — channelId or logChannelId
      (async () => {
        const repo = AppDataSource.getRepository(BaitChannelConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config) return;

        let changed = false;
        if (config.channelId === channelId) {
          config.enabled = false;
          config.channelId = '' as typeof config.channelId;
          config.channelMessageId = '' as typeof config.channelMessageId;
          changed = true;
        }
        if (config.logChannelId === channelId) {
          config.logChannelId = '' as typeof config.logChannelId;
          config.logChannelMessageId = '' as typeof config.logChannelMessageId;
          changed = true;
        }
        if (changed) {
          await repo.save(config);
          // Clear bait manager cache
          const { baitChannelManager } = client as {
            baitChannelManager?: BaitChannelManager;
          };
          baitChannelManager?.clearConfigCache(guildId);
          enhancedLogger.info('Updated BaitChannelConfig for deleted channel', LogCategory.SYSTEM, {
            guildId,
            channelId,
          });
        }
      })(),

      // RulesConfig — channelId (delete entire record)
      (async () => {
        const repo = AppDataSource.getRepository(RulesConfig);
        const config = await repo.findOneBy({ guildId, channelId });
        if (!config) return;

        await repo.remove(config);
        invalidateRulesCache(guildId);
        enhancedLogger.info('Deleted RulesConfig for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      })(),

      // ReactionRoleMenu — channelId (delete all menus in that channel, CASCADE deletes options)
      (async () => {
        const repo = AppDataSource.getRepository(ReactionRoleMenu);
        const menus = await repo.find({ where: { guildId, channelId } });
        if (menus.length === 0) return;

        await repo.remove(menus);
        invalidateGuildMenuCache(guildId);
        enhancedLogger.info(
          `Deleted ${menus.length} ReactionRoleMenu(s) for deleted channel`,
          LogCategory.SYSTEM,
          { guildId, channelId },
        );
      })(),

      // MemoryConfig — forumChannelId
      (async () => {
        const repo = AppDataSource.getRepository(MemoryConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || config.forumChannelId !== channelId) return;

        config.forumChannelId = '' as typeof config.forumChannelId;
        config.messageId = null;
        await repo.save(config);
        enhancedLogger.info(
          'Nullified MemoryConfig references for deleted channel',
          LogCategory.SYSTEM,
          { guildId, channelId },
        );
      })(),

      // AnnouncementConfig — defaultChannelId
      (async () => {
        const repo = AppDataSource.getRepository(AnnouncementConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config || config.defaultChannelId !== channelId) return;

        config.defaultChannelId = '' as typeof config.defaultChannelId;
        await repo.save(config);
        enhancedLogger.info(
          'Nullified AnnouncementConfig references for deleted channel',
          LogCategory.SYSTEM,
          { guildId, channelId },
        );
      })(),
    ]);

    // Log any failures with entity name for identification
    const entityNames = [
      'TicketConfig',
      'ArchivedTicketConfig',
      'ApplicationConfig',
      'ArchivedApplicationConfig',
      'BaitChannelConfig',
      'RulesConfig',
      'ReactionRoleMenu',
      'MemoryConfig',
      'AnnouncementConfig',
    ];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        enhancedLogger.error(
          `Failed to clean up ${entityNames[i] || 'unknown entity'} for deleted channel`,
          result.reason as Error,
          LogCategory.DATABASE,
          { guildId, channelId },
        );
      }
    }
  },
};
