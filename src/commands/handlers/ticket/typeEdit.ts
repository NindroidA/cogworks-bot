import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import type { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { extractModalBoolean, extractModalField, lang, sanitizeUserInput } from '../../../utils';
import {
  checkbox,
  labelWrap,
  paragraphInput,
  type RawModal,
  rawModal,
  textInput,
} from '../../../utils/modalComponents';
import { renderInteractiveTypeView } from './typeList';

const tl = lang.ticket.customTypes.typeEdit;

/**
 * Build the new-format edit modal for a custom ticket type. Reused by both
 * the slash-command edit handler (via the interactive list view) and the
 * Edit button on the typeList detail view.
 */
export function buildTypeEditModal(type: CustomTicketType): RawModal {
  const ta = lang.ticket.customTypes.typeAdd;
  return rawModal(`ticket-type-edit-modal:${type.typeId}`, tl.modalTitle, [
    labelWrap(
      ta.displayNameLabel,
      textInput({
        customId: 'displayName',
        value: type.displayName,
        required: true,
        maxLength: 100,
      }),
    ),
    labelWrap(
      ta.emojiLabel,
      textInput({
        customId: 'emoji',
        value: type.emoji ?? '',
        required: false,
        maxLength: 10,
      }),
    ),
    labelWrap(
      ta.colorLabel,
      textInput({
        customId: 'color',
        value: type.embedColor,
        required: false,
        maxLength: 7,
      }),
    ),
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
  const rawDisplayName = extractModalField(submit.fields, 'displayName') ?? '';
  const rawEmoji = (extractModalField(submit.fields, 'emoji') ?? '').trim();
  const rawColor = (extractModalField(submit.fields, 'color') ?? '').trim();
  const rawDescription = extractModalField(submit.fields, 'description') ?? '';
  const pingStaffOnCreate = extractModalBoolean(fields, 'pingStaffOnCreate');

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
 * Handler for `/ticket type edit type:foo`. Behaves as a shortcut into the
 * interactive type-management view — jumps straight to the detail screen for
 * the selected type, where the user can toggle Active, set Default, click
 * Edit to open the modal, or go Back to the full list. Same surface as
 * picking the type from `/ticket type list`'s dropdown; this just skips the
 * picker.
 */
export async function typeEditHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  const typeId = interaction.options.getString('type', true);
  await renderInteractiveTypeView(interaction, { startWith: 'detail', typeId });
}
