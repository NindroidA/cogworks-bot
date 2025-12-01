import { ActionRowBuilder,
    ChannelType,
    ChatInputCommandInteraction,
    DiscordAPIError,
    EmbedBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionsBitField,
    TextInputBuilder,
    TextInputStyle, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { handleInteractionError, lang, LANGF } from '../../../utils';

const tl = lang.ticket.customTypes.emailImport;

/**
 * Handler for /ticket import-email command
 * Shows modal for importing an email as a ticket
 */
export async function emailImportHandler(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        if (!interaction.guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Create modal
        const modal = new ModalBuilder()
            .setCustomId('ticket-email-import-modal')
            .setTitle(tl.modalTitle);

        const senderEmailInput = new TextInputBuilder()
            .setCustomId('senderEmail')
            .setLabel(tl.senderEmailLabel)
            .setPlaceholder(tl.senderEmailPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(254); // RFC 5321 max email length

        const senderNameInput = new TextInputBuilder()
            .setCustomId('senderName')
            .setLabel(tl.senderNameLabel)
            .setPlaceholder(tl.senderNamePlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100);

        const subjectInput = new TextInputBuilder()
            .setCustomId('subject')
            .setLabel(tl.subjectLabel)
            .setPlaceholder(tl.subjectPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(256); // Discord channel topic max

        const bodyInput = new TextInputBuilder()
            .setCustomId('body')
            .setLabel(tl.bodyLabel)
            .setPlaceholder(tl.bodyPlaceholder)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000); // Discord modal max

        const attachmentsInput = new TextInputBuilder()
            .setCustomId('attachments')
            .setLabel(tl.attachmentsLabel)
            .setPlaceholder(tl.attachmentsPlaceholder)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(2000);

        const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(senderEmailInput);
        const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(senderNameInput);
        const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput);
        const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput);
        const row5 = new ActionRowBuilder<TextInputBuilder>().addComponents(attachmentsInput);

        modal.addComponents(row1, row2, row3, row4, row5);

        await interaction.showModal(modal);
    } catch (error) {
        await handleInteractionError(interaction, error, 'emailImportHandler');
    }
}

/**
 * Handler for ticket email import modal submission
 */
export async function emailImportModalHandler(interaction: ModalSubmitInteraction): Promise<void> {
    try {
        if (!interaction.guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const guildId = interaction.guild.id;

        // Get modal inputs
        const senderEmail = interaction.fields.getTextInputValue('senderEmail').trim();
        const senderName = interaction.fields.getTextInputValue('senderName')?.trim() || null;
        const subject = interaction.fields.getTextInputValue('subject').trim();
        const body = interaction.fields.getTextInputValue('body').trim();
        const attachmentsInput = interaction.fields.getTextInputValue('attachments')?.trim() || '';

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(senderEmail)) {
            await interaction.reply({
                content: tl.invalidEmail,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Validate email body length
        if (body.length > 4000) {
            await interaction.reply({
                content: LANGF(tl.bodyTooLong, '4000'),
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Parse and validate attachment URLs
        const attachmentUrls: string[] = [];
        if (attachmentsInput) {
            const urls = attachmentsInput.split('\n').map(u => u.trim()).filter(u => u);

            if (urls.length > 10) {
                await interaction.reply({
                    content: LANGF(tl.tooManyUrls, '10'),
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }

            for (const url of urls) {
                if (url.length > 500) {
                    await interaction.reply({
                        content: LANGF(tl.urlTooLong, '500'),
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }

                try {
                    new URL(url); // Validate URL format
                    attachmentUrls.push(url);
                } catch {
                    await interaction.reply({
                        content: LANGF(tl.invalidUrl, url),
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }
            }
        }

        // Get bot and ticket config
        const botConfigRepo = AppDataSource.getRepository(BotConfig);
        const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
        const ticketRepo = AppDataSource.getRepository(Ticket);
        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        const botConfig = await botConfigRepo.findOneBy({ guildId });
        if (!botConfig) {
            await interaction.reply({
                content: lang.botConfig.notFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
        if (!ticketConfig || !ticketConfig.categoryId) {
            await interaction.reply({
                content: lang.ticket.ticketConfigNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Get default ticket type or create "email" type
        let emailType = await typeRepo.findOne({
            where: { guildId, typeId: 'email_import' }
        });

        if (!emailType) {
            // Create email import type if it doesn't exist
            emailType = typeRepo.create({
                guildId,
                typeId: 'email_import',
                displayName: 'Email Import',
                emoji: '📧',
                embedColor: '#7289da',
                description: 'Ticket imported from email',
                isActive: true,
                isDefault: false,
                sortOrder: 999
            });
            await typeRepo.save(emailType);
        }

        // Get ticket category
        const category = await interaction.guild.channels.fetch(ticketConfig.categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            await interaction.reply({
                content: lang.ticket.ticketCategoryNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Truncate subject to 100 chars for channel name
        const channelName = `📧-${subject.substring(0, 100).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

        try {
            // Create ticket channel
            const ticketChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category.id,
                topic: subject.substring(0, 256),
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel]
                    },
                    {
                        id: botConfig.globalStaffRole!,
                        allow: [
                            PermissionsBitField.Flags.ViewChannel,
                            PermissionsBitField.Flags.SendMessages,
                            PermissionsBitField.Flags.ReadMessageHistory
                        ]
                    }
                ]
            });

            // Create embed for email content
            const embed = new EmbedBuilder()
                .setTitle(`📧 Email Import: ${subject}`)
                .setColor(emailType.embedColor as `#${string}`)
                .setDescription(body.substring(0, 4096))
                .addFields(
                    { name: 'From', value: senderName ? `${senderName} <${senderEmail}>` : senderEmail, inline: true },
                    { name: 'Imported By', value: `<@${interaction.user.id}>`, inline: true }
                )
                .setTimestamp();

            if (attachmentUrls.length > 0) {
                embed.addFields({
                    name: 'Attachments',
                    value: attachmentUrls.map((url, i) => `[Attachment ${i + 1}](${url})`).join('\n')
                });
            }

            const welcomeMessage = await ticketChannel.send({ embeds: [embed] });

            // Save ticket to database
            const ticket = ticketRepo.create({
                guildId,
                channelId: ticketChannel.id,
                messageId: welcomeMessage.id,
                createdBy: interaction.user.id,
                type: 'email_import',
                customTypeId: 'email_import',
                isEmailTicket: true,
                emailSender: senderEmail,
                emailSenderName: senderName || undefined,
                emailSubject: subject,
                status: 'created'
            });

            await ticketRepo.save(ticket);

            await interaction.reply({
                content: LANGF(tl.success, ticketChannel.toString()),
                flags: [MessageFlags.Ephemeral]
            });
        } catch (error) {
            if (error instanceof DiscordAPIError) {
                if (error.code === 50013) {
                    await interaction.reply({
                        content: tl.permissionError,
                        flags: [MessageFlags.Ephemeral]
                    });
                    return;
                }

                await interaction.reply({
                    content: LANGF(tl.apiError, error.message),
                    flags: [MessageFlags.Ephemeral]
                });
                return;
            }
            throw error;
        }
    } catch (error) {
        await handleInteractionError(interaction, error, 'emailImportModalHandler');
    }
}
