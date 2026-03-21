/**
 * Guild Create Event Handler
 *
 * Handles the bot joining a new guild/server.
 * Sends a welcome message with setup instructions.
 */

import { type Client, EmbedBuilder, type Guild, Routes, type TextChannel } from 'discord.js';
import { commands } from '../commands/commandList';
import { Colors, enhancedLogger, LogCategory, lang } from '../utils';
import { notifyGuildJoin } from '../utils/api/guildWebhook';
import { CLIENT_ID, rest } from '../utils/restClient';

const tl = lang.general.welcome;

export default {
  name: 'guildCreate',
  async execute(guild: Guild, client: Client) {
    try {
      enhancedLogger.info(
        `Joined new guild: ${guild.name} (ID: ${guild.id}) - Members: ${guild.memberCount}`,
        LogCategory.SYSTEM,
      );

      // Register commands for this guild immediately
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guild.id), {
          body: commands,
        });
        enhancedLogger.info(`Registered commands for new guild: ${guild.id}`, LogCategory.SYSTEM);
      } catch (error) {
        enhancedLogger.error(
          `Failed to register commands for guild ${guild.id}: ${(error as Error).message}`,
          undefined,
          LogCategory.SYSTEM,
        );
      }

      // Find a suitable channel to send the welcome message
      const targetChannel = await findWelcomeChannel(guild);

      if (!targetChannel) {
        enhancedLogger.warn(
          `Could not find a suitable channel in guild ${guild.name} to send welcome message`,
          LogCategory.SYSTEM,
        );
        return;
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
        })
        .setTimestamp();

      // Send welcome message
      await targetChannel.send({ embeds: [welcomeEmbed] });
      enhancedLogger.info(
        `Sent welcome message in ${guild.name} (#${targetChannel.name})`,
        LogCategory.SYSTEM,
      );
      // Notify API (fire-and-forget) — skip for dev guild
      if (guild.id !== process.env.DEV_GUILD_ID) {
        // Intentional: fire-and-forget API notification
        notifyGuildJoin(guild.id, guild.name, guild.memberCount).catch(() => {});
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
 * Find the best channel to send the welcome message
 * Priority: system channel > general > first text channel
 *
 * @param guild - Guild to find channel in
 * @returns Text channel or null
 */
async function findWelcomeChannel(guild: Guild): Promise<TextChannel | null> {
  // Try system channel first (where Discord sends join messages)
  if (guild.systemChannel?.isTextBased()) {
    return guild.systemChannel as TextChannel;
  }

  // Try to find a channel named "general"
  const generalChannel = guild.channels.cache.find(
    channel => channel.isTextBased() && (channel.name === 'general' || channel.name === 'chat'),
  ) as TextChannel | undefined;

  if (generalChannel) {
    return generalChannel;
  }

  // Find first text channel the bot can send messages in
  const firstTextChannel = guild.channels.cache.find(channel => {
    if (!channel.isTextBased()) return false;
    const textChannel = channel as TextChannel;
    const permissions = textChannel.permissionsFor(guild.members.me!);
    return permissions?.has(['SendMessages', 'EmbedLinks']);
  }) as TextChannel | undefined;

  return firstTextChannel || null;
}
