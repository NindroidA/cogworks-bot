/**
 * Guild Create Event Handler
 *
 * Handles the bot joining a new guild/server.
 * Sends a welcome message with setup instructions.
 */

import {
  ChannelType,
  type Client,
  EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
  type MessageCreateOptions,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js';
import { Colors, enhancedLogger, LogCategory, lang } from '../utils';
import { notifyGuildJoin } from '../utils/api/guildWebhook';
import { registerGuildCommands } from '../utils/setup/commandGating';

const tl = lang.general.welcome;

/** How many writable channels the welcome tries before giving up. */
const MAX_WELCOME_ATTEMPTS = 5;

/** Injectable seam for tests; production callers omit it. */
export interface GuildCreateDeps {
  registerGuildCommands: typeof registerGuildCommands;
  notifyGuildJoin: typeof notifyGuildJoin;
}

export default {
  name: 'guildCreate',
  async execute(guild: Guild, client: Client, deps: GuildCreateDeps = { registerGuildCommands, notifyGuildJoin }) {
    try {
      enhancedLogger.info(
        `Joined new guild: ${guild.name} (ID: ${guild.id}) - Members: ${guild.memberCount}`,
        LogCategory.SYSTEM,
      );

      // Notify API first (fire-and-forget) so the join is recorded whatever
      // happens to the welcome below. Skipped for the dev guild.
      if (guild.id !== process.env.DEV_GUILD_ID) {
        deps.notifyGuildJoin(guild.id, guild.name, guild.memberCount).catch(() => {});
      }

      // Register commands for this guild immediately
      try {
        // Filtered to the guild's enabled modules (on join, none → only always-visible commands)
        await deps.registerGuildCommands(guild.id);
        enhancedLogger.info(`Registered commands for new guild: ${guild.id}`, LogCategory.SYSTEM);
      } catch (error) {
        enhancedLogger.error(
          `Failed to register commands for guild ${guild.id}: ${(error as Error).message}`,
          undefined,
          LogCategory.SYSTEM,
        );
      }

      // Create welcome embed
      const welcomeEmbed = new EmbedBuilder()
        .setColor(Colors.brand.primary)
        .setTitle(tl.title)
        .setDescription(tl.description)
        .addFields(
          {
            name: tl.features.title,
            value: tl.features.value,
            inline: false,
          },
          {
            name: tl.quickStart.title,
            value: tl.quickStart.value,
            inline: false,
          },
          {
            name: tl.commands.title,
            value: tl.commands.value,
            inline: false,
          },
          {
            name: tl.privacy.title,
            value: tl.privacy.value,
            inline: false,
          },
          {
            name: tl.needHelp.title,
            value: tl.needHelp.value,
            inline: false,
          },
        )
        .setFooter({
          text: tl.footer.replace('{0}', client.guilds.cache.size.toString()),
          iconURL: client.user?.displayAvatarURL(),
        });

      const sentIn = await sendWelcome(guild, { embeds: [welcomeEmbed] });
      if (sentIn) {
        enhancedLogger.info(`Sent welcome message in ${guild.name} (#${sentIn.name})`, LogCategory.SYSTEM);
      } else {
        enhancedLogger.warn(`Could not post the welcome message anywhere in guild ${guild.name}`, LogCategory.SYSTEM);
      }
    } catch (error) {
      enhancedLogger.error(
        `Error handling guild create for ${guild.name}: ${(error as Error).message}`,
        undefined,
        LogCategory.SYSTEM,
      );
    }
  },
};

/**
 * Text channels the bot can post the welcome in, best first: the system
 * channel, then #general / #chat, then the rest. Servers often lock the
 * system channel, so every candidate is checked for the bot's permissions.
 */
export function welcomeCandidates(guild: Guild): TextChannel[] {
  const me = guild.members.me;
  if (!me) return [];
  const { ViewChannel, SendMessages, EmbedLinks } = PermissionFlagsBits;
  const writable = (channel: GuildBasedChannel | null | undefined): channel is TextChannel =>
    channel?.type === ChannelType.GuildText &&
    !!channel.permissionsFor(me)?.has([ViewChannel, SendMessages, EmbedLinks]);

  const text = [...guild.channels.cache.values()].filter(writable);
  const named = text.filter(channel => channel.name === 'general' || channel.name === 'chat');
  const system = writable(guild.systemChannel) ? [guild.systemChannel] : [];
  return [...new Set([...system, ...named, ...text])];
}

/** Post to the first candidate that accepts the message. Returns that channel, or null. */
export async function sendWelcome(guild: Guild, payload: MessageCreateOptions): Promise<TextChannel | null> {
  for (const channel of welcomeCandidates(guild).slice(0, MAX_WELCOME_ATTEMPTS)) {
    try {
      await channel.send(payload);
      return channel;
    } catch (error) {
      enhancedLogger.warn(`Welcome message failed in #${channel.name}, trying the next channel`, LogCategory.SYSTEM, {
        guildId: guild.id,
        error: (error as Error).message,
      });
    }
  }
  return null;
}
