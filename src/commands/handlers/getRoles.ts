import { CacheType, ChatInputCommandInteraction, Client, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { SavedRole } from '../../typeorm/entities/SavedRole';
import { createRateLimitKey, lang, LANGF, logger, rateLimiter, RateLimits, requireAdmin } from '../../utils';

const tl = lang.getRoles;
const savedRoleRepo = AppDataSource.getRepository(SavedRole);

export const getRolesHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    // Require admin permissions
    if (!await requireAdmin(interaction)) return;

    const guildId = interaction.guildId || '';
    
    // Rate limit check (user-scoped: 10 operations per hour)
    const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'get-roles');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ROLE_SAVE);
    
    if (!rateCheck.allowed) {
        await interaction.reply({
            content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Rate limit exceeded for get-roles command by user ${interaction.user.id}`, 'WARN');
        return;
    }
    
    const guildFinder = await savedRoleRepo.findOneBy({ guildId });

    // check to see if the discord server has any saved roles
    if (!guildFinder) {
        await interaction.reply({
            content: tl.noGuild,
            flags: [MessageFlags.Ephemeral],
        });
        return;
    }

    try {
        // message that'll be formatted
        let message = '';

        // select the saved roles for the guild
        const foundRoles = await savedRoleRepo.createQueryBuilder()
        .select('type')
        .addSelect('role')
        .addSelect('alias')
        .where('guildId = :guildId', { guildId: guildId })
        .getRawMany();

        // group roles by type
        const roleGroups: Record<string, {alias: string, role: string}[]> = {};
        foundRoles.forEach(role => {
            if (!roleGroups[role.type]) {
                roleGroups[role.type] = [];
            }
            roleGroups[role.type].push({
                alias: role.alias,
                role: role.role
            });
        });

        // format staff roles
        if (roleGroups['staff']) {
            message += '**Staff Roles:**\n';
            roleGroups['staff'].forEach(r => {
                message += `* ${r.alias} - ${r.role}\n`;
            });
            message += '\n';
        }

        // format admin roles
        if (roleGroups['admin']) {
            message += '**Admin Roles:**\n';
            roleGroups['admin'].forEach(r => {
                message += `* ${r.alias} - ${r.role}\n`;
            });
            message += '\n';
        }

        // if no roles found
        if (message === '') {
            message = tl.noGuild;
        }

        await interaction.reply({
            content: message,
            flags: [MessageFlags.Ephemeral]
        });

    } catch (error) {
        logger(lang.getRoles.fail + error, 'ERROR');
        await interaction.reply({
            content: tl.fail,
            flags: [MessageFlags.Ephemeral]
        });
    }

};