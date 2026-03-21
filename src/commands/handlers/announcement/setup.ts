import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import {
  createRateLimitKey,
  enhancedLogger,
  LANGF,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { seedDefaultTemplates } from './templates';

const announcementConfigRepo = lazyRepo(AnnouncementConfig);

export const announcementSetupHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  // Require admin permissions
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const tl = lang.announcement.setup;
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  // Rate limit check (guild-scoped: 5 setup operations per hour)
  const rateLimitKey = createRateLimitKey.guild(guildId, 'announcement-setup');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_SETUP);

  if (!rateCheck.allowed) {
    await interaction.reply({
      content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.rateLimit(
      'Announcement setup rate limit exceeded',
      interaction.user.id,
      guildId,
    );
    return;
  }

  const announcementRole = interaction.options.getRole('announcement-role', true);
  const defaultChannel = interaction.options.getChannel('default-channel', true);

  try {
    let config = await announcementConfigRepo.findOneBy({ guildId });

    if (!config) {
      config = announcementConfigRepo.create({
        guildId,
        defaultRoleId: announcementRole.id,
        defaultChannelId: defaultChannel.id,
      });
    } else {
      config.defaultRoleId = announcementRole.id;
      config.defaultChannelId = defaultChannel.id;
    }

    await announcementConfigRepo.save(config);

    // Seed default templates if none exist
    const seeded = await seedDefaultTemplates(guildId);

    const seededMsg = seeded > 0 ? `\n• ${seeded} default templates seeded` : '';
    await interaction.reply({
      content: `${tl.success}\n• Announcement Role: ${announcementRole}\n• Default Channel: ${defaultChannel}${seededMsg}`,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command('Announcement configured', interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error(
      'Announcement setup failed',
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await interaction.reply({
      content: tl.fail,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
