import { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { BotConfig } from '../typeorm/entities/BotConfig';
import { logger } from '../utils';
import lang from '../utils/lang.json';
import { addRoleHandler } from './handlers/addRole';
import { announcementHandler } from './handlers/announcement';
import { announcementSetupHandler } from './handlers/announcement/setup';
import { applicationPositionHandler } from './handlers/application/applicationPosition';
import { applicationSetupHandler } from './handlers/application/applicationSetup';
import { archiveMigrationHandler } from './handlers/archiveMigration';
import { botSetupHandler, botSetupNotFound } from './handlers/botSetup';
import { getRolesHandler } from './handlers/getRoles';
import { removeRoleHandler } from './handlers/removeRole';
import { ticketReplyHandler } from './handlers/ticketReply';
import { ticketSetupHandler } from './handlers/ticketSetup';

export const handleSlashCommand = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const user = interaction.user.username;
    const commandName = interaction.commandName;
    const guildId = interaction.guildId;

    // send a log to le console
    logger(`User ${user} has issued a command: ${commandName}`);

    if (!guildId) {
        await interaction.reply({
            content: lang.general.cmdGuildNotFound
        });
        return logger(lang.general.cmdGuildNotFound, 'ERROR');
    }

    // get the bot config
    const botConfigRepo = AppDataSource.getRepository(BotConfig);
    const botConfig = await botConfigRepo.findOneBy({ guildId });

    if (commandName == 'bot-setup') {
        botSetupHandler(client, interaction);
    } else if (!botConfig) {
        botSetupNotFound(client, interaction);
    } else {
        switch (commandName) {
            // setup command
            case 'ticket-setup': {
                ticketSetupHandler(client, interaction);
                break;
            }
            case 'ticket-reply': {
                ticketReplyHandler(client, interaction);
                break;
            }
            case 'add-role': {
                addRoleHandler(client, interaction);
                break;
            }
            case 'remove-role': {
                removeRoleHandler(client, interaction);
                break;
            }
            case 'get-roles': {
                getRolesHandler(client, interaction);
                break;
            }
            case 'archive-migration': {
                archiveMigrationHandler(client, interaction);
                break;
            }
            case 'application-setup': {
                applicationSetupHandler(client, interaction);
                break;
            }
            case 'application-position': {
                applicationPositionHandler(client, interaction);
            }
            case 'announcement-setup': {
                announcementSetupHandler(client, interaction);
                break;
            }
            case 'announcement': {
                announcementHandler(client, interaction);
                break;
            }
        }
    }
};