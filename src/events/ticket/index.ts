import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { UserTicketRestriction } from '../../typeorm/entities/ticket/UserTicketRestriction';

/* Legacy options for how the user would like to open a ticket (fallback) */
export const ticketOptions = () => {
  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('ticket_18_verify').setLabel('18+ Verify').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_ban_appeal').setLabel('Ban Appeal').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_player_report').setLabel('Player Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_bug_report').setLabel('Bug Report').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ticket_other').setLabel('Other').setStyle(ButtonStyle.Primary),
  );

  return options;
};

/** Discord caps a select menu at 25 options. */
const MAX_SELECT_OPTIONS = 25;
const DEFAULT_TYPE_EMOJI = '🎫';
const CUSTOM_EMOJI_RE = /^<a?:\w{2,32}:\d{17,20}>$/;
/** One unicode emoji: a flag, a keycap, or a pictograph with optional VS16/skin tone, ZWJ parts and tag characters. */
const UNICODE_EMOJI_RE =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]?(?:\u200D\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]?)*[\u{E0020}-\u{E007F}]*)$/u;

/**
 * Whether Discord accepts `emoji` on a component: one unicode emoji or the
 * `<:name:id>` custom form. Type emoji are stored as free text (`:bug:`, `bug`),
 * and one bad option makes Discord reject the whole menu.
 */
export function isComponentEmoji(emoji: string | null | undefined): emoji is string {
  return !!emoji && (CUSTOM_EMOJI_RE.test(emoji) || UNICODE_EMOJI_RE.test(emoji));
}

/** Select options for the given types: at most 25, and an invalid emoji falls back to the default. */
export function buildTicketTypeOptions(types: CustomTicketType[]): StringSelectMenuOptionBuilder[] {
  return types.slice(0, MAX_SELECT_OPTIONS).map(type =>
    new StringSelectMenuOptionBuilder()
      .setLabel(type.displayName.substring(0, 100))
      .setValue(type.typeId)
      .setDescription(type.description?.substring(0, 100) || 'Select this ticket type')
      .setEmoji(isComponentEmoji(type.emoji) ? type.emoji : DEFAULT_TYPE_EMOJI),
  );
}

/* Dynamic ticket type options based on custom ticket types */
export const customTicketOptions = async (
  guildId: string,
  userId?: string,
): Promise<ActionRowBuilder<StringSelectMenuBuilder>> => {
  const typeRepo = AppDataSource.getRepository(CustomTicketType);

  // Get all active ticket types for the guild
  let types = await typeRepo.find({
    where: { guildId, isActive: true },
    order: { sortOrder: 'ASC' },
  });

  // Filter out restricted types if userId is provided
  if (userId) {
    const restrictionRepo = AppDataSource.getRepository(UserTicketRestriction);
    const restrictions = await restrictionRepo.find({
      where: { guildId, userId },
    });
    const restrictedTypeIds = new Set(restrictions.map(r => r.typeId));
    types = types.filter(type => !restrictedTypeIds.has(type.typeId));
  }

  const options = buildTicketTypeOptions(types);

  // If no options available (all restricted), add a placeholder
  if (options.length === 0) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('No ticket types available')
        .setValue('none')
        .setDescription('You do not have access to create any ticket types')
        .setEmoji('🚫'),
    );
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('ticket_type_select')
    .setPlaceholder('Select a ticket type...')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
};
