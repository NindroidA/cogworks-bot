/**
 * "Manage Restrictions" — User Context Menu Command
 *
 * Right-click a user → Manage Restrictions → Checkbox group modal for ticket type restrictions
 */

import { EmbedBuilder, MessageFlags, type UserContextMenuCommandInteraction } from 'discord.js';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { UserTicketRestriction } from '../../../typeorm/entities/ticket/UserTicketRestriction';
import {
  enhancedLogger,
  guardAdmin,
  handleInteractionError,
  LogCategory,
  lang,
  showAndAwaitModal,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { checkboxGroup, labelWrap, rawModal } from '../../../utils/modalComponents';

const tl = lang.ticket.customTypes.userRestrict;
const typeRepo = lazyRepo(CustomTicketType);
const restrictionRepo = lazyRepo(UserTicketRestriction);

export async function manageRestrictionsHandler(interaction: UserContextMenuCommandInteraction): Promise<void> {
  try {
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const targetUser = interaction.targetUser;

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

    // Build checkbox group
    const options = ticketTypes.slice(0, 10).map(type => ({
      label: type.displayName,
      value: type.typeId,
      description: type.emoji ? `${type.emoji} ${type.typeId}` : type.typeId,
      default: restrictedTypeIds.has(type.typeId),
    }));

    const modal = rawModal(`ctx_restrict_${targetUser.id}_${Date.now()}`, `Restrictions: ${targetUser.displayName}`, [
      labelWrap(
        'Restricted Ticket Types',
        checkboxGroup('ctx_restricted_types', options, 0),
        'Check the types this user should be BLOCKED from creating',
      ),
    ]);

    const modalSubmit = await showAndAwaitModal(interaction as any, modal as any);
    if (!modalSubmit) return;

    // Get selected restricted types — validate against guild-owned types
    const rawSelectedValues: string[] = (modalSubmit.fields as any).getField('ctx_restricted_types')?.values ?? [];
    const validTypeIds = new Set(ticketTypes.map(t => t.typeId));
    const selectedValues = rawSelectedValues.filter(id => validTypeIds.has(id));
    const newRestrictedSet = new Set(selectedValues);

    // Compute diff
    const toAdd = [...newRestrictedSet].filter(id => !restrictedTypeIds.has(id));
    const toRemove = [...restrictedTypeIds].filter(id => !newRestrictedSet.has(id));

    // Apply changes
    for (const typeId of toRemove) {
      await restrictionRepo.delete({ guildId, userId: targetUser.id, typeId });
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
      .setDescription(`${tl.description.replace('{user}', targetUser.toString())}\n\n${typeStatusLines.join('\n')}`)
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
    await handleInteractionError(interaction as any, error, 'Manage restrictions context menu');
  }
}
