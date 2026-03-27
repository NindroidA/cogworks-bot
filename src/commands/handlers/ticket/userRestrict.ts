import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type User,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { UserTicketRestriction } from '../../../typeorm/entities/ticket/UserTicketRestriction';
import {
  enhancedLogger,
  handleInteractionError,
  LogCategory,
  lang,
  notifyModalTimeout,
  requireAdmin,
} from '../../../utils';
import { checkboxGroup, labelWrap, rawModal } from '../../../utils/modalComponents';

const tl = lang.ticket.customTypes.userRestrict;

/**
 * Handler for /ticket user-restrict command
 * Manages user restrictions for specific ticket types
 */
export async function userRestrictHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.guild) {
      enhancedLogger.warn('User-restrict handler: guild not found', LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
      });
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Permission check: only admins can restrict users
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guild.id;
    const targetUser = interaction.options.getUser('user', true);
    const typeId = interaction.options.getString('type');

    enhancedLogger.debug(
      `Command: /ticket user-restrict user=${targetUser.id} type=${typeId || 'all'}`,
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        targetUserId: targetUser.id,
        typeId,
      },
    );

    const typeRepo = AppDataSource.getRepository(CustomTicketType);
    const restrictionRepo = AppDataSource.getRepository(UserTicketRestriction);

    // Get all ticket types for this guild
    const ticketTypes = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'ASC', displayName: 'ASC' },
    });

    if (ticketTypes.length === 0) {
      enhancedLogger.warn('User-restrict: no ticket types found', LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
      });
      await interaction.reply({
        content: tl.noTypes,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // If a specific type is provided, handle single toggle with confirmation
    if (typeId) {
      await handleSingleTypeToggle(interaction, guildId, targetUser, typeId, ticketTypes, restrictionRepo);
      return;
    }

    // Otherwise, show checkbox group modal for batch management
    await showRestrictionsModal(interaction, guildId, targetUser, ticketTypes, restrictionRepo);
  } catch (error) {
    await handleInteractionError(interaction, error, 'userRestrictHandler');
  }
}

/**
 * Handle toggling restriction for a single ticket type with confirmation
 */
async function handleSingleTypeToggle(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  targetUser: User,
  typeId: string,
  ticketTypes: CustomTicketType[],
  restrictionRepo: typeof AppDataSource extends {
    getRepository: (entity: typeof UserTicketRestriction) => infer R;
  }
    ? R
    : never,
): Promise<void> {
  const ticketType = ticketTypes.find(t => t.typeId === typeId);

  if (!ticketType) {
    await interaction.reply({
      content: lang.ticket.customTypes.typeEdit.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check if restriction exists
  const existingRestriction = await restrictionRepo.findOne({
    where: { guildId, userId: targetUser.id, typeId },
  });

  const isCurrentlyRestricted = !!existingRestriction;
  const confirmMessage = isCurrentlyRestricted
    ? tl.confirmAllow.replace('{user}', targetUser.toString()).replace('{type}', ticketType.displayName)
    : tl.confirmRestrict.replace('{user}', targetUser.toString()).replace('{type}', ticketType.displayName);

  // Create confirmation buttons
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`restrict_confirm_${targetUser.id}_${typeId}`)
      .setLabel(isCurrentlyRestricted ? 'Allow' : 'Restrict')
      .setStyle(isCurrentlyRestricted ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`restrict_cancel_${targetUser.id}_${typeId}`)
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: confirmMessage,
    components: [row],
    flags: [MessageFlags.Ephemeral],
  });

  const filter = (i: ButtonInteraction) => {
    if (i.user.id !== interaction.user.id) {
      i.reply({
        content: tl.notYourInteraction,
        flags: [MessageFlags.Ephemeral],
      });
      return false;
    }
    return i.customId.startsWith('restrict_confirm_') || i.customId.startsWith('restrict_cancel_');
  };

  const collector = interaction.channel?.createMessageComponentCollector({
    filter,
    componentType: ComponentType.Button,
    time: 30000,
    max: 1,
  });

  collector?.on('collect', async i => {
    if (i.customId.startsWith('restrict_confirm_')) {
      try {
        if (isCurrentlyRestricted) {
          await restrictionRepo.remove(existingRestriction);
          await i.update({
            content: tl.successAllow.replace('{user}', targetUser.toString()).replace('{type}', ticketType.displayName),
            components: [],
          });

          enhancedLogger.info(
            `Ticket restriction removed: ${targetUser.tag} can now create ${typeId}`,
            LogCategory.COMMAND_EXECUTION,
            {
              guildId,
              userId: targetUser.id,
              typeId,
              removedBy: interaction.user.id,
            },
          );
        } else {
          const newRestriction = restrictionRepo.create({
            guildId,
            userId: targetUser.id,
            typeId,
            restrictedBy: interaction.user.id,
          });
          await restrictionRepo.save(newRestriction);

          await i.update({
            content: tl.successRestrict
              .replace('{user}', targetUser.toString())
              .replace('{type}', ticketType.displayName),
            components: [],
          });

          enhancedLogger.info(
            `Ticket restriction added: ${targetUser.tag} restricted from ${typeId}`,
            LogCategory.COMMAND_EXECUTION,
            {
              guildId,
              userId: targetUser.id,
              typeId,
              restrictedBy: interaction.user.id,
            },
          );
        }
      } catch {
        await i.update({ content: tl.error, components: [] });
      }
    } else {
      await i.update({ content: tl.cancelled, components: [] });
    }
  });

  collector?.on('end', async collected => {
    if (collected.size === 0) {
      try {
        await interaction.editReply({ content: tl.cancelled, components: [] });
      } catch {
        // Interaction may have expired
      }
    }
  });
}

