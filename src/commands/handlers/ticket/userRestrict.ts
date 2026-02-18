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
import { enhancedLogger, handleInteractionError, LogCategory, lang } from '../../../utils';

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

    const guildId = interaction.guild.id;
    const targetUser = interaction.options.getUser('user', true);
    const typeId = interaction.options.getString('type');

    enhancedLogger.debug(
      `Command: /ticket user-restrict user=${targetUser.id} type=${typeId || 'all'}`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, targetUserId: targetUser.id, typeId },
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
      await handleSingleTypeToggle(
        interaction,
        guildId,
        targetUser,
        typeId,
        ticketTypes,
        restrictionRepo,
      );
      return;
    }

    // Otherwise, show the configurator embed
    await showRestrictionsConfigurator(
      interaction,
      guildId,
      targetUser,
      ticketTypes,
      restrictionRepo,
    );
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
    ? tl.confirmAllow
        .replace('{user}', targetUser.toString())
        .replace('{type}', ticketType.displayName)
    : tl.confirmRestrict
        .replace('{user}', targetUser.toString())
        .replace('{type}', ticketType.displayName);

  // Create confirmation buttons
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`restrict_confirm_${targetUser.id}_${typeId}`)
      .setLabel(isCurrentlyRestricted ? 'Allow' : 'Restrict')
      .setStyle(isCurrentlyRestricted ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`restrict_cancel_${targetUser.id}_${typeId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: confirmMessage,
    components: [row],
    flags: [MessageFlags.Ephemeral],
  });

  // Set up collector for this specific interaction
  const filter = (i: ButtonInteraction) => {
    if (i.user.id !== interaction.user.id) {
      i.reply({ content: tl.notYourInteraction, flags: [MessageFlags.Ephemeral] });
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
          // Remove restriction
          await restrictionRepo.remove(existingRestriction);
          await i.update({
            content: tl.successAllow
              .replace('{user}', targetUser.toString())
              .replace('{type}', ticketType.displayName),
            components: [],
          });

          enhancedLogger.info(
            `Ticket restriction removed: ${targetUser.tag} can now create ${typeId}`,
            LogCategory.COMMAND_EXECUTION,
            { guildId, userId: targetUser.id, typeId, removedBy: interaction.user.id },
          );
        } else {
          // Add restriction
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
            { guildId, userId: targetUser.id, typeId, restrictedBy: interaction.user.id },
          );
        }
      } catch {
        await i.update({
          content: tl.error,
          components: [],
        });
      }
    } else {
      await i.update({
        content: tl.cancelled,
        components: [],
      });
    }
  });

  collector?.on('end', async collected => {
    if (collected.size === 0) {
      try {
        await interaction.editReply({
          content: tl.cancelled,
          components: [],
        });
      } catch {
        // Interaction may have expired
      }
    }
  });
}

/**
 * Show the configurator embed for managing all restrictions for a user
 */
async function showRestrictionsConfigurator(
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
  // Get all current restrictions for this user
  const restrictions = await restrictionRepo.find({
    where: { guildId, userId: targetUser.id },
  });

  const restrictedTypeIds = new Set(restrictions.map(r => r.typeId));

  // Build the embed and buttons
  const { embed, components } = buildConfiguratorEmbed(
    targetUser,
    ticketTypes,
    restrictedTypeIds,
    interaction.user.id,
  );

  await interaction.reply({
    embeds: [embed],
    components,
    flags: [MessageFlags.Ephemeral],
  });

  // Set up collector
  const filter = (i: ButtonInteraction) => {
    if (i.user.id !== interaction.user.id) {
      i.reply({ content: tl.notYourInteraction, flags: [MessageFlags.Ephemeral] });
      return false;
    }
    return i.customId.startsWith('ur_toggle_') || i.customId === 'ur_done';
  };

  const collector = interaction.channel?.createMessageComponentCollector({
    filter,
    componentType: ComponentType.Button,
    time: 300000, // 5 minutes
  });

  collector?.on('collect', async i => {
    if (i.customId === 'ur_done') {
      await i.update({
        content: tl.saved,
        embeds: [],
        components: [],
      });
      collector.stop();
      return;
    }

    // Handle toggle
    const typeId = i.customId.replace('ur_toggle_', '');
    const ticketType = ticketTypes.find(t => t.typeId === typeId);

    if (!ticketType) return;

    try {
      if (restrictedTypeIds.has(typeId)) {
        // Remove restriction
        await restrictionRepo.delete({ guildId, userId: targetUser.id, typeId });
        restrictedTypeIds.delete(typeId);

        enhancedLogger.info(
          `Ticket restriction removed: ${targetUser.tag} can now create ${typeId}`,
          LogCategory.COMMAND_EXECUTION,
          { guildId, userId: targetUser.id, typeId, removedBy: interaction.user.id },
        );
      } else {
        // Add restriction
        const newRestriction = restrictionRepo.create({
          guildId,
          userId: targetUser.id,
          typeId,
          restrictedBy: interaction.user.id,
        });
        await restrictionRepo.save(newRestriction);
        restrictedTypeIds.add(typeId);

        enhancedLogger.info(
          `Ticket restriction added: ${targetUser.tag} restricted from ${typeId}`,
          LogCategory.COMMAND_EXECUTION,
          { guildId, userId: targetUser.id, typeId, restrictedBy: interaction.user.id },
        );
      }

      // Update the embed
      const { embed: newEmbed, components: newComponents } = buildConfiguratorEmbed(
        targetUser,
        ticketTypes,
        restrictedTypeIds,
        interaction.user.id,
      );

      await i.update({
        embeds: [newEmbed],
        components: newComponents,
      });
    } catch {
      await i.reply({
        content: tl.error,
        flags: [MessageFlags.Ephemeral],
      });
    }
  });

  collector?.on('end', async (_, reason) => {
    if (reason === 'time') {
      try {
        await interaction.editReply({
          content: tl.saved,
          embeds: [],
          components: [],
        });
      } catch {
        // Interaction may have expired
      }
    }
  });
}

/**
 * Build the configurator embed and button components
 */
function buildConfiguratorEmbed(
  targetUser: User,
  ticketTypes: CustomTicketType[],
  restrictedTypeIds: Set<string>,
  _commandUserId: string,
): { embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } {
  // Build description with current status
  const typeStatusLines = ticketTypes.map(type => {
    const isRestricted = restrictedTypeIds.has(type.typeId);
    const status = isRestricted ? tl.restricted : tl.canCreate;
    const emoji = type.emoji || '🎫';
    return `${emoji} **${type.displayName}** - ${status}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(tl.title)
    .setDescription(
      `${tl.description.replace('{user}', targetUser.toString())}\n\n${typeStatusLines.join('\n')}`,
    )
    .setColor(0x5865f2)
    .setFooter({ text: tl.footer })
    .setThumbnail(targetUser.displayAvatarURL());

  // Build button rows (max 5 buttons per row, max 5 rows)
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let buttonCount = 0;

  for (const type of ticketTypes) {
    const isRestricted = restrictedTypeIds.has(type.typeId);

    const button = new ButtonBuilder()
      .setCustomId(`ur_toggle_${type.typeId}`)
      .setLabel(type.displayName.substring(0, 80)) // Discord limit
      .setStyle(isRestricted ? ButtonStyle.Danger : ButtonStyle.Success);

    if (type.emoji) {
      // Only set emoji if it's a valid single emoji
      try {
        button.setEmoji(type.emoji);
      } catch {
        // Invalid emoji, skip
      }
    }

    currentRow.addComponents(button);
    buttonCount++;

    if (buttonCount === 5) {
      components.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
      buttonCount = 0;
    }

    // Discord limit: max 25 buttons (5 rows * 5 buttons)
    if (components.length === 4 && buttonCount === 4) {
      break;
    }
  }

  // Add remaining buttons
  if (buttonCount > 0) {
    components.push(currentRow);
  }

  // Add Done button in a new row
  const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ur_done').setLabel('Done').setStyle(ButtonStyle.Primary),
  );
  components.push(doneRow);

  return { embed, components };
}
