import {
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';
import type { BaitChannelManager } from '../../../utils/baitChannelManager';

const tl = lang.baitChannel;

export const whitelistHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
) => {
  try {
    const action = interaction.options.getString('action', true);
    const role = interaction.options.getRole('role');
    const user = interaction.options.getUser('user');

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Handle list action
    if (action === 'list') {
      const embed = new EmbedBuilder().setColor('#0099FF').setTitle(tl.whitelist.title);

      const whitelistInfo: string[] = [];

      if ((config.whitelistedRoles?.length || 0) > 0) {
        const rolesList = config.whitelistedRoles!.map(roleId => `<@&${roleId}>`).join(', ');
        whitelistInfo.push(`**Roles:** ${rolesList}`);
      }

      if ((config.whitelistedUsers?.length || 0) > 0) {
        const usersList = config.whitelistedUsers!.map(userId => `<@${userId}>`).join(', ');
        whitelistInfo.push(`**Users:** ${usersList}`);
      }

      embed.setDescription(
        whitelistInfo.length > 0 ? whitelistInfo.join('\n\n') : tl.whitelist.empty,
      );

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // For add/remove, if no role or user specified and action is remove, use command executor
    const targetUser = user || (action === 'remove' ? interaction.user : null);

    if (!role && !targetUser) {
      await interaction.reply({
        content: tl.specifyRoleOrUser,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    let changed = false;
    let alreadyExists = false;
    let notInList = false;

    if (role) {
      if (action === 'add') {
        if (!config.whitelistedRoles) config.whitelistedRoles = [];
        if (config.whitelistedRoles.includes(role.id)) {
          alreadyExists = true;
        } else {
          config.whitelistedRoles.push(role.id);
          changed = true;
        }
      } else {
        if (!config.whitelistedRoles?.includes(role.id)) {
          notInList = true;
        } else {
          config.whitelistedRoles = config.whitelistedRoles?.filter(id => id !== role.id) || [];
          changed = true;
        }
      }
    }

    if (targetUser) {
      if (action === 'add') {
        if (!config.whitelistedUsers) config.whitelistedUsers = [];
        if (config.whitelistedUsers.includes(targetUser.id)) {
          alreadyExists = true;
        } else {
          config.whitelistedUsers.push(targetUser.id);
          changed = true;
        }
      } else {
        if (!config.whitelistedUsers?.includes(targetUser.id)) {
          notInList = true;
        } else {
          config.whitelistedUsers =
            config.whitelistedUsers?.filter(id => id !== targetUser.id) || [];
          changed = true;
        }
      }
    }

    if (changed) {
      await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

      const { baitChannelManager } = client as { baitChannelManager?: BaitChannelManager };
      if (baitChannelManager) {
        baitChannelManager.clearConfigCache(interaction.guildId!);
      }

      const target = role
        ? tl.whitelist.role.replace('{0}', role.name)
        : tl.whitelist.user.replace('{0}', targetUser!.tag);
      const message = action === 'add' ? tl.whitelist.added : tl.whitelist.removed;

      await interaction.reply({
        content: message.replace('{0}', target),
        flags: [MessageFlags.Ephemeral],
      });
    } else if (alreadyExists) {
      const target = role
        ? tl.whitelist.role.replace('{0}', role.name)
        : tl.whitelist.user.replace('{0}', targetUser!.tag);
      await interaction.reply({
        content: tl.whitelist.alreadyAdded.replace('{0}', target),
        flags: [MessageFlags.Ephemeral],
      });
    } else if (notInList) {
      const target = role
        ? tl.whitelist.role.replace('{0}', role.name)
        : tl.whitelist.user.replace('{0}', targetUser!.tag);
      await interaction.reply({
        content: tl.whitelist.notInList.replace('{0}', target),
        flags: [MessageFlags.Ephemeral],
      });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.updateWhitelist);
  }
};
