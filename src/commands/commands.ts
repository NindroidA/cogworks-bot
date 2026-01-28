import { CacheType, ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { BotConfig } from '../typeorm/entities/BotConfig';
import { createRateLimitKey, enhancedLogger, healthMonitor, lang, LogCategory, logger, rateLimiter, RateLimits } from '../utils';
import { announcementHandler } from './handlers/announcement';
import { announcementSetupHandler } from './handlers/announcement/setup';
import { applicationPositionHandler } from './handlers/application/applicationPosition';
import { applicationSetupHandler } from './handlers/application/applicationSetup';
import { baitChannelHandler } from './handlers/baitChannel';
import { botSetupHandler, botSetupNotFound } from './handlers/botSetup';
import { dataExportHandler } from './handlers/dataExport';
import {
    deleteAllArchivedApplicationsHandler,
    deleteArchivedApplicationHandler
} from './handlers/dev/applicationDev';
import {
    bulkCloseTicketsHandler,
    deleteAllArchivedTicketsHandler,
    deleteArchivedTicketHandler
} from './handlers/dev/ticketDev';
import { migrateApplicationTagsHandler, migrateTicketTagsHandler } from './handlers/migrate';
import { coffeeHandler } from './handlers/coffee';
import { memoryAddHandler, memoryCaptureHandler, memoryDeleteHandler, memoryTagsHandler, memoryUpdateHandler } from './handlers/memory';
import { memorySetupHandler } from './handlers/memorySetup';
import { pingHandler } from './handlers/ping';
import { roleAddHandler, roleListHandler, roleRemoveHandler } from './handlers/role';
import {
    emailImportHandler,
    settingsHandler,
    typeAddHandler,
    typeDefaultHandler,
    typeEditHandler,
    typeFieldsHandler,
    typeListHandler,
    typeRemoveHandler,
    typeToggleHandler,
    userRestrictHandler
} from './handlers/ticket';
import { ticketSetupHandler } from './handlers/ticketSetup';

export const handleSlashCommand = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const startTime = Date.now();
    const user = interaction.user.username;
    const commandName = interaction.commandName;
    const guildId = interaction.guildId;

    // Enhanced logging for command execution
    enhancedLogger.command(
        `/${commandName} executed`,
        interaction.user.id,
        guildId || undefined,
        { username: user, commandName }
    );

    // Global rate limit check (30 commands per minute per user)
    const globalRateLimitKey = createRateLimitKey.globalUser(interaction.user.id);
    const globalRateCheck = rateLimiter.check(globalRateLimitKey, RateLimits.GLOBAL_COMMAND);
    
    if (!globalRateCheck.allowed) {
        await interaction.reply({
            content: globalRateCheck.message,
            flags: [MessageFlags.Ephemeral]
        });
        logger(`User ${user} hit global command rate limit`, 'WARN');
        healthMonitor.recordCommand(commandName, Date.now() - startTime, false);
        return;
    }

    if (!guildId) {
        await interaction.reply({
            content: lang.general.cmdGuildNotFound
        });
        healthMonitor.recordCommand(commandName, Date.now() - startTime, true);
        return logger(lang.general.cmdGuildNotFound, 'ERROR');
    }

    try {
        // get the bot config
        const botConfigRepo = AppDataSource.getRepository(BotConfig);
        const botConfig = await botConfigRepo.findOneBy({ guildId });

        if (commandName == 'bot-setup') {
            await botSetupHandler(client, interaction);
        } else if (!botConfig) {
            await botSetupNotFound(client, interaction);
        } else {
            switch (commandName) {
                // setup command
                case 'ticket-setup': {
                    await ticketSetupHandler(client, interaction);
                    break;
                }
                case 'ticket': {
                    // Route to appropriate subcommand handler
                    const subcommand = interaction.options.getSubcommand();
                    switch (subcommand) {
                        case 'type-add':
                            await typeAddHandler(interaction);
                            break;
                        case 'type-edit':
                            await typeEditHandler(interaction);
                            break;
                        case 'type-list':
                            await typeListHandler(interaction);
                            break;
                        case 'type-toggle':
                            await typeToggleHandler(interaction);
                            break;
                        case 'type-default':
                            await typeDefaultHandler(interaction);
                            break;
                        case 'type-remove':
                            await typeRemoveHandler(interaction);
                            break;
                        case 'type-fields':
                            await typeFieldsHandler(interaction);
                            break;
                        case 'import-email':
                            await emailImportHandler(interaction);
                            break;
                        case 'user-restrict':
                            await userRestrictHandler(interaction);
                            break;
                        case 'settings':
                            await settingsHandler(interaction);
                            break;
                    }
                    break;
                }
                case 'ping': {
                    await pingHandler(interaction);
                    break;
                }
                case 'coffee': {
                    await coffeeHandler(interaction);
                    break;
                }
                case 'memory-setup': {
                    await memorySetupHandler(client, interaction);
                    break;
                }
                case 'memory': {
                    const subcommand = interaction.options.getSubcommand();
                    switch (subcommand) {
                        case 'add':
                            await memoryAddHandler(interaction);
                            break;
                        case 'capture':
                            await memoryCaptureHandler(interaction);
                            break;
                        case 'update':
                            await memoryUpdateHandler(interaction);
                            break;
                        case 'delete':
                            await memoryDeleteHandler(interaction);
                            break;
                        case 'tags':
                            await memoryTagsHandler(interaction);
                            break;
                    }
                    break;
                }
                case 'role': {
                    // Route to appropriate role subcommand handler
                    const subcommandGroup = interaction.options.getSubcommandGroup(false);
                    const subcommand = interaction.options.getSubcommand();

                    if (subcommandGroup === 'add') {
                        await roleAddHandler(interaction);
                    } else if (subcommandGroup === 'remove') {
                        await roleRemoveHandler(interaction);
                    } else if (subcommand === 'list') {
                        await roleListHandler(interaction);
                    }
                    break;
                }
                case 'application-setup': {
                    await applicationSetupHandler(client, interaction);
                    break;
                }
                case 'application': {
                    // Route to appropriate application subcommand handler
                    const appSubcommandGroup = interaction.options.getSubcommandGroup(false);
                    if (appSubcommandGroup === 'position') {
                        await applicationPositionHandler(client, interaction);
                    }
                    break;
                }
                case 'announcement-setup': {
                    await announcementSetupHandler(client, interaction);
                    break;
                }
                case 'announcement': {
                    await announcementHandler(client, interaction);
                    break;
                }
                case 'baitchannel': {
                    await baitChannelHandler(client, interaction);
                    break;
                }
                case 'data-export': {
                    await dataExportHandler(client, interaction);
                    break;
                }
                case 'dev': {
                    // Route to appropriate subcommand handler
                    const subcommand = interaction.options.getSubcommand();
                    switch (subcommand) {
                        case 'bulk-close-tickets':
                            await bulkCloseTicketsHandler(interaction);
                            break;
                        case 'delete-archived-ticket':
                            await deleteArchivedTicketHandler(interaction);
                            break;
                        case 'delete-all-archived-tickets':
                            await deleteAllArchivedTicketsHandler(interaction);
                            break;
                        case 'delete-archived-application':
                            await deleteArchivedApplicationHandler(interaction);
                            break;
                        case 'delete-all-archived-applications':
                            await deleteAllArchivedApplicationsHandler(interaction);
                            break;
                    }
                    break;
                }
                case 'migrate': {
                    // Route to appropriate subcommand handler
                    const subcommand = interaction.options.getSubcommand();
                    switch (subcommand) {
                        case 'ticket-tags':
                            await migrateTicketTagsHandler(interaction);
                            break;
                        case 'application-tags':
                            await migrateApplicationTagsHandler(interaction);
                            break;
                    }
                    break;
                }
            }
        }
        
        // Record successful command execution
        const executionTime = Date.now() - startTime;
        healthMonitor.recordCommand(commandName, executionTime, false);
        enhancedLogger.performance(
            `Command /${commandName} completed`,
            executionTime,
            { userId: interaction.user.id, guildId }
        );
        
    } catch (error) {
        // Record failed command execution
        const executionTime = Date.now() - startTime;
        healthMonitor.recordCommand(commandName, executionTime, true);
        healthMonitor.recordError(`Command failed: ${commandName}`, 'COMMAND');
        
        enhancedLogger.error(
            `Command /${commandName} failed`,
            error as Error,
            LogCategory.COMMAND_EXECUTION,
            { userId: interaction.user.id, guildId, commandName }
        );
        
        // Inform the user
        try {
            await interaction.reply({
                content: '❌ An error occurred while executing this command. Please try again later.',
                flags: [MessageFlags.Ephemeral]
            });
        } catch {
            // Interaction may have already been replied to
        }
    }
};