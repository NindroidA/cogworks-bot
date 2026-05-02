import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';

const tl = lang.baitChannel;

export async function whitelistHandler(client: Client, interaction: ChatInputCommandInteraction) {
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

      embed.setDescription(whitelistInfo.length > 0 ? whitelistInfo.join('\n\n') : tl.whitelist.empty);

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

    type WhitelistTarget = {
      field: 'whitelistedRoles' | 'whitelistedUsers';
      id: string;
    };
    const targets: WhitelistTarget[] = [];
    if (role) targets.push({ field: 'whitelistedRoles', id: role.id });
    if (targetUser) targets.push({ field: 'whitelistedUsers', id: targetUser.id });

    let changed = false;
    let alreadyExists = false;
    let notInList = false;

    for (const { field, id } of targets) {
      const current = config[field] ?? [];
      const exists = current.includes(id);
      if (action === 'add') {
        if (exists) {
          alreadyExists = true;
        } else {
          config[field] = [...current, id];
          changed = true;
        }
      } else {
        if (!exists) {
          notInList = true;
        } else {
          config[field] = current.filter(x => x !== id);
          changed = true;
        }
      }
    }

    if (changed) {
      await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

      const { baitChannelManager } = client as ExtendedClient;
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
}
