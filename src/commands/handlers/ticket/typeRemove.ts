import { ButtonStyle, type ChatInputCommandInteraction } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { UserTicketRestriction } from '../../../typeorm/entities/ticket/UserTicketRestriction';
import {
  awaitConfirmation,
  enhancedLogger,
  fmt,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  logHandlerError,
  replyEphemeralError,
} from '../../../utils';

const tl = lang.ticket.customTypes.typeRemove;

/**
 * Handler for /ticket type-remove command
 * Deletes a custom ticket type with confirmation
 */
export async function typeRemoveHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const typeId = interaction.options.getString('type', true);

    enhancedLogger.debug(`Command: /ticket type-remove type=${typeId}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
    });

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!ticketType) {
      enhancedLogger.warn(`Type-remove: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        typeId,
      });
      await replyEphemeralError(interaction, tl.notFound);
      return;
    }

    // awaitConfirmation collects from this one reply only. A channel-wide
    // collector also caught a second remove prompt's Delete (deleting a type
    // nobody confirmed) and any other button the admin pressed, such as the
    // ticket panel, which it then overwrote.
    const result = await awaitConfirmation(interaction, {
      message: `**${tl.confirmTitle}**\n\n${fmt(tl.confirmMessage, { type: ticketType.displayName })}`,
      confirmLabel: lang.general.buttons.delete,
      confirmStyle: ButtonStyle.Danger,
      idPrefix: `tt_remove_${interaction.id}`,
    });
    if (!result) return;

    try {
      await typeRepo.remove(ticketType);
      // Restrictions on the deleted type would otherwise linger (the restriction
      // modals only rewrite the types they show).
      await AppDataSource.getRepository(UserTicketRestriction).delete({ guildId, typeId });
      await result.interaction.editReply({
        content: fmt(tl.success, { type: ticketType.displayName }),
        components: [],
      });

      enhancedLogger.info(`Ticket type deleted: ${ticketType.typeId}`, LogCategory.COMMAND_EXECUTION, {
        guildId,
        typeId: ticketType.typeId,
        userId: interaction.user.id,
      });
    } catch (error) {
      logHandlerError('typeRemoveHandler', error, { guildId, typeId });
      await result.interaction.editReply({ content: tl.error, components: [] });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeRemoveHandler');
  }
}
