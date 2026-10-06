import {
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  type ModalSubmitInteraction,
  type User,
} from 'discord.js';
import { In } from 'typeorm';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { UserTicketRestriction } from '../../../typeorm/entities/ticket/UserTicketRestriction';
import {
  awaitConfirmation,
  clampText,
  enhancedLogger,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  logHandlerError,
  replyEphemeralError,
  showAndAwaitModal,
} from '../../../utils';
import { checkboxGroup, labelWrap, type RawModal, rawModal } from '../../../utils/modalComponents';

const tl = lang.ticket.customTypes.userRestrict;

/**
 * Handler for /ticket user-restrict command
 * Manages user restrictions for specific ticket types
 */
export async function userRestrictHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Permission check: only admins can restrict users
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
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
    await replyEphemeralError(interaction, lang.ticket.customTypes.typeEdit.notFound);
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

  // awaitConfirmation collects from this one reply. The old channel-wide
  // collector also saw other members' clicks (the ticket panel included) and
  // answered each with "not your interaction".
  const result = await awaitConfirmation(interaction, {
    message: confirmMessage,
    confirmLabel: isCurrentlyRestricted ? 'Allow' : 'Restrict',
    confirmStyle: isCurrentlyRestricted ? ButtonStyle.Success : ButtonStyle.Danger,
    idPrefix: `ur_toggle_${interaction.id}`,
  });
  if (!result) return;

  try {
    if (isCurrentlyRestricted) {
      await restrictionRepo.remove(existingRestriction);
      await result.interaction.editReply({
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

      await result.interaction.editReply({
        content: tl.successRestrict.replace('{user}', targetUser.toString()).replace('{type}', ticketType.displayName),
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
  } catch (error) {
    logHandlerError('userRestrict toggle', error, { guildId, typeId });
    await result.interaction.editReply({ content: tl.error, components: [] });
  }
}

/** Discord limits: 10 options per checkbox group, 5 top-level components per modal. */
const TYPES_PER_GROUP = 10;
const MAX_GROUPS = 5;

/**
 * Checkbox groups for a restrictions modal: one per 10 types, up to 50 types.
 * Returns the Label components and the ids of the types they show.
 */
export function buildRestrictionGroups(
  ticketTypes: CustomTicketType[],
  restrictedTypeIds: Set<string>,
  idPrefix: string,
): { components: RawModal['components']; shownIds: Set<string> } {
  const shown = ticketTypes.slice(0, TYPES_PER_GROUP * MAX_GROUPS);
  const components: RawModal['components'] = [];
  for (let start = 0; start < shown.length; start += TYPES_PER_GROUP) {
    const options = shown.slice(start, start + TYPES_PER_GROUP).map(type => ({
      label: type.displayName,
      value: type.typeId,
      description: type.emoji ? `${type.emoji} ${type.typeId}` : type.typeId,
      default: restrictedTypeIds.has(type.typeId),
    }));
    const group = start / TYPES_PER_GROUP;
    components.push(
      labelWrap(
        group === 0 ? 'Restricted Ticket Types' : `Restricted Ticket Types (${group + 1})`,
        checkboxGroup(`${idPrefix}_${group}`, options, 0),
        group === 0 ? 'Check the types this user should be BLOCKED from creating' : undefined,
      ),
    );
  }
  return { components, shownIds: new Set(shown.map(t => t.typeId)) };
}

/**
 * Read a submitted restrictions modal and diff it against the stored
 * restrictions. Only the types the modal showed can be added or lifted; a
 * restriction on a type that didn't fit stays as it is.
 */
export function diffRestrictionSubmit(
  fields: ModalSubmitInteraction['fields'],
  idPrefix: string,
  shownIds: Set<string>,
  restrictedTypeIds: Set<string>,
): { toAdd: string[]; toRemove: string[]; restricted: Set<string> } {
  const selected = new Set<string>();
  for (let group = 0; group * TYPES_PER_GROUP < shownIds.size; group++) {
    let values: unknown;
    try {
      values = (fields.getField(`${idPrefix}_${group}`) as { values?: unknown }).values;
    } catch {
      values = undefined; // group missing from the submission
    }
    for (const id of Array.isArray(values) ? values : []) {
      // Only ids this guild's modal offered (no cross-guild injection)
      if (typeof id === 'string' && shownIds.has(id)) selected.add(id);
    }
  }
  const toAdd = [...selected].filter(id => !restrictedTypeIds.has(id));
  const toRemove = [...restrictedTypeIds].filter(id => shownIds.has(id) && !selected.has(id));
  const restricted = new Set([...restrictedTypeIds].filter(id => !toRemove.includes(id)).concat(toAdd));
  return { toAdd, toRemove, restricted };
}

/** Modal titles are capped at 45 characters. */
export function restrictionModalTitle(displayName: string): string {
  return clampText(`Restrictions: ${displayName}`, 45);
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

  const { components, shownIds } = buildRestrictionGroups(ticketTypes, restrictedTypeIds, 'ur_restricted_types');
  const modal = rawModal(
    `ur_modal_${targetUser.id}_${Date.now()}`,
    restrictionModalTitle(targetUser.displayName),
    components,
  );

  const modalSubmit = await showAndAwaitModal(interaction, modal);
  if (!modalSubmit) return;

  const {
    toAdd,
    toRemove,
    restricted: newRestrictedSet,
  } = diffRestrictionSubmit(modalSubmit.fields, 'ur_restricted_types', shownIds, restrictedTypeIds);

  // Batch: remove lifted restrictions in one query (the additions below were
  // already batched via save(array))
  if (toRemove.length > 0) {
    await restrictionRepo.delete({ guildId, userId: targetUser.id, typeId: In(toRemove) });
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
