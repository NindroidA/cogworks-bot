import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  type GuildMember,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  type TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Application } from '../../typeorm/entities/application/Application';
import { ApplicationConfig } from '../../typeorm/entities/application/ApplicationConfig';
import { Position } from '../../typeorm/entities/application/Position';
import { StaffRole } from '../../typeorm/entities/StaffRole';
import {
  createPrivateChannelPermissions,
  createRateLimitKey,
  enhancedLogger,
  escapeDiscordMarkdown,
  extractIdFromMention,
  LogCategory,
  lang,
  PermissionSets,
  RateLimits,
  rateLimiter,
  replyEphemeralError,
} from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';

const tl = lang.application;
const pl = lang.application.position;
const applicationRepo = lazyRepo(Application);
const applicationConfigRepo = lazyRepo(ApplicationConfig);
const positionRepo = lazyRepo(Position);
const staffRoleRepo = lazyRepo(StaffRole);

/**
 * Build and show the application modal for a position.
 * Uses custom fields if configured, otherwise shows a single default field.
 */
async function showApplicationModal(
  interaction: { showModal: (modal: ModalBuilder) => Promise<void> },
  position: Position,
): Promise<void> {
  const positionEmoji = position.emoji || '📝';
  const modalTitle = `${positionEmoji} ${position.title}`.substring(0, 45);

  const modal = new ModalBuilder().setCustomId(`application_modal_${position.id}`).setTitle(modalTitle);

  const customFields = position.customFields;

  if (customFields && customFields.length > 0) {
    for (const field of customFields) {
      const input = new TextInputBuilder()
        .setCustomId(field.id)
        .setLabel(field.label)
        .setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(field.required);

      if (field.placeholder) input.setPlaceholder(field.placeholder);
      if (field.minLength) input.setMinLength(field.minLength);
      if (field.maxLength) input.setMaxLength(field.maxLength);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }
  } else {
    const defaultInput = new TextInputBuilder()
      .setCustomId('default_about')
      .setLabel(pl.modal.defaultField)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000)
      .setPlaceholder('Tell us about yourself and why you want to apply...');

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(defaultInput));
  }

  await interaction.showModal(modal);
}

export const applyButton = async (_client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const positionId = parseInt(interaction.customId.replace('apply_', ''), 10);
  enhancedLogger.debug(`Button: apply_${positionId}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    positionId,
  });

  const position = await positionRepo.findOne({ where: { id: positionId, guildId, isActive: true } });

  if (!position) {
    await replyEphemeralError(interaction, pl.notAvailable);
    return;
  }

  if (position.ageGateEnabled) {
    const ageVerificationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`age_verify_yes_${positionId}`)
        .setLabel(pl.ageVerifyYes)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`age_verify_no_${positionId}`)
        .setLabel(pl.ageVerifyNo)
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({
      content: `🔞 **Age Verification Required**\n\nTo apply for the **${position.title}** position, you must be 18 years or older.\n\nAre you 18 or older?`,
      components: [ageVerificationRow],
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    await showApplicationModal(interaction, position);
  }
};

export const ageVerifyYesButton = async (_client: Client, interaction: ButtonInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const positionId = parseInt(interaction.customId.replace('age_verify_yes_', ''), 10);
  enhancedLogger.debug(`Button: age_verify_yes_${positionId}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    positionId,
  });

  const position = await positionRepo.findOne({ where: { id: positionId, guildId, isActive: true } });

  if (!position) {
    await interaction.update({ content: pl.notAvailable, components: [] });
    return;
  }

  await showApplicationModal(interaction, position);
};

export const ageVerifyNoButton = async (_client: Client, interaction: ButtonInteraction) => {
  const positionId = parseInt(interaction.customId.replace('age_verify_no_', ''), 10);
  enhancedLogger.debug(`Button: age_verify_no_${positionId} (under 18)`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    positionId,
  });

  await interaction.update({ content: pl.ageVerifyNoReply, components: [] });
};

