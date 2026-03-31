import { ActivityType, type Client, EmbedBuilder, type PresenceStatusData, type TextChannel } from 'discord.js';
import { IsNull } from 'typeorm';
import { lang } from '../../lang';
import { AppDataSource } from '../../typeorm';
import { BotStatus, type IncidentLevel, StatusIncident, type StatusLevel } from '../../typeorm/entities/status';
import { Colors } from '../colors';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { truncateWithNotice } from '../validation/inputSanitizer';
import { invalidateStatusBannerCache } from './statusBanner';

const tl = lang.status;

const STATUS_PRESENCE_MAP: Record<StatusLevel, { status: PresenceStatusData; activity?: string }> = {
  operational: { status: 'online' },
  degraded: { status: 'idle', activity: tl.presence.degraded },
  'partial-outage': { status: 'idle', activity: tl.presence['partial-outage'] },
  'major-outage': { status: 'dnd', activity: tl.presence['major-outage'] },
  maintenance: { status: 'idle', activity: tl.presence.maintenance },
};

export class StatusManager {
  private client: Client;
  private isDev: boolean;
  private statusRepo = AppDataSource.getRepository(BotStatus);

  constructor(client: Client, isDev: boolean) {
    this.client = client;
    this.isDev = isDev;
  }

  /** Get or create the singleton status record */
  async getStatus(): Promise<BotStatus> {
    let status = await this.statusRepo.findOneBy({ id: 1 });
    if (!status) {
      status = this.statusRepo.create({
        id: 1,
        level: 'operational',
        message: null,
        affectedSystems: null,
        startedAt: null,
        estimatedResolution: null,
        updatedBy: null,
        isManualOverride: false,
        manualOverrideExpiresAt: null,
      });
      await this.statusRepo.save(status);
    }
    return status;
  }

  /** Set bot status (manual) */
  async setStatus(level: StatusLevel, userId: string, message?: string, systems?: string[]): Promise<BotStatus> {
    const status = await this.getStatus();

    status.level = level;
    status.message = message || null;
    status.affectedSystems = systems || null;
    status.startedAt = level === 'operational' ? null : new Date();
    status.updatedBy = userId;
    status.isManualOverride = true;
    status.manualOverrideExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.statusRepo.save(status);
    await this.updatePresence(status);
    await this.postToStatusChannel(status);
    invalidateStatusBannerCache();

    // Create incident record for non-operational statuses
    if (level !== 'operational') {
      await this.createIncident(level, message || 'Status changed', systems);
    }

    enhancedLogger.info(`Status manually set to ${level}`, LogCategory.SYSTEM, {
      level,
      userId,
      message,
      systems,
    });

    return status;
  }

  /** Clear status back to operational */
  async clearStatus(userId: string, resolutionMessage?: string): Promise<BotStatus> {
    const status = await this.getStatus();

    status.level = 'operational';
    status.message = resolutionMessage || null;
    status.affectedSystems = null;
    status.startedAt = null;
    status.updatedBy = userId;
    status.isManualOverride = false;
    status.manualOverrideExpiresAt = null;

    await this.statusRepo.save(status);
    await this.updatePresence(status);
    await this.postResolutionToStatusChannel(resolutionMessage);
    invalidateStatusBannerCache();

    // Resolve any open incidents
    await this.resolveOpenIncidents(userId);

    enhancedLogger.info('Status cleared to operational', LogCategory.SYSTEM, {
      userId,
      resolutionMessage,
    });

    return status;
  }

  /** Auto-set status from health checks (respects manual override) */
  async autoSetStatus(level: StatusLevel): Promise<void> {
    const status = await this.getStatus();

    if (this.isManualOverrideActive(status)) {
      enhancedLogger.debug('Auto-status skipped: manual override active', LogCategory.SYSTEM);
      return;
    }

    if (status.level === level) return; // No change

    status.level = level;
    status.startedAt = level === 'operational' ? null : status.startedAt || new Date();
    status.updatedBy = null; // Automated
    status.isManualOverride = false;

    await this.statusRepo.save(status);
    await this.updatePresence(status);
    invalidateStatusBannerCache();

    // Auto-create/resolve incidents
    if (level === 'operational') {
      await this.resolveOpenIncidents(null);
    } else {
      await this.createIncident(level, 'Auto-detected status change');
    }

    enhancedLogger.info(`Status auto-set to ${level}`, LogCategory.SYSTEM, {
      level,
    });
  }

