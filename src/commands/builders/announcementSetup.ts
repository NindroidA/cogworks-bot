import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.announcement.setup;

/* main slash command */
export const announcementSetup = new SlashCommandBuilder()
  .setName('announcement-setup')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addRoleOption(option => option.setName('announcement-role').setDescription(tl.announcementRole).setRequired(false))
  .addChannelOption(option => option.setName('default-channel').setDescription(tl.defaultChannel).setRequired(false))
  .toJSON();
