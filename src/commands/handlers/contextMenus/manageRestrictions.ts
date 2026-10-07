/**
 * "Manage Restrictions" — User Context Menu Command
 *
 * Right-click a user → Manage Restrictions → Checkbox group modal for ticket type restrictions
 */

import { EmbedBuilder, MessageFlags, type UserContextMenuCommandInteraction } from 'discord.js';
import { In } from 'typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { UserTicketRestriction } from '../../../typeorm/entities/ticket/UserTicketRestriction';
import {
  enhancedLogger,
  fmt,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  showAndAwaitModal,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { rawModal } from '../../../utils/modalComponents';
import { buildRestrictionGroups, diffRestrictionSubmit, restrictionModalTitle } from '../ticket/userRestrict';

const tl = lang.ticket.customTypes.userRestrict;
const ticketConfigRepo = lazyRepo(TicketConfig);
const typeRepo = lazyRepo(CustomTicketType);
const restrictionRepo = lazyRepo(UserTicketRestriction);

export async function manageRestrictionsHandler(interaction: UserContextMenuCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const targetUser = interaction.targetUser;

    // Verify the ticket system is configured at all before showing the modal
    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    if (!ticketConfig) {
      await interaction.reply({
        content: lang.general.contextMenu.ticketNotConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Get ticket types
    const ticketTypes = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'ASC', displayName: 'ASC' },
    });

    if (ticketTypes.length === 0) {
      await interaction.reply({
        content: tl.noTypes,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Get current restrictions
    const restrictions = await restrictionRepo.find({
      where: { guildId, userId: targetUser.id },
    });
    const restrictedTypeIds = new Set(restrictions.map(r => r.typeId));

    const { components, shownIds } = buildRestrictionGroups(ticketTypes, restrictedTypeIds, 'ctx_restricted_types');
    const modal = rawModal(
      `ctx_restrict_${targetUser.id}_${Date.now()}`,
      restrictionModalTitle(targetUser.displayName),
      components,
    );

    const modalSubmit = await showAndAwaitModal(interaction, modal);
    if (!modalSubmit) return;

    const {
      toAdd,
      toRemove,
      restricted: newRestrictedSet,
    } = diffRestrictionSubmit(modalSubmit.fields, 'ctx_restricted_types', shownIds, restrictedTypeIds);

    // Apply changes — removals in one query, mirroring the batched adds
    if (toRemove.length > 0) {
      await restrictionRepo.delete({ guildId, userId: targetUser.id, typeId: In(toRemove) });
    }
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

    // Summary
    const typeStatusLines = ticketTypes.map(type => {
      const isRestricted = newRestrictedSet.has(type.typeId);
      const status = isRestricted ? tl.restricted : tl.canCreate;
      const emoji = type.emoji || '🎫';
      return `${emoji} **${type.displayName}** - ${status}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(tl.title)
      .setDescription(`${fmt(tl.description, { user: targetUser.toString() })}\n\n${typeStatusLines.join('\n')}`)
      .setColor(0x5865f2)
      .setFooter({ text: tl.saved });

    await modalSubmit.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Ticket restrictions updated via context menu', LogCategory.COMMAND_EXECUTION, {
      guildId,
      userId: targetUser.id,
      added: toAdd,
      removed: toRemove,
      updatedBy: interaction.user.id,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Manage restrictions context menu');
  }
}
