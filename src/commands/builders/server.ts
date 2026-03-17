import { SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.general.server;

export const server = new SlashCommandBuilder()
  .setName('server')
  .setDescription(tl.cmdDescrp)
  .toJSON();
