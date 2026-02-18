import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  ComponentType,
  MessageFlags,
  type TextChannel,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import {
  enhancedLogger,
  invalidateMenuCache,
  LogCategory,
  lang,
  requireAdmin,
} from '../../../utils';

const tl = lang.reactionRole;
const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

export async function reactionRoleDeleteHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
) {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const guildId = interaction.guildId || '';
  const guild = interaction.guild;
  if (!guild) return;

  const menuId = parseInt(interaction.options.getString('menu', true), 10);

  try {
    const menu = await menuRepo.findOne({ where: { id: menuId, guildId } });
    if (!menu) {
      await interaction.reply({ content: tl.errors.menuNotFound, flags: [MessageFlags.Ephemeral] });
      return;
    }

    // Confirmation buttons
    const confirmBtn = new ButtonBuilder()
      .setCustomId('rr-delete-confirm')
      .setLabel(lang.general.buttons.confirm)
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId('rr-delete-cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

    const reply = await interaction.reply({
      content: tl.delete.confirmMessage.replace('{name}', menu.name),
      components: [row],
      flags: [MessageFlags.Ephemeral],
    });

    // Wait for button press
    try {
      const btnInteraction = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 30_000,
      });

      if (btnInteraction.customId === 'rr-delete-confirm') {
        // Delete the Discord message
        try {
          const channel = await guild.channels.fetch(menu.channelId);
          if (channel?.isTextBased()) {
            const msg = await (channel as TextChannel).messages.fetch(menu.messageId);
            await msg.delete();
          }
        } catch {
          // Message may already be deleted
        }

        // Invalidate cache and delete from DB (CASCADE will remove options)
        invalidateMenuCache(menu.messageId);
        await menuRepo.remove(menu);

        await btnInteraction.update({
          content: tl.delete.success.replace('{name}', menu.name),
          components: [],
        });

        enhancedLogger.info('Reaction role menu deleted', LogCategory.COMMAND_EXECUTION, {
          guildId,
          menuId: menu.id,
          menuName: menu.name,
          userId: interaction.user.id,
        });
      } else {
        await btnInteraction.update({
          content: lang.errors.cancelled,
          components: [],
        });
      }
    } catch {
      // Timeout
      await interaction.editReply({ content: lang.errors.timeout, components: [] });
    }
  } catch (error) {
    enhancedLogger.error(
      'Failed to delete reaction role menu',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({ content: tl.delete.error, flags: [MessageFlags.Ephemeral] });
  }
}
