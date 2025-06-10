/* eslint-disable @typescript-eslint/no-explicit-any */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CacheType, ChatInputCommandInteraction, Client, ComponentType, EmbedBuilder, RoleSelectMenuBuilder } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { BotConfig } from '../../typeorm/entities/BotConfig';
import { lang } from '../../utils';

const tlC = lang.botConfig;
const tl = lang.botSetup;

export const botSetupNotFound = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    console.log(tlC.notFound);
    return await interaction.reply({
        content: tlC.notFound,
        ephemeral: true
    });
};

const TIMEOUT = 60_000; // 1 minute timeout

// initial embed
const embed1 = new EmbedBuilder()
    .setTitle('Cogworks Bot Setup')
    .setDescription(tl.select1)
    .setColor('#5A97FA');

// buttons for initial embed
const buttons1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
        .setCustomId('enable_staff_role')
        .setLabel('Enable')
        .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
        .setCustomId('disable_staff_role')
        .setLabel('Disable')
        .setStyle(ButtonStyle.Danger)
);

// role selector dropbox
const roleDropbox = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
    new RoleSelectMenuBuilder()
        .setCustomId('staff_role_select')
        .setPlaceholder('Choose a role')
        .setMinValues(1)
        .setMaxValues(1)
);

export const botSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    try {
        const guildId = interaction.guildId;
        if (!guildId) { throw new Error(lang.general.cmdGuildNotFound); }

        const botConfigRepo = AppDataSource.getRepository(BotConfig);
        const botConfig = await botConfigRepo.findOneBy({ guildId });

        if (botConfig) {
            return handleExistingConfig(interaction, botConfig);
        }

        // initial setup message
        const setupMessage = await interaction.reply({
            embeds: [embed1],
            components: [buttons1],
            ephemeral: true,
        });

        // button interaction collector
        const buttonCollector = setupMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: TIMEOUT,
            filter: i => i.user.id === interaction.user.id
        });

        buttonCollector.on('collect', async buttonInteraction => {
            try {
                if (buttonInteraction.customId === 'disable_staff_role') {
                    await saveConfig(buttonInteraction, { guildId, enableGlobalStaffRole: false });
                    return buttonCollector.stop();
                }

                // role selection
                const roleMessage = await buttonInteraction.update({
                    content: 'Select staff role:',
                    components: [roleDropbox],
                    embeds: []
                });

                // role selection collector
                const roleCollector = roleMessage.createMessageComponentCollector({
                    componentType: ComponentType.RoleSelect,
                    time: TIMEOUT,
                    filter: i => i.user.id === interaction.user.id
                });

                roleCollector.on('collect', async roleInteraction => {
                    const role = roleInteraction.roles.first();
                    if (!role) {
                        await roleInteraction.update({ 
                            content: tl.noRoleSelected, 
                            components: [] 
                        });
                        buttonCollector.stop();
                        return roleCollector.stop();
                    }

                    await saveConfig(roleInteraction, { 
                        guildId, 
                        enableGlobalStaffRole: true, 
                        globalStaffRole: role.toString() 
                    });
                    buttonCollector.stop();
                    roleCollector.stop();
                });

                roleCollector.on('end', async () => {
                    if (roleCollector.endReason !== 'time') return;
                    await roleMessage.edit({ 
                        content: tl.roleSelectTimeout, 
                        components: [] 
                    });
                });

            } catch (error) {
                console.error('Button handler error:', error);
                await buttonInteraction.followUp({ 
                    content: tl.error, 
                    ephemeral: true 
                });
            }
        });

        buttonCollector.on('end', async (collected, reason) => {
            if (reason !== 'time') return;
            // update the message, remove components and embeds
            await setupMessage.edit({ 
                content: tl.timeout, 
                components: [],
                embeds: []
            });
        });

    } catch (error) {
        console.error('Setup error:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(tl.fail);
        } else {
            await interaction.reply({ 
                content: tl.fail, 
                ephemeral: true 
            });
        }
    }
};

async function saveConfig(interaction: any, config: Partial<BotConfig>) {
    const repo = AppDataSource.getRepository(BotConfig);
    await repo.save(repo.create(config));
    await interaction.update({
        content: `✅ Config saved: ${config.enableGlobalStaffRole ? 
            `Staff role enabled (${config.globalStaffRole})` : 
            'Staff role disabled'}`,
        components: [],
        embeds: []
    });
    // TODO: add log that new config was updated and handle command registering
}

async function updateConfig(interaction: any, config: BotConfig) {
    const repo = AppDataSource.getRepository(BotConfig);
    await repo.save(config);
    await interaction.update({
        content: `✅ Config updated: ${config.enableGlobalStaffRole ? 
            `Staff role enabled (${config.globalStaffRole})` : 
            'Staff role disabled'}`,
        components: [],
        embeds: []
    });
}

async function handleExistingConfig(interaction: ChatInputCommandInteraction<CacheType>, config: BotConfig) {
    const guildId = interaction.guildId;
    if (!guildId) throw new Error(lang.general.cmdGuildNotFound);

    // existing config setup
    const setupMessage = await interaction.reply({
        embeds: [embed1],
        components: [buttons1],
        ephemeral: true,
    });

    // button interaction collector
    const buttonCollector = setupMessage.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: TIMEOUT,
        filter: i => i.user.id === interaction.user.id
    });

    buttonCollector.on('collect', async buttonInteraction => {
        try {
            if (buttonInteraction.customId === 'disable_staff_role') {
                config.enableGlobalStaffRole = false;
                await updateConfig(buttonInteraction, config);
                return buttonCollector.stop();
            }

            // role selection
            const roleMessage = await buttonInteraction.update({
                content: tl.select2,
                components: [roleDropbox],
                embeds: []
            });

            // Role selection collector
            const roleCollector = roleMessage.createMessageComponentCollector({
                componentType: ComponentType.RoleSelect,
                time: TIMEOUT,
                filter: i => i.user.id === interaction.user.id
            });

            roleCollector.on('collect', async roleInteraction => {
                const role = roleInteraction.roles.first();
                if (!role) {
                    await roleInteraction.update({ 
                        content: 'No role selected', 
                        components: [] 
                    });
                    buttonCollector.stop();
                    return roleCollector.stop();
                }

                config.enableGlobalStaffRole = true;
                config.globalStaffRole = role.toString();

                await updateConfig(roleInteraction, config);
                
                buttonCollector.stop();
                roleCollector.stop();
            });

            roleCollector.on('end', async () => {
                if (roleCollector.endReason !== 'time') return;
                await roleMessage.edit({ 
                    content: tl.timeout, 
                    components: [] 
                });
            });
        } catch (error) {
            console.error('Button handler error:', error);
            await buttonInteraction.followUp({ 
                content: tl.error, 
                ephemeral: true 
            });
        }
    });
}