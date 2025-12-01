 
 
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CacheType, ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import { createRateLimitKey, lang, LANGF, logger, rateLimiter, RateLimits, requireAdmin } from '../../../utils';

const positionRepo = AppDataSource.getRepository(Position);
const pl = lang.application.position;

export const applicationPositionHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';

    // Permission check - admin only
    const permissionCheck = requireAdmin(interaction);
    if (!permissionCheck.allowed) {
        await interaction.reply({
            content: permissionCheck.message,
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Unauthorized application position operation attempt by user ${interaction.user.id} in guild ${guildId}`, 'WARN');
        return;
    }

    // Rate limit check (15 position operations per hour per guild)
    const rateLimitKey = createRateLimitKey.guild(guildId, 'application-position');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.APPLICATION_POSITION);
    
    if (!rateCheck.allowed) {
        await interaction.reply({
            content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Rate limit exceeded for application position in guild ${guildId}`, 'WARN');
        return;
    }

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
                    content: pl.templateNotFound,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }
            finalTitle = templateData.title;
            finalDescription = templateData.description;
        } else {
            // use provided title and description
            if (!title || !description) {
                await interaction.reply({
                    content: pl.provideEither,
                    flags: [MessageFlags.Ephemeral]
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
                flags: [MessageFlags.Ephemeral]
            });

            // update the application channel message
            await updateApplicationMessage(interaction.client, guildId);

        } catch (error) {
            logger(pl.failAdd + error, 'ERROR');
            await interaction.reply({
                content: pl.failAdd,
                flags: [MessageFlags.Ephemeral]
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
                    content: pl.notFound,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            await positionRepo.remove(position);

            await interaction.reply({
                content: `✅ Position "${position.title}" removed successfully!`,
                flags: [MessageFlags.Ephemeral]
            });

            // update the application channel message
            await updateApplicationMessage(interaction.client, guildId);

        } catch (error) {
            logger(pl.failRemove + error, 'ERROR');
            await interaction.reply({
                content: pl.failRemove,
                flags: [MessageFlags.Ephemeral]
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
                    content: pl.notFound,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            position.isActive = !position.isActive;
            await positionRepo.save(position);

            await interaction.reply({
                content: `✅ Position "${position.title}" is now ${position.isActive ? 'active' : 'inactive'}.`,
                flags: [MessageFlags.Ephemeral]
            });

            // update the application channel message
            await updateApplicationMessage(interaction.client, guildId);

        } catch (error) {
            logger(pl.failToggle + error, 'ERROR');
            await interaction.reply({
                content: pl.failToggle,
                flags: [MessageFlags.Ephemeral]
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
                    content: pl.noneFound,
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            const positionList = positions.map(pos => 
                `**${pos.id}** - ${pos.title} ${pos.isActive ? '✅' : '❌'}\n${pos.description.substring(0, 100)}${pos.description.length > 100 ? '...' : ''}`
            ).join('\n\n');

            await interaction.reply({
                content: `📋 **Positions:**\n\n${positionList}`,
                flags: [MessageFlags.Ephemeral]
            });

        } catch (error) {
            logger(pl.failList + error, 'ERROR');
            await interaction.reply({
                content: pl.failList,
                flags: [MessageFlags.Ephemeral]
            });
        }
    } else if (subCommand === 'refresh') {
        try {
            await updateApplicationMessage(interaction.client, guildId);
            
            await interaction.reply({
                content: pl.successRefresh,
                flags: [MessageFlags.Ephemeral]
            });

        } catch (error) {
            logger(pl.failRefresh + error, 'ERROR');
            await interaction.reply({
                content: pl.failRefresh,
                flags: [MessageFlags.Ephemeral]
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
        logger(pl.failUpdate + error, 'ERROR');
    }
}

// helper function to build the application message
export async function buildApplicationMessage(positions: Position[]) {
    let content = '# __Welcome to Job Applications__\n\n';

    if (positions.length === 0) {
        content += pl.noneAvailable;
        return { content, components: [] };
    }

    content += pl.available;

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
• Are confident working in Axiom and Worldedit
• Are collaborative, communicative, and love giving and receiving feedback
• Are comfortable working remotely and asynchronously with a small, dedicated team
• Are available for occasional meetings during our office hours (10AM - 6PM (UK Time), Monday - Friday)

**Details:** 
• Type: Freelance
• Location: Remote (At least 2 hours cross-over with our UK team, 10AM-6PM BST)
• Software: Axiom, World Build 
• Start Date: ASAP
• Duration: Project-based

Please include a reel or examples of work once your application is opened.`
        },
    };

    return templates[templateName] || null;
}