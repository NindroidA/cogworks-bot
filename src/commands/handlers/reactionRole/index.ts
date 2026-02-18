import type {
  AutocompleteInteraction,
  CacheType,
  ChatInputCommandInteraction,
  Client,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import { lang } from '../../../utils';
import { reactionRoleAddHandler } from './add';
import { reactionRoleCreateHandler } from './create';
import { reactionRoleDeleteHandler } from './delete';
import { reactionRoleEditHandler } from './edit';
import { reactionRoleListHandler } from './list';
import { reactionRoleRemoveHandler } from './remove';

const menuRepo = AppDataSource.getRepository(ReactionRoleMenu);

export const reactionRoleHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'create':
      await reactionRoleCreateHandler(interaction);
      break;
    case 'add':
      await reactionRoleAddHandler(interaction);
      break;
    case 'remove':
      await reactionRoleRemoveHandler(interaction);
      break;
    case 'edit':
      await reactionRoleEditHandler(interaction);
      break;
    case 'delete':
      await reactionRoleDeleteHandler(interaction);
      break;
    case 'list':
      await reactionRoleListHandler(interaction);
      break;
  }
};

/**
 * Autocomplete for the menu option — returns menus from this guild
 */
export async function reactionRoleMenuAutocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId || '';
  const focused = interaction.options.getFocused().toLowerCase();

  const menus = await menuRepo.find({ where: { guildId } });
  const filtered = menus
    .filter(m => m.name.toLowerCase().includes(focused) || m.id.toString().includes(focused))
    .slice(0, 25);

  if (filtered.length === 0) {
    await interaction.respond([{ name: lang.reactionRole.autocomplete.noMenus, value: '0' }]);
    return;
  }

  await interaction.respond(
    filtered.map(m => ({
      name: m.name,
      value: m.id.toString(),
    })),
  );
}
