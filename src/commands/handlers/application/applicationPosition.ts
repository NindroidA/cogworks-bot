/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unused-imports/no-unused-vars */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import { lang } from '../../../utils';

const positionRepo = AppDataSource.getRepository(Position);
const tl = lang.application;

export const applicationPositionHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';

    if (subCommand === 'add') {
        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const template = interaction.options.getString('template');

        let finalTitle: string;
        let finalDescription: string;

        // if template is provided, use that instead of title/description
        if (template) {
            const templateData = getPositionTemplate(template);
            if (!templateData) {
                await interaction.reply({
                    content: '❌ Template not found. Available templates: set_builder',
                    ephemeral: true
                });
                return;
            }
            finalTitle = templateData.title;
            finalDescription = templateData.description;
        } else {
            // use provided title and description
            if (!title || !description) {
                await interaction.reply({
                    content: '❌ Please provide either a template or both title and description.',
                    ephemeral: true
                });
                return;
            }
            finalTitle = title;
            finalDescription = description;
        }

        try {
            // get the highest display order and increment
            const maxOrder = await positionRepo
                .createQueryBuilder('position')
                .select('MAX(position.displayOrder)', 'maxOrder')
                .where('position.guildId = :guildId', { guildId })
                .getRawOne();

            const newPosition = positionRepo.create({
                guildId,
                title: finalTitle,
                description: finalDescription,
                displayOrder: (maxOrder?.maxOrder || 0) + 1
            });

            await positionRepo.save(newPosition);

            await interaction.reply({
                content: `✅ Position "${finalTitle}" added successfully! (ID: ${newPosition.id})`,
                ephemeral: true
            });

            // update the application channel message
            await updateApplicationMessage(interaction.client, guildId);

        } catch (error) {
            console.error('Error adding position:', error);
            await interaction.reply({
                content: '❌ Failed to add position.',
                ephemeral: true
            });
        }
    } else if (subCommand === 'remove') {
        const positionId = interaction.options.getInteger('id', true);

        try {
            const position = await positionRepo.findOne({
                where: { id: positionId, guildId }
            });

            if (!position) {
                await interaction.reply({
                    content: '❌ Position not found.',
                    ephemeral: true
                });
                return;
            }

            await positionRepo.remove(position);

            await interaction.reply({
                content: `✅ Position "${position.title}" removed successfully!`,
                ephemeral: true
            });

            // update the application channel message
            await updateApplicationMessage(interaction.client, guildId);

        } catch (error) {
            console.error('Error removing position:', error);
            await interaction.reply({
                content: '❌ Failed to remove position.',
                ephemeral: true
            });
        }
    } else if (subCommand === 'toggle') {
        const positionId = interaction.options.getInteger('id', true);

        try {
            const position = await positionRepo.findOne({
                where: { id: positionId, guildId }
            });

            if (!position) {
                await interaction.reply({
                    content: '❌ Position not found.',
                    ephemeral: true
                });
                return;
            }

            position.isActive = !position.isActive;
            await positionRepo.save(position);

            await interaction.reply({
                content: `✅ Position "${position.title}" is now ${position.isActive ? 'active' : 'inactive'}.`,
                ephemeral: true
            });

            // update the application channel message
            await updateApplicationMessage(interaction.client, guildId);

        } catch (error) {
            console.error('Error toggling position:', error);
            await interaction.reply({
                content: '❌ Failed to toggle position.',
                ephemeral: true
            });
        }
    } else if (subCommand === 'list') {
        try {
            const positions = await positionRepo.find({
                where: { guildId },
                order: { displayOrder: 'ASC' }
            });

            if (positions.length === 0) {
                await interaction.reply({
                    content: '📋 No positions found.',
                    ephemeral: true
                });
                return;
            }

            const positionList = positions.map(pos => 
                `**${pos.id}** - ${pos.title} ${pos.isActive ? '✅' : '❌'}\n${pos.description.substring(0, 100)}${pos.description.length > 100 ? '...' : ''}`
            ).join('\n\n');

            await interaction.reply({
                content: `📋 **Positions:**\n\n${positionList}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error listing positions:', error);
            await interaction.reply({
                content: '❌ Failed to list positions.',
                ephemeral: true
            });
        }
    } else if (subCommand === 'refresh') {
        try {
            await updateApplicationMessage(interaction.client, guildId);
            
            await interaction.reply({
                content: '✅ Application channel message has been refreshed!',
                ephemeral: true
            });

        } catch (error) {
            console.error('Error refreshing application message:', error);
            await interaction.reply({
                content: '❌ Failed to refresh application message. Make sure the application channel is set up properly.',
                ephemeral: true
            });
        }
    }
};

// function to update the application message with current positions
export async function updateApplicationMessage(client: Client, guildId: string) {
    try {
        const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
        const applicationConfig = await applicationConfigRepo.findOneBy({ guildId });

        if (!applicationConfig) return;

        const channel = await client.channels.fetch(applicationConfig.channelId);
        if (!channel || !channel.isTextBased()) return;

        const message = await channel.messages.fetch(applicationConfig.messageId);
        if (!message) return;

        // get active positions
        const activePositions = await positionRepo.find({
            where: { guildId, isActive: true },
            order: { displayOrder: 'ASC' }
        });

        // build the message content and components
        const { content, components } = await buildApplicationMessage(activePositions);

        await message.edit({
            content,
            components
        });

    } catch (error) {
        console.error('Error updating application message:', error);
    }
}

// helper function to build the application message
export async function buildApplicationMessage(positions: Position[]) {
    let content = '# __Welcome to Job Applications__\n\n';

    if (positions.length === 0) {
        content += '## 🔒 No positions are currently available.';
        return { content, components: [] };
    }

    content += '# 📋 Available Positions:\n\n';

    const components = [];
    const maxButtonsPerRow = 5;
    let currentRow = [];

    for (const position of positions) {
        content += `## __${position.title}__\n` + `${position.description}\n\n`;

        const button = new ButtonBuilder()
            .setCustomId(`apply_${position.id}`)
            .setLabel('Apply')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📝');

        currentRow.push(button);

        // if row is full or this is the last position, add the row
        if (currentRow.length === maxButtonsPerRow || position === positions[positions.length - 1]) {
            components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...currentRow));
            currentRow = [];
        }
    }

    return { content, components };
}

