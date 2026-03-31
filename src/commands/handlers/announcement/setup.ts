import {
  type CacheType,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
  type ModalSubmitInteraction,
} from 'discord.js';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import {
  enhancedLogger,
  guardAdminRateLimit,
  handleInteractionError,
  LogCategory,
  lang,
  RateLimits,
  showAndAwaitModal,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { channelSelect, labelWrap, rawModal, roleSelect } from '../../../utils/modalComponents';
import { seedDefaultTemplates } from './templates';

const announcementConfigRepo = lazyRepo(AnnouncementConfig);

export const announcementSetupHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'announcement-setup',
    limit: RateLimits.ANNOUNCEMENT_SETUP,
    scope: 'guild',
  });
  if (!guard.allowed) return;

  const tl = lang.announcement.setup;
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  try {
    const announcementRole = interaction.options.getRole('announcement-role');
    const defaultChannel = interaction.options.getChannel('default-channel');

    // If both params provided, use the classic flow
    if (announcementRole && defaultChannel) {
      await saveConfig(interaction, guildId, announcementRole.id, defaultChannel.id, tl);
      return;
    }

    // Otherwise, open a modal with role + channel selects
    const modal = rawModal(`ann_setup_${Date.now()}`, 'Announcement Setup', [
      labelWrap('Announcement Role', roleSelect('ann_role'), 'Role to ping for announcements'),
      labelWrap(
        'Default Channel',
        channelSelect('ann_channel', [ChannelType.GuildText, ChannelType.GuildAnnouncement]),
        'Channel to send announcements in',
      ),
    ]);

    const modalSubmit = await showAndAwaitModal(interaction, modal as any);
    if (!modalSubmit) return;

    const roleId = (modalSubmit.fields as any).getField('ann_role')?.value;
    const channelId = (modalSubmit.fields as any).getField('ann_channel')?.value;

    if (!roleId || !channelId) {
      await modalSubmit.reply({
        content: lang.general.contextMenu.selectRoleAndChannel,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await saveConfig(modalSubmit, guildId, roleId, channelId, tl);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Announcement setup');
  }
};

async function saveConfig(
  interaction: ChatInputCommandInteraction<CacheType> | ModalSubmitInteraction<CacheType>,
  guildId: string,
  roleId: string,
  channelId: string,
  tl: typeof lang.announcement.setup,
) {
  try {
    let config = await announcementConfigRepo.findOneBy({ guildId });

    if (!config) {
      config = announcementConfigRepo.create({
        guildId,
        defaultRoleId: roleId,
        defaultChannelId: channelId,
      });
    } else {
      config.defaultRoleId = roleId;
      config.defaultChannelId = channelId;
    }

    await announcementConfigRepo.save(config);

    const seeded = await seedDefaultTemplates(guildId);
    const seededMsg = seeded > 0 ? `\n• ${seeded} default templates seeded` : '';

    await interaction.reply({
      content: `${tl.success}\n• Announcement Role: <@&${roleId}>\n• Default Channel: <#${channelId}>${seededMsg}`,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command('Announcement configured', interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Announcement setup failed', error as Error, LogCategory.COMMAND_EXECUTION, { guildId });
    const errPayload = {
      content: tl.fail,
      flags: [MessageFlags.Ephemeral] as const,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errPayload).catch(() => {});
    } else {
      await interaction.reply(errPayload).catch(() => {});
    }
  }
}
