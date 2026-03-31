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
import { enhancedLogger, extractIdFromMention, LogCategory, lang } from '../../utils';
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
    await interaction.reply({
      content: lang.general.cmdGuildNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const ticket = await ticketRepo.findOneBy({ guildId, channelId: channelId });

  // get the bot config repo
  const botConfigRepo = AppDataSource.getRepository(BotConfig);
  const botConfig = await botConfigRepo.findOneBy({ guildId });
  const gsrFlag = botConfig?.enableGlobalStaffRole;
  const gsr = `${botConfig?.globalStaffRole}\n`;

  // check if the ticket exists in the database
  if (!ticket) {
    return enhancedLogger.error(lang.general.fatalError, undefined, LogCategory.COMMAND_EXECUTION);
  }

  // check if the person hitting the button is the ticket creator
  if (userId === ticket.createdBy) {
    // Get ticket config to check admin-only mention setting
    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    const shouldMentionStaff = ticketConfig?.adminOnlyMentionStaff ?? true;

    // Only mention staff if the setting is enabled and staff role is configured
    if (gsrFlag && gsr && shouldMentionStaff) {
      await channel.send({
        content: `${gsr}❗Oh, Mods!❗ ${user} ${tl.request}`,
      });
    } else {
      await channel.send({
        content: `❗Oh, Mods!❗ ${user} ${tl.request}`,
      });
    }
    return;
  }

  const savedRoles = await staffRoleRepo
    .createQueryBuilder()
    .select(['role'])
    .where('guildId = :guildId', { guildId })
    .andWhere('type = :type', { type: 'staff' })
    .getRawMany();

  // get each staff role and remove them from being able to view the channel
  savedRoles.forEach(role => {
    const roleId = extractIdFromMention(role.role);
    if (!roleId) {
      enhancedLogger.warn(`Invalid role format: ${role.role}`, LogCategory.COMMAND_EXECUTION);
      return; // skip this role
    }

    channel.permissionOverwrites.edit(roleId, {
      ViewChannel: false,
    });
  });

  // edit the channel's initial welcome message to not include the admin only button
  const messageId = ticket.messageId;
  if (!messageId) return;
  const msg = channel.messages.fetch(messageId);

  // close ticket button
  const closeButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
  );

  // set the components of the welcome message to just have the close button
  (await msg)?.edit({ components: [closeButton] });

  // update the ticket status
  await ticketRepo.update({ id: ticket.id, guildId }, { status: 'adminOnly' });
};