/**
 * Show a checkbox group modal for managing all restrictions for a user.
 * Checked items = restricted types. One submit = batch DB update.
 */
async function showRestrictionsModal(
  interaction: ChatInputCommandInteraction,
  guildId: string,
  targetUser: User,
  ticketTypes: CustomTicketType[],
  restrictionRepo: typeof AppDataSource extends {
    getRepository: (entity: typeof UserTicketRestriction) => infer R;
  }
    ? R
    : never,
): Promise<void> {
  // Get current restrictions
  const restrictions = await restrictionRepo.find({
    where: { guildId, userId: targetUser.id },
  });
  const restrictedTypeIds = new Set(restrictions.map(r => r.typeId));

  // Build checkbox group options (max 10 per Discord API)
  const options = ticketTypes.slice(0, 10).map(type => ({
    label: type.displayName,
    value: type.typeId,
    description: type.emoji ? `${type.emoji} ${type.typeId}` : type.typeId,
    default: restrictedTypeIds.has(type.typeId),
  }));

  const modal = rawModal(`ur_modal_${targetUser.id}_${Date.now()}`, `Restrictions: ${targetUser.displayName}`, [
    labelWrap(
      'Restricted Ticket Types',
      checkboxGroup('ur_restricted_types', options, 0),
      'Check the types this user should be BLOCKED from creating',
    ),
  ]);

  await interaction.showModal(modal as any);

  const modalSubmit = await interaction.awaitModalSubmit({ time: 300_000 }).catch(async () => {
    await notifyModalTimeout(interaction);
    return null;
  });
  if (!modalSubmit) return;

  // Get selected (restricted) type IDs from checkbox group
  const rawSelectedValues: string[] = (modalSubmit.fields as any).getField('ur_restricted_types')?.values ?? [];
  // Validate submitted values against guild-owned ticket types (prevents cross-guild data injection)
  const validTypeIds = new Set(ticketTypes.map(t => t.typeId));
  const selectedValues = rawSelectedValues.filter(id => validTypeIds.has(id));
  const newRestrictedSet = new Set(selectedValues);

  // Compute diff: add new restrictions, remove old ones
  const toAdd = [...newRestrictedSet].filter(id => !restrictedTypeIds.has(id));
  const toRemove = [...restrictedTypeIds].filter(id => !newRestrictedSet.has(id));

  // Batch: remove lifted restrictions
  for (const typeId of toRemove) {
    await restrictionRepo.delete({ guildId, userId: targetUser.id, typeId });
  }

  // Batch: add new restrictions
  if (toAdd.length > 0) {
    const newRestrictions = toAdd.map(typeId =>
      restrictionRepo.create({
        guildId,
        userId: targetUser.id,
        typeId,
        restrictedBy: interaction.user.id,
      }),
    );
    await restrictionRepo.save(newRestrictions);
  }

  // Build summary embed
  const typeStatusLines = ticketTypes.map(type => {
    const isRestricted = newRestrictedSet.has(type.typeId);
    const status = isRestricted ? tl.restricted : tl.canCreate;
    const emoji = type.emoji || '🎫';
    return `${emoji} **${type.displayName}** - ${status}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(tl.title)
    .setDescription(`${tl.description.replace('{user}', targetUser.toString())}\n\n${typeStatusLines.join('\n')}`)
    .setColor(0x5865f2)
    .setFooter({ text: tl.saved });

  await modalSubmit.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });

  enhancedLogger.info(`Ticket restrictions updated via modal for ${targetUser.tag}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    userId: targetUser.id,
    restricted: [...newRestrictedSet],
    added: toAdd,
    removed: toRemove,
    updatedBy: interaction.user.id,
  });
}