  /** Check if manual override is currently active */
  isManualOverrideActive(status: BotStatus): boolean {
    if (!status.isManualOverride) return false;
    if (!status.manualOverrideExpiresAt) return false;
    return new Date() < new Date(status.manualOverrideExpiresAt);
  }

  /** Update bot's Discord presence based on status */
  async updatePresence(status?: BotStatus): Promise<void> {
    if (!status) {
      status = await this.getStatus();
    }

    // Dev mode shows dev status only when operational
    if (this.isDev && status.level === 'operational') {
      this.client.user?.setPresence({
        activities: [
          {
            name: 'Status',
            type: ActivityType.Custom,
            state: '🔧 Development Mode',
          },
        ],
        status: 'idle',
      });
      return;
    }

    const presenceConfig = STATUS_PRESENCE_MAP[status.level];

    // Manual override with custom message → use that as presence text
    if (this.isManualOverrideActive(status) && status.message) {
      this.client.user?.setPresence({
        activities: [
          {
            name: 'Status',
            type: ActivityType.Custom,
            state: status.message,
          },
        ],
        status: presenceConfig.status,
      });
    } else if (presenceConfig.activity) {
      this.client.user?.setPresence({
        activities: [
          {
            name: 'Status',
            type: ActivityType.Custom,
            state: presenceConfig.activity,
          },
        ],
        status: presenceConfig.status,
      });
    } else {
      // Operational — use rotating presence
      this.client.user?.setPresence({
        activities: [
          {
            name: 'Status',
            type: ActivityType.Custom,
            state: lang.general.presenceMessages[Math.floor(Math.random() * lang.general.presenceMessages.length)],
          },
        ],
        status: 'online',
      });
    }
  }

  /** Create a new incident record */
  private async createIncident(level: IncidentLevel, message: string, systems?: string[]): Promise<void> {
    try {
      const incidentRepo = AppDataSource.getRepository(StatusIncident);
      const incident = incidentRepo.create({
        level,
        message,
        affectedSystems: systems || null,
      });
      await incidentRepo.save(incident);
    } catch (error) {
      enhancedLogger.error('Failed to create incident record', error as Error, LogCategory.DATABASE);
    }
  }

  /** Resolve all open incidents */
  private async resolveOpenIncidents(resolvedBy: string | null): Promise<void> {
    try {
      const incidentRepo = AppDataSource.getRepository(StatusIncident);
      const openIncidents = await incidentRepo.find({
        where: { resolvedAt: IsNull() },
      });

      if (openIncidents.length === 0) return;

      const now = new Date();
      for (const incident of openIncidents) {
        incident.resolvedAt = now;
        incident.resolvedBy = resolvedBy;
      }

      await incidentRepo.save(openIncidents);
    } catch (error) {
      enhancedLogger.error('Failed to resolve open incidents', error as Error, LogCategory.DATABASE);
    }
  }

  /** Post status update to configured channel */
  private async postToStatusChannel(status: BotStatus): Promise<void> {
    const channelId = process.env.STATUS_CHANNEL_ID;
    if (!channelId) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;

      const levelLabel = tl.levels[status.level] || status.level;
      const color =
        status.level === 'operational'
          ? Colors.status.success
          : status.level === 'major-outage'
            ? Colors.status.error
            : Colors.status.warning;

      const embed = new EmbedBuilder().setTitle(`${tl.channel.statusUpdate}: ${levelLabel}`).setColor(color);

      if (status.message) {
        embed.setDescription(status.message);
      }

      if (Array.isArray(status.affectedSystems) && status.affectedSystems.length > 0) {
        embed.addFields({
          name: tl.view.systems,
          value: truncateWithNotice(status.affectedSystems.join(', '), 1024),
        });
      }

      await (channel as TextChannel).send({ embeds: [embed] });
    } catch (error) {
      enhancedLogger.error('Failed to post to status channel', error as Error, LogCategory.SYSTEM);
    }
  }

  /** Post resolution to configured channel */
  private async postResolutionToStatusChannel(message?: string): Promise<void> {
    const channelId = process.env.STATUS_CHANNEL_ID;
    if (!channelId) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;

      const embed = new EmbedBuilder()
        .setTitle(`✅ ${tl.channel.resolved}`)
        .setDescription(message || tl.channel.resolvedMessage)
        .setColor(Colors.status.success);

      await (channel as TextChannel).send({ embeds: [embed] });
    } catch (error) {
      enhancedLogger.error('Failed to post resolution to status channel', error as Error, LogCategory.SYSTEM);
    }
  }
}
