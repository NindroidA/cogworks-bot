import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { invalidateRulesCache } from '../../events/rulesReaction';
import { AppDataSource } from '../../typeorm';
import { RulesConfig } from '../../typeorm/entities/rules';
import {
  Colors,
  cleanupOldMessage,
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
  truncateWithNotice,
  validateEmoji,
} from '../../utils';

const tl = lang.rules;
const rulesConfigRepo = AppDataSource.getRepository(RulesConfig);

export const rulesSetupHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'setup':
      await handleSetup(client, interaction);
      break;
    case 'view':
      await handleView(interaction);
      break;
    case 'remove':
      await handleRemove(client, interaction);
      break;
  }
};

async function handleSetup(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId || '';

  // Rate limit check (5 setup operations per hour per guild)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'rules-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.info('Rate limit exceeded for rules setup', LogCategory.SECURITY, { guildId });
    return;
  }

  const channel = interaction.options.getChannel('channel', true) as TextChannel;
  const role = interaction.options.getRole('role', true);
  const customMessage = interaction.options.getString('message') || null;
  const emoji = interaction.options.getString('emoji') || '✅';

  // Defer reply — setup involves DB writes and Discord API calls
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  // Validate emoji format
  const emojiCheck = validateEmoji(emoji);
  if (!emojiCheck.valid) {
    await interaction.editReply({
      content: tl.setup.invalidEmoji,
    });
    return;
  }

  const guild = interaction.guild;
  if (!guild) return;

  // Validate role is not @everyone
  if (role.id === guild.id) {
    await interaction.editReply({
      content: tl.setup.cannotUseEveryone,
    });
    return;
  }

  // Validate role is not managed (bot role, integration role)
  if (role.managed) {
    await interaction.editReply({
      content: tl.setup.cannotUseManagedRole,
    });
    return;
  }

  // Validate bot can assign the role (role position check)
  const botMember = await guild.members.fetchMe();
  if (role.position >= botMember.roles.highest.position) {
    await interaction.editReply({
      content: tl.setup.roleTooHigh,
    });
    return;
  }

  try {
    // Build the rules message
    const messageText =
      customMessage ||
      tl.setup.defaultMessage.replace('{emoji}', emoji).replace('{roleName}', role.name);

    // Check for existing config — clean up old message if reconfiguring
    const existingConfig = await rulesConfigRepo.findOneBy({ guildId });
    if (existingConfig?.messageId) {
      await cleanupOldMessage(guild, existingConfig.channelId, existingConfig.messageId);
    }

    // Send the rules message
    const rulesMessage = await channel.send({ content: messageText });

    // Add the reaction
    await rulesMessage.react(emoji);

    // Save or update config
    if (existingConfig) {
      existingConfig.channelId = channel.id;
      existingConfig.messageId = rulesMessage.id;
      existingConfig.roleId = role.id;
      existingConfig.emoji = emoji;
      existingConfig.customMessage = customMessage;
      await rulesConfigRepo.save(existingConfig);
    } else {
      const config = rulesConfigRepo.create({
        guildId,
        channelId: channel.id,
        messageId: rulesMessage.id,
        roleId: role.id,
        emoji,
        customMessage,
      });
      await rulesConfigRepo.save(config);
    }

    // Invalidate cache so reaction handler picks up new config
    invalidateRulesCache(guildId);

    const isUpdate = !!existingConfig;
    await interaction.editReply({
      content: `${isUpdate ? tl.setup.updated : tl.setup.success}\n• Channel: ${channel}\n• Role: ${role}\n• Emoji: ${emoji}`,
    });

    enhancedLogger.info(
      `Rules acknowledgment ${isUpdate ? 'updated' : 'configured'}`,
      LogCategory.COMMAND_EXECUTION,
      {
        guildId,
        channelId: channel.id,
        roleId: role.id,
        emoji,
        userId: interaction.user.id,
      },
    );
  } catch (error) {
    enhancedLogger.error(
      'Failed to configure rules acknowledgment',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.editReply({
      content: tl.setup.error,
    });
  }
}

async function handleView(interaction: ChatInputCommandInteraction<CacheType>) {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId || '';

  const config = await rulesConfigRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: tl.view.notConfigured,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(tl.view.title)
    .setColor(Colors.status.info)
    .addFields(
      { name: tl.view.channel, value: `<#${config.channelId}>`, inline: true },
      { name: tl.view.role, value: `<@&${config.roleId}>`, inline: true },
      { name: tl.view.emoji, value: config.emoji, inline: true },
      {
        name: tl.view.customMessage,
        value: config.customMessage
          ? truncateWithNotice(config.customMessage, 1024)
          : tl.view.defaultLabel,
        inline: false,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

async function handleRemove(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId || '';
  const guild = interaction.guild;
  if (!guild) return;

  const config = await rulesConfigRepo.findOneBy({ guildId });
  if (!config) {
    await interaction.reply({
      content: tl.remove.notConfigured,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    // Try to delete the rules message
    const messageDeleted = await cleanupOldMessage(guild, config.channelId, config.messageId);

    // Remove config from database
    await rulesConfigRepo.remove(config);

    // Invalidate cache
    invalidateRulesCache(guildId);

    await interaction.reply({
      content: messageDeleted ? tl.remove.success : tl.remove.messageDeleteFailed,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Rules acknowledgment removed', LogCategory.COMMAND_EXECUTION, {
      guildId,
      userId: interaction.user.id,
    });
  } catch (error) {
    enhancedLogger.error(
      'Failed to remove rules config',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.remove.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}
