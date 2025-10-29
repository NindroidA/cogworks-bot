import { PermissionsBitField, SlashCommandBuilder, SlashCommandSubcommandBuilder } from 'discord.js';
import { lang } from '../../utils';

const tl = lang.announcement;

/* subcommands */
const maintenance = new SlashCommandSubcommandBuilder()
    .setName('maintenance')
    .setDescription(tl.maintenance.cmdDescrp)
    .addStringOption((option) => option
        .setName('duration')
        .setDescription(tl.maintenance.duration.cmdDescrp)
        .setRequired(true)
        .addChoices(
            { name: tl.maintenance.duration.short.name, value: tl.maintenance.duration.short.value },
            { name: tl.maintenance.duration.long.name, value: tl.maintenance.duration.long.value }
        )
    )
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.channel)
        .setRequired(false)
    );

const maintenanceScheduled = new SlashCommandSubcommandBuilder()
    .setName('maintenance-scheduled')
    .setDescription(tl.maintenance.scheduled.cmdDescrp)
    .addStringOption((option) => option
        .setName('time')
        .setDescription(tl['update-scheduled'].time.cmdDescrp)
        .setRequired(true)
        .setMinLength(19)
        .setMaxLength(22)
    )
    .addStringOption((option) => option
        .setName('duration')
        .setDescription(tl.maintenance.duration.cmdDescrp)
        .setRequired(true)
        .addChoices(
            { name: tl.maintenance.duration.short.name, value: tl.maintenance.duration.short.value },
            { name: tl.maintenance.duration.long.name, value: tl.maintenance.duration.long.value }
        )
    )
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.channel)
        .setRequired(false)
    );

const backOnline = new SlashCommandSubcommandBuilder()
    .setName('back-online')
    .setDescription(tl['back-online'].cmdDescrp)
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.channel)
        .setRequired(false)
    );

const updateScheduled = new SlashCommandSubcommandBuilder()
    .setName('update-scheduled')
    .setDescription(tl['update-scheduled'].cmdDescrp)
    .addStringOption((option) => option
        .setName('version')
        .setDescription(tl['update-scheduled'].version.cmdDescrp)
        .setRequired(true)
    )
    .addStringOption((option) => option
        .setName('time')
        .setDescription(tl['update-scheduled'].time.cmdDescrp)
        .setRequired(true)
        .setMinLength(19)
        .setMaxLength(22)
    )
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.channel)
        .setRequired(false)
    );

const updateComplete = new SlashCommandSubcommandBuilder()
    .setName('update-complete')
    .setDescription(tl['update-complete'].cmdDescrp)
    .addStringOption((option) => option
        .setName('version')
        .setDescription(tl['update-scheduled'].version.cmdDescrp)
        .setRequired(true)
    )
    .addChannelOption((option) => option
        .setName('channel')
        .setDescription(tl.channel)
        .setRequired(false)
    );

/* main slash command */
export const announcement = new SlashCommandBuilder()
    .setName('announcement')
    .setDescription(tl.cmdDescrp)
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addSubcommand(maintenance)
    .addSubcommand(maintenanceScheduled)
    .addSubcommand(backOnline)
    .addSubcommand(updateScheduled)
    .addSubcommand(updateComplete)
    .toJSON();