export const cancelApplicationButton = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: cancel_application`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.reply({ content: tl.cancelled, flags: [MessageFlags.Ephemeral] });
};

export const submitApplicationModal = async (_client: Client, interaction: ModalSubmitInteraction) => {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const positionId = parseInt(interaction.customId.replace('application_modal_', ''), 10);
  const member = interaction.member as GuildMember;
  const guild = interaction.guild;
  const appConfig = await applicationConfigRepo.findOneBy({ guildId });
  const category = appConfig?.categoryId;

  enhancedLogger.debug(`Modal submit: application_modal_${positionId}`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId,
    positionId,
  });

  if (!guild) {
    await replyEphemeralError(interaction, lang.general.cmdGuildNotFound);
    return;
  }

  if (!category) {
    await replyEphemeralError(interaction, tl.applicationCategoryNotFound);
    return;
  }

  const position = await positionRepo.findOne({ where: { id: positionId, guildId, isActive: true } });

  if (!position) {
    await replyEphemeralError(interaction, pl.notAvailable);
    return;
  }

  // Check rate limit (2 applications per day per user)
  const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'application-create');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.APPLICATION_CREATE);

  if (!rateCheck.allowed) {
    // rateCheck.message is string | undefined — kept inline (replyEphemeralError takes a string)
    await interaction.reply({ content: rateCheck.message, flags: [MessageFlags.Ephemeral] });
    enhancedLogger.warn(`User hit application creation rate limit`, LogCategory.SECURITY, {
      userId: interaction.user.id,
      guildId,
      positionId,
    });
    return;
  }

  try {
    const customFields = position.customFields;
    const positionEmoji = position.emoji || '📝';

    let headerMsg: string;
    const fieldMessages: string[] = [];

    if (customFields && customFields.length > 0) {
      headerMsg = `## ${positionEmoji} Application for ${position.title}\n\n**Applicant:** ${member.user.tag}`;

      for (const field of customFields) {
        const value = interaction.fields.getTextInputValue(field.id);
        if (field.style === 'paragraph' && value.length > 500) {
          fieldMessages.push(`**${field.label}:**\n${value}`);
        } else {
          const displayValue = field.style === 'short' ? escapeDiscordMarkdown(value) : value;
          fieldMessages.push(`**${field.label}:** ${displayValue}`);
        }
      }
    } else {
      const aboutValue = interaction.fields.getTextInputValue('default_about');
      headerMsg = `## ${positionEmoji} Application for ${position.title}\n\n**Applicant:** ${member.user.tag}`;
      fieldMessages.push(`**About:**\n${aboutValue}`);
    }

    const newApplication = applicationRepo.create({
      guildId,
      createdBy: interaction.user.id,
      type: `position_${positionId}`,
    });
    const savedApplication = await applicationRepo.save(newApplication);

    const channelName = `${savedApplication.id}-${position.title.toLowerCase().replace(/\s+/g, '-')}-${member.user.username}`;

    const rolePerms = await staffRoleRepo
      .createQueryBuilder()
      .select(['role'])
      .where('guildId = :guildId', { guildId })
      .andWhere('type = :type', { type: 'admin' })
      .getRawMany();

    const adminRoleIds = rolePerms
      .map(role => extractIdFromMention(role.role))
      .filter((id): id is string => {
        if (!id) {
          enhancedLogger.warn(`Invalid role format encountered`, LogCategory.COMMAND_EXECUTION, { guildId });
          return false;
        }
        return true;
      });

    const permOverwrites = createPrivateChannelPermissions(
      guildId,
      [member.id],
      adminRoleIds,
      PermissionSets.APPLICATION_CREATOR,
    );

    const channel = await guild.channels.create({
      name: channelName,
      type: 0,
      parent: category,
      permissionOverwrites: permOverwrites,
    });

    await interaction.reply({
      content: `✅ Your application has been submitted! Please check ${channel} for updates.`,
      flags: [MessageFlags.Ephemeral],
    });

    const welcomeMsg = `👋 Welcome, ${member.user.displayName}! Your application for **${position.title}** has been received.\n\n Our team will review your application and get back to you soon. Feel free to ask any questions here!\n`;

    const buttonOptions = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder()
        .setCustomId('close_application')
        .setLabel('Close Application')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
    );

    const newChannel = channel as TextChannel;

    const welcome = await newChannel.send({
      content: welcomeMsg,
      components: [buttonOptions],
    });

    await newChannel.send({ content: headerMsg });

    for (const msg of fieldMessages) {
      await newChannel.send({ content: msg });
    }

    await applicationRepo.update(
      { id: savedApplication.id, guildId },
      {
        messageId: welcome.id,
        channelId: newChannel.id,
        status: 'opened',
      },
    );

    enhancedLogger.info(
      `Application created: #${savedApplication.id} for position ${positionId}`,
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        applicationId: savedApplication.id,
        positionId,
        channelId: newChannel.id,
      },
    );
  } catch (error) {
    enhancedLogger.error(
      'Failed to create application',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        positionId,
      },
    );

    if (!interaction.replied && !interaction.deferred) {
      await replyEphemeralError(interaction, tl.failCreate);
    }
  }
};
