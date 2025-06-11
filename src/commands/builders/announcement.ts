import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.announcement;

/* subcommands */
// perhaps custom announcement roles in the setup? idk yet still contemplating
// mc server shceduled maintenance
// mc server scheduled update
// mc server update announcement

/* main slash command */
export const announcement = new SlashCommandBuilder()
    .setName('announcement')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .toJSON();

