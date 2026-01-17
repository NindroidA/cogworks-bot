import { SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.general.ping;

/* main slash command */
export const ping = new SlashCommandBuilder()
    .setName('ping')
    .setDescription(tl.cmdDescrp)
    .toJSON();
