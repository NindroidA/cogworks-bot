import type { DMChannel, GuildChannel } from 'discord.js';
import type { ExtendedClient } from '../types/ExtendedClient';
import { enhancedLogger, LogCategory } from '../utils';
import { cleanChannelRefs } from '../utils/cleanup/refCleaners';
import { requestGuildCommandRefresh } from '../utils/setup/commandGating';

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

    await cleanChannelRefs(guildId, channelId, client);

    // A deleted channel may have disabled a gated module (memory config removed,
    // bait auto-disabled) — refresh the picker if the enabled set changed.
    requestGuildCommandRefresh(guildId);
  },
};
