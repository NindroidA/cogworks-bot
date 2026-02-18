import type { Client, Message, PartialMessage } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { ApplicationConfig } from '../typeorm/entities/application/ApplicationConfig';
import { BaitChannelConfig } from '../typeorm/entities/BaitChannelConfig';
import { ReactionRoleMenu } from '../typeorm/entities/reactionRole';
import { RulesConfig } from '../typeorm/entities/rules';
import { TicketConfig } from '../typeorm/entities/ticket/TicketConfig';
import { enhancedLogger, LogCategory } from '../utils';
import type { BaitChannelManager } from '../utils/baitChannelManager';
import { invalidateMenuCache } from '../utils/reactionRole/menuCache';
import { invalidateRulesCache } from './rulesReaction';

export default {
  name: 'messageDelete',
  async execute(message: Message | PartialMessage, client: Client) {
    if (!message.guild) return;

    const guildId = message.guild.id;
    const messageId = message.id;

    // Performance guard: only bot-authored messages can be tracked config messages.
    // If author is known and is NOT the bot, skip all DB queries.
    // If author is null (partial message), we still need to check DB.
    if (message.author && message.author.id !== client.user?.id) return;

    // Bait channel manager check (existing behavior)
    const { baitChannelManager } = client as {
      baitChannelManager?: BaitChannelManager;
    };
    if (baitChannelManager) {
      await baitChannelManager.handleMessageDelete(messageId, guildId);
    }

    // Check all config entities for tracked bot messages
    const results = await Promise.allSettled([
      // TicketConfig — messageId
      (async () => {
        const repo = AppDataSource.getRepository(TicketConfig);
        const config = await repo.findOneBy({ guildId, messageId });
        if (!config) return;

        config.messageId = '';
        await repo.save(config);
        enhancedLogger.info(
          'Cleared TicketConfig messageId for deleted message',
          LogCategory.SYSTEM,
          { guildId, messageId },
        );
      })(),

      // ApplicationConfig — messageId
      (async () => {
        const repo = AppDataSource.getRepository(ApplicationConfig);
        const config = await repo.findOneBy({ guildId, messageId });
        if (!config) return;

        config.messageId = '';
        await repo.save(config);
        enhancedLogger.info(
          'Cleared ApplicationConfig messageId for deleted message',
          LogCategory.SYSTEM,
          { guildId, messageId },
        );
      })(),

      // BaitChannelConfig — channelMessageId or logChannelMessageId
      (async () => {
        const repo = AppDataSource.getRepository(BaitChannelConfig);
        const config = await repo.findOneBy({ guildId });
        if (!config) return;

        let changed = false;
        if (config.channelMessageId === messageId) {
          config.channelMessageId = '' as typeof config.channelMessageId;
          changed = true;
        }
        if (config.logChannelMessageId === messageId) {
          config.logChannelMessageId = '' as typeof config.logChannelMessageId;
          changed = true;
        }
        if (changed) {
          await repo.save(config);
          enhancedLogger.info(
            'Cleared BaitChannelConfig message references for deleted message',
            LogCategory.SYSTEM,
            { guildId, messageId },
          );
        }
      })(),

      // RulesConfig — messageId (delete entire record)
      (async () => {
        const repo = AppDataSource.getRepository(RulesConfig);
        const config = await repo.findOneBy({ guildId, messageId });
        if (!config) return;

        await repo.remove(config);
        invalidateRulesCache(guildId);
        enhancedLogger.info('Deleted RulesConfig for deleted message', LogCategory.SYSTEM, {
          guildId,
          messageId,
        });
      })(),

      // ReactionRoleMenu — messageId (delete menu + CASCADE options)
      (async () => {
        const repo = AppDataSource.getRepository(ReactionRoleMenu);
        const menu = await repo.findOneBy({ guildId, messageId });
        if (!menu) return;

        invalidateMenuCache(messageId);
        await repo.remove(menu);
        enhancedLogger.info('Deleted ReactionRoleMenu for deleted message', LogCategory.SYSTEM, {
          guildId,
          messageId,
        });
      })(),
    ]);

    // Log any failures with entity name for identification
    const entityNames = [
      'TicketConfig',
      'ApplicationConfig',
      'BaitChannelConfig',
      'RulesConfig',
      'ReactionRoleMenu',
    ];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        enhancedLogger.error(
          `Failed to clean up ${entityNames[i] || 'unknown entity'} for deleted message`,
          result.reason as Error,
          LogCategory.DATABASE,
          { guildId, messageId },
        );
      }
    }
  },
};
