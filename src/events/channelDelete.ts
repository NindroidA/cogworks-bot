import type { DMChannel, GuildChannel } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { AnalyticsConfig } from '../typeorm/entities/analytics/AnalyticsConfig';
import { AnnouncementConfig } from '../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../typeorm/entities/bait/BaitChannelConfig';
import { EventConfig } from '../typeorm/entities/event/EventConfig';
import { MemoryConfig } from '../typeorm/entities/memory';
import { ReactionRoleMenu } from '../typeorm/entities/reactionRole';
import { RulesConfig } from '../typeorm/entities/rules';
import { StarboardConfig } from '../typeorm/entities/starboard';
import { ArchivedTicketConfig } from '../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { XPConfig } from '../typeorm/entities/xp/XPConfig';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { invalidateGuildMenuCache } from '../utils/reactionRole/menuCache';
import { invalidateRulesCache } from '../utils/rules/rulesCache';
import { requestGuildCommandRefresh } from '../utils/setup/commandGating';
import { invalidateStarboardCache } from './starboardReaction';

interface ChannelRefCleaner {
  /** Entity name for failure attribution in error logs. */
  name: string;
  /** Per-entity cleanup. Mutate config and persist on change; the descriptor's
   * name field is used for failure attribution if this throws. */
  clean: (guildId: string, channelId: string, client: ExtendedClient) => Promise<void>;
}

const CHANNEL_REF_CLEANERS: ChannelRefCleaner[] = [
  {
    name: 'TicketConfig',
    clean: async (guildId, channelId) => {
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
        config.categoryId = null;
        changed = true;
      }
      if (config.slaBreachChannelId === channelId) {
        config.slaBreachChannelId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Nullified TicketConfig references for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'ArchivedTicketConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ArchivedTicketConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.channelId !== channelId) return;

      config.channelId = '';
      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Nullified ArchivedTicketConfig references for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'ApplicationConfig',
    clean: async (guildId, channelId) => {
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
        config.categoryId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Nullified ApplicationConfig references for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'ArchivedApplicationConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ArchivedApplicationConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.channelId !== channelId) return;

      config.channelId = '';
      config.messageId = '';
      await repo.save(config);
      enhancedLogger.info('Nullified ArchivedApplicationConfig references for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'BaitChannelConfig',
    clean: async (guildId, channelId, client) => {
      const repo = AppDataSource.getRepository(BaitChannelConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.channelId === channelId) {
        config.enabled = false;
        config.channelId = '';
        config.channelMessageId = null;
        changed = true;
      }
      if (config.channelIds?.includes(channelId)) {
        config.channelIds = config.channelIds.filter(id => id !== channelId);
        changed = true;
      }
      if (config.logChannelId === channelId) {
        config.logChannelId = null;
        config.logChannelMessageId = null;
        changed = true;
      }
      if (config.summaryChannelId === channelId) {
        config.summaryChannelId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        client.baitChannelManager?.clearConfigCache(guildId);
        enhancedLogger.info('Updated BaitChannelConfig for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'RulesConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(RulesConfig);
      const config = await repo.findOneBy({ guildId, channelId });
      if (!config) return;

      await repo.remove(config);
      invalidateRulesCache(guildId);
      enhancedLogger.info('Deleted RulesConfig for deleted channel', LogCategory.SYSTEM, { guildId, channelId });
    },
  },
  {
    name: 'ReactionRoleMenu',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(ReactionRoleMenu);
      const menus = await repo.find({ where: { guildId, channelId } });
      if (menus.length === 0) return;

      await repo.remove(menus);
      invalidateGuildMenuCache(guildId);
      enhancedLogger.info(`Deleted ${menus.length} ReactionRoleMenu(s) for deleted channel`, LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'MemoryConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(MemoryConfig);
      const configs = await repo.find({ where: { guildId } });
      const match = configs.find(c => c.forumChannelId === channelId);
      if (!match) return;

      await repo.remove(match);
      enhancedLogger.info('Deleted MemoryConfig for deleted forum channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'AnnouncementConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(AnnouncementConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.defaultChannelId !== channelId) return;

      config.defaultChannelId = '';
      await repo.save(config);
      enhancedLogger.info('Nullified AnnouncementConfig references for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
  {
    name: 'StarboardConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(StarboardConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.channelId === channelId) {
        config.enabled = false;
        config.channelId = '';
        changed = true;
      }
      if (config.ignoredChannels?.includes(channelId)) {
        config.ignoredChannels = config.ignoredChannels.filter(id => id !== channelId);
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        invalidateStarboardCache(guildId);
        enhancedLogger.info('Updated StarboardConfig for deleted channel', LogCategory.SYSTEM, {
          guildId,
          channelId,
        });
      }
    },
  },
  {
    name: 'XPConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(XPConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.levelUpChannelId === channelId) {
        config.levelUpChannelId = null;
        changed = true;
      }
      if (config.ignoredChannels?.includes(channelId)) {
        config.ignoredChannels = config.ignoredChannels.filter(id => id !== channelId);
        changed = true;
      }
      if (config.multiplierChannels?.[channelId] !== undefined) {
        const { [channelId]: _, ...rest } = config.multiplierChannels;
        config.multiplierChannels = Object.keys(rest).length > 0 ? rest : null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Updated XPConfig for deleted channel', LogCategory.SYSTEM, { guildId, channelId });
      }
    },
  },
  {
    name: 'EventConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(EventConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config) return;

      let changed = false;
      if (config.reminderChannelId === channelId) {
        config.reminderChannelId = null;
        changed = true;
      }
      if (config.summaryChannelId === channelId) {
        config.summaryChannelId = null;
        changed = true;
      }
      if (changed) {
        await repo.save(config);
        enhancedLogger.info('Updated EventConfig for deleted channel', LogCategory.SYSTEM, { guildId, channelId });
      }
    },
  },
  {
    name: 'AnalyticsConfig',
    clean: async (guildId, channelId) => {
      const repo = AppDataSource.getRepository(AnalyticsConfig);
      const config = await repo.findOneBy({ guildId });
      if (!config || config.digestChannelId !== channelId) return;

      config.digestChannelId = null;
      await repo.save(config);
      enhancedLogger.info('Nullified AnalyticsConfig digestChannelId for deleted channel', LogCategory.SYSTEM, {
        guildId,
        channelId,
      });
    },
  },
];

export default {
  name: 'channelDelete',
  async execute(channel: DMChannel | GuildChannel, client: ExtendedClient) {
    if (!('guild' in channel)) return;

    const guildId = channel.guild.id;
    const channelId = channel.id;

    enhancedLogger.debug('Channel deleted, checking config references', LogCategory.SYSTEM, {
      guildId,
      channelId,
    });

    const results = await Promise.allSettled(CHANNEL_REF_CLEANERS.map(c => c.clean(guildId, channelId, client)));

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        enhancedLogger.error(
          `Failed to clean up ${CHANNEL_REF_CLEANERS[i].name} for deleted channel`,
          r.reason as Error,
          LogCategory.DATABASE,
          { guildId, channelId },
        );
      }
    });

    // A deleted channel may have disabled a gated module (memory config removed,
    // bait auto-disabled) — refresh the picker if the enabled set changed.
    requestGuildCommandRefresh(guildId);
  },
};
