import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GuildMember, Interaction, ModalBuilder, PermissionFlagsBits, TextChannel, TextInputBuilder, TextInputStyle } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { Application } from '../typeorm/entities/application/Application';
import { ApplicationConfig } from '../typeorm/entities/application/ApplicationConfig';
import { Position } from '../typeorm/entities/application/Position';
import { SavedRole } from '../typeorm/entities/SavedRole';
import { extractIdFromMention, lang, logger } from '../utils';
import { applicationCloseEvent } from './application/close';

const tl = lang.application;
const pl = lang.application.position;
const applicationRepo = AppDataSource.getRepository(Application);
const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
const positionRepo = AppDataSource.getRepository(Position);
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const handleApplicationInteraction = async(client: Client, interaction: Interaction) => {
    const user = interaction.user.username;
    const guildId = interaction.guildId || '';
    const applicationConfig = await applicationConfigRepo.findOneBy({ guildId });

    /* Apply Button for Specific Position */
    if (interaction.isButton() && interaction.customId.startsWith('apply_')) {
        const positionId = parseInt(interaction.customId.replace('apply_', ''));
        logger(`User ${user} is applying for position ${positionId}`);

        // get the position details
        const position = await positionRepo.findOne({
            where: { id: positionId, guildId, isActive: true }
        });

        if (!position) {
            await interaction.reply({
                content: pl.notAvailable,
                ephemeral: true
            });
            return;
        }

        // age verification buttons
        const ageVerificationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`age_verify_yes_${positionId}`)
                .setLabel(pl.ageVerifyYes)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`age_verify_no_${positionId}`)
                .setLabel(pl.ageVerifyNo)
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.reply({
            content: `🔞 **Age Verification Required**\n\nTo apply for the **${position.title}** position, you must be 18 years or older.\n\nAre you 18 or older?`,
            components: [ageVerificationRow],
            ephemeral: true
        });
    }

    /* Age Verification - Yes */
    if (interaction.isButton() && interaction.customId.startsWith('age_verify_yes_')) {
        const positionId = parseInt(interaction.customId.replace('age_verify_yes_', ''));
        logger(`User ${user} verified they are 18+ for position ${positionId}`);

        // get position details
        const position = await positionRepo.findOne({
            where: { id: positionId, guildId, isActive: true }
        });

        if (!position) {
            await interaction.update({
                content: pl.notAvailable,
                components: []
            });
            return;
        }

        // application modal
        const modal = new ModalBuilder()
            .setCustomId(`application_modal_${positionId}`)
            .setTitle(`Apply for ${position.title}`);

        // name input
        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel(pl.modal.name)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        // experience input
        const experienceInput = new TextInputBuilder()
            .setCustomId('experience')
            .setLabel(pl.modal.experience)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
            .setPlaceholder(pl.modal.experienceP);

        // why you want it input
        const whyInput = new TextInputBuilder()
            .setCustomId('why_position')
            .setLabel(pl.modal.why)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000)
            .setPlaceholder(pl.modal.whyP);

        // availability input
        const availabilityInput = new TextInputBuilder()
            .setCustomId('availability')
            .setLabel(pl.modal.availability)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500)
            .setPlaceholder(pl.modal.availabilityP);

        // location/country input
        const locationInput = new TextInputBuilder()
            .setCustomId('location')
            .setLabel(pl.modal.location)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder(pl.modal.locationP);

        const nameActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput);
        const experienceActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(experienceInput);
        const whyActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(whyInput);
        const locationActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(locationInput);
        const availabilityActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(availabilityInput);

        modal.addComponents(nameActionRow, experienceActionRow, whyActionRow, locationActionRow, availabilityActionRow);

        await interaction.showModal(modal);
    }

    /* Age Verification - No */
    if (interaction.isButton() && interaction.customId.startsWith('age_verify_no_')) {
        const positionId = parseInt(interaction.customId.replace('age_verify_no_', ''));
        logger(`User ${user} is under 18 for position ${positionId}`);

        await interaction.update({
            content: pl.ageVerifyNoReply,
            components: []
        });
    }

    /* Cancel Application Button */
    if (interaction.isButton() && interaction.customId === 'cancel_application') {
        logger(`User ${user} ` + lang.console.cancelApplicationRequest);

        await interaction.reply({
            content: tl.cancelled,
            ephemeral: true
        });
    }

    /* Handle Application Modal Submission */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('application_modal_')) {
        const positionId = parseInt(interaction.customId.replace('application_modal_', ''));
        const member = interaction.member as GuildMember;
        const guild = interaction.guild;
        const category = applicationConfig?.categoryId;

        logger(`User ${user} submitting application for position ${positionId}`);

        // guild check
        if (!guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                ephemeral: true,
            });
            return;
        }

        // make sure we have the category set
        if (!category) {
            await interaction.reply({
                content: tl.applicationCategoryNotFound,
                ephemeral: true,
            });
            return;
        }

        // Get the position details
        const position = await positionRepo.findOne({
            where: { id: positionId, guildId, isActive: true }
        });

        if (!position) {
            await interaction.reply({
                content: pl.notAvailable,
                ephemeral: true
            });
            return;
        }

        try {
            // get user input from modal
            const fields = interaction.fields;
            const name = fields.getTextInputValue('name');
            const experience = fields.getTextInputValue('experience');
            const whyPosition = fields.getTextInputValue('why_position');
            const location = fields.getTextInputValue('location');
            const availability = fields.getTextInputValue('availability');

            // Split application into multiple parts to avoid 2000 char limit
            const description = `## 📋 Application for ${position.title}

**Applicant:** ${name}
**Discord:** ${member.user.tag}
**Location:** ${location}`;

            const experienceMsg = `**Experience:**
${experience}`;

            const whyPositionMsg = `**Why this position:**
${whyPosition}`;

            const availabilityMsg = `**Availability:**
${availability}`;

            // create new application in the database
            const newApplication = applicationRepo.create({
                createdBy: interaction.user.id,
                type: `position_${positionId}`,
            });
            const savedApplication = await applicationRepo.save(newApplication);

            // create the application channel
            const channelName = `${savedApplication.id}-${position.title.toLowerCase().replace(/\s+/g, '-')}-${member.user.username}`;

            // get the admin roles from the database
            const rolePerms = await savedRoleRepo.createQueryBuilder()
                .select(['role'])
                .where('guildId = :guildId', { guildId: guildId })
                .andWhere('type = :type', { type: 'admin' })
                .getRawMany();

            // base perms
            const permOverwrites = [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // deny everyone
                { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.AddReactions, PermissionFlagsBits.UseExternalEmojis, PermissionFlagsBits.EmbedLinks] }, // allow applicant
            ];

            // add permissions for each admin role
            rolePerms.forEach(role => {
                const roleId = extractIdFromMention(role.role);
                if (!roleId) {
                    logger(`Invalid role format: ${role.role}`);
                    return; // skip this role
                }

                permOverwrites.push(
                    { id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.AddReactions, PermissionFlagsBits.UseExternalEmojis] }
                );
            });

            // create the channel with all perms
            const channel = await guild.channels.create({
                name: channelName,
                type: 0, // text channel
                parent: category, // category
                permissionOverwrites: permOverwrites,
            });

            await interaction.reply({
                content: `✅ Your application has been submitted! Please check ${channel} for updates.`,
                ephemeral: true,
            });

            // send application welcome message
            const welcomeMsg = `👋 Welcome, ${member.user.displayName}! Your application for **${position.title}** has been received.\n\n Our team will review your application and get back to you soon. Feel free to ask any questions here!\n`;
            
            const buttonOptions = new ActionRowBuilder<ButtonBuilder>().setComponents(
                new ButtonBuilder()
                    .setCustomId('close_application')
                    .setLabel('Close Application')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );

            const newChannel = channel as TextChannel;

            const welc = await newChannel.send({
                content: welcomeMsg,
                components: [buttonOptions],
            });
            
            // Send application info in separate messages to avoid 2000 character limit
            await newChannel.send({
                content: description
            });

            await newChannel.send({
                content: experienceMsg
            });

            await newChannel.send({
                content: whyPositionMsg
            });

            await newChannel.send({
                content: availabilityMsg
            });

            await newChannel.send({
                content: `${member.user} Please remember to include any reels, images, or any examples of your work!`
            });

            // update application record
            applicationRepo.update({ id: savedApplication.id }, {
                messageId: welc.id,
                channelId: newChannel.id,
                status: 'opened',
            });

            logger(`User ${user} successfully created application for position ${positionId}`);

        } catch (error) {
            logger(tl.error + error, 'ERROR');
            
            // Only reply if we haven't already replied
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: tl.failCreate,
                    ephemeral: true
                });
            }
            return;
        }
    }

    /* Closing Application Button */
    if (interaction.isButton() && interaction.customId === 'close_application') {
        logger(`User ${user} ` + lang.console.closeApplicationAttempt);

        // build a confirmation message with buttons
        const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_close_application')
                .setLabel(tl.close.closingL)
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_close_application')
                .setLabel(tl.close.cancelL)
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: tl.close.confirm,
            components: [confirmRow],
            ephemeral: true,
        });
    }

    /* Confirm Close Application */
    if (interaction.isButton() && interaction.customId === 'confirm_close_application') {
        logger(`User ${user} ` + lang.console.closeApplicationConfirm);
        await interaction.update({
            content: tl.close.closing,
            components: [],
        });
        await applicationCloseEvent(client, interaction);
    }

    /* Cancel Close Application */
    if (interaction.isButton() && interaction.customId === 'cancel_close_application') {
        logger(`User ${user} ` + lang.console.closeApplicationCancel);
        await interaction.update({
            content: tl.close.cancel,
            components: [],
        });
    }

};