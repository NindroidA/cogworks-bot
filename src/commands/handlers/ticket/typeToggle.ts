import { type AutocompleteInteraction, type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import {
  enhancedLogger,
  formatLang,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
} from '../../../utils';
import { BUILTIN_TICKET_TYPE_IDS, BUILTIN_TYPES } from '../../../utils/ticket/builtinTypes';

const tl = lang.ticket.customTypes.typeToggle;

/**
 * Handler for /ticket type-toggle command
 * Activates or deactivates a custom ticket type
 */
export async function typeToggleHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const typeId = interaction.options.getString('type', true);

    enhancedLogger.debug(`Command: /ticket type-toggle type=${typeId}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
    });

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const type = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!type) {
      enhancedLogger.warn(`Type-toggle: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        typeId,
      });
      await interaction.reply({
        content: tl.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Toggle the active status
    const previousState = type.isActive;
    type.isActive = !type.isActive;
    await typeRepo.save(type);

    enhancedLogger.info(
      `Type toggled: '${typeId}' ${previousState} → ${type.isActive}`,
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        typeId,
        previousState,
        newState: type.isActive,
      },
    );

    const message = type.isActive
      ? formatLang(tl.activated, type.displayName)
      : formatLang(tl.deactivated, type.displayName);

    await interaction.reply({
      content: message,
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeToggleHandler');
  }
}

/**
 * Autocomplete handler for ticket type selection
 * Used by type-toggle, type-edit, and type-default commands
 */
export async function ticketTypeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const focusedValue = interaction.options.getFocused().toLowerCase();

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const types = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'ASC' },
    });

    const filtered = types
      .filter(
        type =>
          type.typeId.toLowerCase().includes(focusedValue) || type.displayName.toLowerCase().includes(focusedValue),
      )
      .slice(0, 25); // Discord limit

    await interaction.respond(
      filtered.map(type => ({
        name: `${type.emoji || '❓'} ${type.displayName} (${type.isActive ? '🟢' : '🔴'})`,
        value: type.typeId,
      })),
    );
  } catch (error) {
    enhancedLogger.error(
      'Autocomplete error in ticketTypeAutocomplete',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId: interaction.guildId },
    );
    // Autocomplete errors should fail silently
    await interaction.respond([]);
  }
}

/**
 * Autocomplete handler that includes both builtin and custom ticket types.
 * Used by settings command for ping-on-create setting.
 */
export async function ticketTypeAutocompleteWithBuiltin(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const focusedValue = interaction.options.getFocused().toLowerCase();

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const customTypes = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'ASC' },
    });

    // Filter out custom types that have the same typeId as builtin types to avoid duplicates
    const filteredCustomTypes = customTypes.filter(
      t => !(BUILTIN_TICKET_TYPE_IDS as readonly string[]).includes(t.typeId),
    );

    // Combine builtin and custom types (builtin first, then custom)
    const allTypes = [
      ...BUILTIN_TYPES.map(t => ({
        typeId: t.typeId,
        displayName: t.displayName,
        emoji: t.emoji,
        isBuiltin: true,
      })),
      ...filteredCustomTypes.map(t => ({
        typeId: t.typeId,
        displayName: t.displayName,
        emoji: t.emoji || '📝',
        isBuiltin: false,
      })),
    ];

    const filtered = allTypes
      .filter(
        type =>
          type.typeId.toLowerCase().includes(focusedValue) || type.displayName.toLowerCase().includes(focusedValue),
      )
      .slice(0, 25); // Discord limit

    await interaction.respond(
      filtered.map(type => ({
        name: `${type.emoji} ${type.displayName}${type.isBuiltin ? ' (Builtin)' : ''}`,
        value: type.typeId,
      })),
    );
  } catch (error) {
    enhancedLogger.error(
      'Autocomplete error in ticketTypeAutocompleteWithBuiltin',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId: interaction.guildId },
    );
    await interaction.respond([]);
  }
}
