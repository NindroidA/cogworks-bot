import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { guardAdminRateLimit, handleInteractionError, lang, RateLimits } from '../../../utils';
import { detectionHandler } from './detection';
import { dmNotifyHandler } from './dmNotify';
import { escalationHandler } from './escalation';
import { handleKeywords } from './keywords';
import { overrideHandler } from './override';
import { settingsHandler } from './settings';
import { handleBaitChannelAddChannel, handleBaitChannelRemoveChannel, setupHandler } from './setup';
import { statsHandler } from './stats';
import { statusHandler } from './status';
import { summaryHandler } from './summary';
import { testModeHandler } from './testMode';
import { toggleHandler } from './toggle';
import { whitelistHandler } from './whitelist';

export async function baitChannelHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guard = await guardAdminRateLimit(interaction, {
      action: 'baitchannel',
      limit: RateLimits.BAIT_CHANNEL,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    if (!interaction.guildId) return;
    const group = interaction.options.getSubcommandGroup(true);
    const subcommand = interaction.options.getSubcommand();

    switch (group) {
      case 'setup':
        switch (subcommand) {
          case 'setup':
            await setupHandler(client, interaction);
            break;
          case 'toggle':
            await toggleHandler(client, interaction);
            break;
          case 'add-channel':
            await handleBaitChannelAddChannel(client, interaction);
            break;
          case 'remove-channel':
            await handleBaitChannelRemoveChannel(client, interaction);
            break;
          case 'status':
            await statusHandler(client, interaction);
            break;
          default:
            await interaction.reply({ content: lang.errors.unknownSubcommand, flags: [MessageFlags.Ephemeral] });
        }
        break;

      case 'detection':
        switch (subcommand) {
          case 'detection':
            await detectionHandler(client, interaction);
            break;
          case 'whitelist':
            await whitelistHandler(client, interaction);
            break;
          case 'keywords':
            await handleKeywords(client, interaction);
            break;
          case 'settings':
            await settingsHandler(client, interaction);
            break;
          case 'test-mode':
            await testModeHandler(client, interaction);
            break;
          default:
            await interaction.reply({ content: lang.errors.unknownSubcommand, flags: [MessageFlags.Ephemeral] });
        }
        break;

      case 'escalation':
        await escalationHandler(client, interaction);
        break;

      case 'dm':
        await dmNotifyHandler(client, interaction);
        break;

      case 'stats':
        switch (subcommand) {
          case 'stats':
            await statsHandler(client, interaction);
            break;
          case 'summary':
            await summaryHandler(client, interaction);
            break;
          case 'override':
            await overrideHandler(client, interaction);
            break;
          default:
            await interaction.reply({ content: lang.errors.unknownSubcommand, flags: [MessageFlags.Ephemeral] });
        }
        break;

      default:
        await interaction.reply({
          content: lang.errors.unknownSubcommand,
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute bait channel command');
  }
}
