import { type ChatInputCommandInteraction, MessageFlags, type ModalSubmitInteraction } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import {
  enhancedLogger,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  sanitizeUserInput,
  showAndAwaitModal,
} from '../../../utils';
import {
  checkbox,
  labelWrap,
  paragraphInput,
  type RawModal,
  rawModal,
  textInput,
} from '../../../utils/modalComponents';
import { buildTypeConfirmationEmbed } from './typeAdd';

const tl = lang.ticket.customTypes.typeEdit;

/**
 * Build the new-format edit modal for a custom ticket type. Reused by both
 * the slash-command edit handler and the interactive list-view edit button.
 */
export function buildTypeEditModal(type: CustomTicketType): RawModal {
  const ta = lang.ticket.customTypes.typeAdd;
  return rawModal(`ticket-type-edit-modal:${type.typeId}`, tl.modalTitle, [
    labelWrap(
      ta.displayNameLabel,
      textInput({ customId: 'displayName', value: type.displayName, required: true, maxLength: 100 }),
    ),
    labelWrap(ta.emojiLabel, textInput({ customId: 'emoji', value: type.emoji ?? '', required: false, maxLength: 10 })),
    labelWrap(ta.colorLabel, textInput({ customId: 'color', value: type.embedColor, required: false, maxLength: 7 })),
    labelWrap(
      ta.descriptionLabel,
      paragraphInput({
        customId: 'description',
        value: type.description ?? '',
        required: false,
        maxLength: 500,
      }),
    ),
    labelWrap(
      'Ping Staff on Create',
      checkbox('pingStaffOnCreate', type.pingStaffOnCreate),
      'Mention staff when this type is used to open a ticket',
    ),
  ]);
}

export interface TypeEditFields {
  displayName: string;
  emoji: string | null;
  embedColor: string;
  description: string | null;
  pingStaffOnCreate: boolean;
}

/**
 * Read & validate the edit modal submission. Returns either the parsed fields
 * or a user-facing error message — caller handles reply.
 */
export function parseTypeEditSubmit(submit: ModalSubmitInteraction): { fields: TypeEditFields } | { error: string } {
  const fields = submit.fields as any;
  const rawDisplayName = (fields.getField('displayName')?.value as string | undefined) ?? '';
  const rawEmoji = ((fields.getField('emoji')?.value as string | undefined) ?? '').trim();
  const rawColor = ((fields.getField('color')?.value as string | undefined) ?? '').trim();
  const rawDescription = (fields.getField('description')?.value as string | undefined) ?? '';
  const pingStaffOnCreate = Boolean(fields.getField('pingStaffOnCreate')?.value);

  const displayName = sanitizeUserInput(rawDisplayName);
  const embedColor = rawColor || '#0099ff';
  const description = sanitizeUserInput(rawDescription) || null;

  if (!/^#[0-9A-Fa-f]{6}$/.test(embedColor)) {
    return { error: lang.ticket.customTypes.typeAdd.invalidColor };
  }

  return {
    fields: {
      displayName,
      emoji: rawEmoji || null,
      embedColor,
      description,
      pingStaffOnCreate,
    },
  };
}

/**
 * Handler for /ticket type edit command.
 *
 * Opens a single modal with all editable fields plus a checkbox for the
 * staff-ping toggle. The whole flow lives here — no separate
 * modal-submission dispatch — so the user sees one screen, fills it, and
 * gets a confirmation embed back.
 */
export async function typeEditHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const user = interaction.user.username;
    const guildId = interaction.guildId!;
    const typeId = interaction.options.getString('type', true);
    enhancedLogger.info(`User ${user} opening type-edit modal for '${typeId}'`, LogCategory.COMMAND_EXECUTION);

    const typeRepo = AppDataSource.getRepository(CustomTicketType);
    const type = await typeRepo.findOne({ where: { guildId, typeId } });

    if (!type) {
      enhancedLogger.warn(`User ${user} type-edit failed: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION);
      await interaction.reply({
        content: tl.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const submit = await showAndAwaitModal(interaction, buildTypeEditModal(type));
    if (!submit) return;

    const parsed = parseTypeEditSubmit(submit);
    if ('error' in parsed) {
      enhancedLogger.warn(`User ${user} type-edit validation failed`, LogCategory.COMMAND_EXECUTION);
      await submit.reply({
        content: parsed.error,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Re-fetch in case a concurrent edit landed between modal-show and submit.
    const fresh = await typeRepo.findOne({ where: { guildId, typeId } });
    if (!fresh) {
      enhancedLogger.warn(
        `User ${user} type-edit submit failed: type '${typeId}' not found`,
        LogCategory.COMMAND_EXECUTION,
      );
      await submit.reply({
        content: tl.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    fresh.displayName = parsed.fields.displayName;
    fresh.emoji = parsed.fields.emoji;
    fresh.embedColor = parsed.fields.embedColor;
    fresh.description = parsed.fields.description;
    fresh.pingStaffOnCreate = parsed.fields.pingStaffOnCreate;

    await typeRepo.save(fresh);
    enhancedLogger.info(
      `User ${user} updated ticket type '${typeId}' (${fresh.displayName}) ping=${fresh.pingStaffOnCreate} in guild ${guildId}`,
      LogCategory.COMMAND_EXECUTION,
    );

    const embed = buildTypeConfirmationEmbed(fresh, false);
    await submit.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeEditHandler');
  }
}
