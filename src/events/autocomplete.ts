import { AutocompleteInteraction, Client } from 'discord.js';
import { ticketTypeAutocomplete } from '../commands/handlers/ticket/typeToggle';

/**
 * Handles autocomplete interactions for all commands
 */
export const handleAutocomplete = async (client: Client, interaction: AutocompleteInteraction) => {
    const commandName = interaction.commandName;
    
    try {
        // Route to appropriate autocomplete handler
        switch (commandName) {
            case 'ticket': {
                // All ticket subcommands that use type autocomplete
                const subcommand = interaction.options.getSubcommand();
                if (subcommand === 'type-edit' || 
                    subcommand === 'type-toggle' || 
                    subcommand === 'type-default' ||
                    subcommand === 'type-remove' ||
                    subcommand === 'type-fields') {
                    await ticketTypeAutocomplete(interaction);
                }
                break;
            }
        }
    } catch (error) {
        console.error('Autocomplete error:', error);
        // Fail silently for autocomplete
        try {
            await interaction.respond([]);
        } catch {
            // Already responded or interaction expired
        }
    }
};
