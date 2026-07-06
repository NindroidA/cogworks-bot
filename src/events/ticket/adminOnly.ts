import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type Client,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { StaffRole } from '../../typeorm/entities/StaffRole';
import { Ticket } from '../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { enhancedLogger, extractIdFromMention, LogCategory, lang, replyEphemeralError } from '../../utils';
import { lazyRepo } from '../../utils/database/lazyRepo';

const tl = lang.ticket.adminOnly;
const ticketRepo = lazyRepo(Ticket);
const staffRoleRepo = lazyRepo(StaffRole);
const ticketConfigRepo = lazyRepo(TicketConfig);

export const ticketAdminOnlyEvent = async (_client: Client, interaction: ButtonInteraction) => {
  const channel = interaction.channel as TextChannel;
  const channelId = interaction.channelId;
  const guildId = interaction.guildId;
  const user = interaction.user.displayName;
  const userId = interaction.user.id;
  if (!guildId) {
    await replyEphemeralError(interaction, lang.general.cmdGuildNotFound);
    return;
  }

  const ticket = await ticketRepo.findOneBy({ guildId, channelId: channelId });

  // get the bot config repo
  const botConfigRepo = AppDataSource.getRepository(BotConfig);
  const botConfig = await botConfigRepo.findOneBy({ guildId });
  const gsrFlag = botConfig?.enableGlobalStaffRole;
  const globalStaffRole = botConfig?.globalStaffRole;

  // check if the ticket exists in the database
  if (!ticket) {
    enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.COMMAND_EXECUTION, { guildId, channelId });
    // confirmAdminOnly already showed "Changing to Admin Only..." — surface the
    // failure instead of leaving the user on a frozen ack.
    await replyEphemeralError(interaction, lang.general.fatalError, { bugReport: true });
    return;
  }

  // check if the person hitting the button is the ticket creator
  if (userId === ticket.createdBy) {
    // Get ticket config to check admin-only mention setting
    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    const shouldMentionStaff = ticketConfig?.adminOnlyMentionStaff ?? true;

    // Only mention staff if the setting is enabled AND a staff role is actually
    // configured — `globalStaffRole` may be null/empty, and the old
    // `${botConfig?.globalStaffRole}\n` template was always truthy, so it could
    // ping a literal "undefined".
    if (gsrFlag && globalStaffRole && shouldMentionStaff) {
      await channel.send({
        content: `${globalStaffRole}\n${tl.modsAlert} ${user} ${tl.request}`,
      });
    } else {
      await channel.send({
        content: `${tl.modsAlert} ${user} ${tl.request}`,
      });
    }
    // Resolve the "Changing to Admin Only..." ack: the creator is *requesting*
    // admin-only (staff act on it), not performing it.
    await interaction.editReply({ content: tl.requestSent }).catch(() => {});
    return;
  }

  const savedRoles = await staffRoleRepo
    .createQueryBuilder()
    .select(['role'])
    .where('guildId = :guildId', { guildId })
    .andWhere('type = :type', { type: 'staff' })
    .getRawMany();

  // Remove each staff role's view access. Await sequentially (forEach does NOT
  // await async callbacks — the old fire-and-forget edits raced and could throw
  // unhandled) and tolerate per-role failures so one bad role doesn't abort the
  // rest or strand the interaction.
  for (const role of savedRoles) {
    const roleId = extractIdFromMention(role.role);
    if (!roleId) {
      enhancedLogger.warn(`Invalid role format: ${role.role}`, LogCategory.COMMAND_EXECUTION);
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(roleId, { ViewChannel: false });
    } catch (error) {
      enhancedLogger.error(
        'Failed to hide ticket channel from staff role during admin-only',
        error instanceof Error ? error : undefined,
        LogCategory.COMMAND_EXECUTION,
        { guildId, roleId },
      );
    }
  }

  // Strip the Admin Only button from the welcome message, leaving just Close.
  const messageId = ticket.messageId;
  if (messageId) {
    const closeButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
      new ButtonBuilder()
        .setCustomId('close_ticket')
        .setLabel(lang.ticket.buttons.closeTicket)
        .setStyle(ButtonStyle.Danger),
    );
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    await msg?.edit({ components: [closeButton] }).catch((error: unknown) => {
      enhancedLogger.warn(`Failed to update admin-only welcome message: ${error}`, LogCategory.COMMAND_EXECUTION, {
        guildId,
      });
    });
  }

  // update the ticket status
  await ticketRepo.update({ id: ticket.id, guildId }, { status: 'adminOnly' });

  // Resolve the "Changing to Admin Only..." ack so it isn't left frozen.
  await interaction.editReply({ content: tl.success }).catch(() => {});
};

export const adminOnlyButton = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: admin_only_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('confirm_admin_only_ticket').setLabel(tl.confirmL).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_admin_only_ticket').setLabel(tl.cancelL).setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: tl.confirm,
    components: [confirmRow],
    flags: [MessageFlags.Ephemeral],
  });
};

export const confirmAdminOnly = async (client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: confirm_admin_only_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.changing, components: [] });
  await ticketAdminOnlyEvent(client, interaction);
};

export const cancelAdminOnly = async (_client: Client, interaction: ButtonInteraction) => {
  enhancedLogger.debug(`Button: cancel_admin_only_ticket`, LogCategory.COMMAND_EXECUTION, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
  });
  await interaction.update({ content: tl.cancel, components: [] });
};