function getPositionTemplate(templateName: string): { title: string; description: string } | null {
    const templates: Record<string, { title: string; description: string }> = {
        'set_builder': {
            title: 'Set Builder',
            description: `**Role Overview:**
As a Set Builder, you'll be responsible for helping to build some of the sets we use. The goal is to create vibrant, visually pleasing sets that our characters can be a part of. You'll be collaborating with the team and a build supervisor to create the sets for scenes in our signature Element Animation style.

**Key Responsibilities:**
To work with the senior set builder to create sets to flow into the next stage of the production process. To be able to create and provide working world files and make edits to them. Be able to keep to the Minecraft Vanilla look. 

**You'll Be a Great Fit If You:** 
• Enjoy set building and bringing worlds to life
• Have experience in Set Building
• Have an understanding of Maya
• Are confident working in Axiom and Worldedit
• Are collaborative, communicative, and love giving and receiving feedback
• Are comfortable working remotely and asynchronously with a small, dedicated team
• Are available for occasional meetings during our office hours (10AM - 6PM (UK Time), Monday - Friday)

**Details:** 
• Type: Freelance
• Location: Remote (At least 2 hours cross-over with our UK team, 10AM-6PM BST)
• Software: Axiom, World Build Start Date: ASAP
• Duration: Project-based

Please include a reel or examples of work once your application is opened.`
        },
    };

    return templates[templateName] || null;
}