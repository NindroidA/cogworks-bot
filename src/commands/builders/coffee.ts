import { SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.general.coffee;

/* main slash command */
export const coffee = new SlashCommandBuilder()
    .setName('coffee')
    .setDescription(tl.cmdDescrp)
    .toJSON();
