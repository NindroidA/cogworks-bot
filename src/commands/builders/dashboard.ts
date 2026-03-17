import { SlashCommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.general.dashboard;

export const dashboard = new SlashCommandBuilder()
  .setName('dashboard')
  .setDescription(tl.cmdDescrp)
  .toJSON();
