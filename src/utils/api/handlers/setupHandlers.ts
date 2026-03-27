/**
 * Setup State API Handlers
 *
 * Exposes the SetupState (system enable/disable, configuration status)
 * to the webapp dashboard so it stays in sync with the bot's setup dashboard.
 */

import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { BotConfig } from '../../../typeorm/entities/BotConfig';
import { MemoryConfig } from '../../../typeorm/entities/memory/MemoryConfig';
import { ReactionRoleMenu } from '../../../typeorm/entities/reactionRole';
import { RulesConfig } from '../../../typeorm/entities/rules';
import { DEFAULT_SYSTEM_STATES, SetupState, type SystemStates } from '../../../typeorm/entities/SetupState';
import { ArchivedTicketConfig } from '../../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { optionalStringArray, requireBoolean, requireString } from '../helpers';
import type { RouteHandler } from '../router';

const setupStateRepo = () => AppDataSource.getRepository(SetupState);

/**
 * Detect system states from actual DB configs (same logic as setupDashboard.ts).
 */
async function detectSystemStates(guildId: string): Promise<SystemStates> {
  const states: SystemStates = { ...DEFAULT_SYSTEM_STATES };

  const [
    botConfig,
    ticketConfig,
    archivedTicket,
    appConfig,
    archivedApp,
    annConfig,
    baitConfig,
    memoryConfig,
    rulesConfig,
    reactionMenuCount,
  ] = await Promise.all([
    AppDataSource.getRepository(BotConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(TicketConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(ApplicationConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({
      guildId,
    }),
    AppDataSource.getRepository(AnnouncementConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(BaitChannelConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(MemoryConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(RulesConfig).findOneBy({ guildId }),
    AppDataSource.getRepository(ReactionRoleMenu).count({ where: { guildId } }),
  ]);

  if (botConfig?.enableGlobalStaffRole && botConfig.globalStaffRole) states.staffRole = 'complete';
  if (ticketConfig && archivedTicket) states.ticket = 'complete';
  else if (ticketConfig) states.ticket = 'partial';
  if (appConfig && archivedApp) states.application = 'complete';
  else if (appConfig) states.application = 'partial';
  if (annConfig?.defaultRoleId && annConfig.defaultChannelId) states.announcement = 'complete';
  if (baitConfig?.channelId) states.baitchannel = 'complete';
  if (memoryConfig) states.memory = 'complete';
  if (rulesConfig?.channelId && rulesConfig.roleId) states.rules = 'complete';
  if (reactionMenuCount > 0) states.reactionRole = 'complete';

  return states;
}

export function registerSetupHandlers(routes: Map<string, RouteHandler>): void {
  /**
   * GET /internal/guilds/:guildId/setup/state
   *
   * Returns the setup state for a guild: enabled systems, configuration status per system.
   * If no SetupState exists, auto-detects from DB configs.
   */
  routes.set('GET /setup/state', async guildId => {
    const dbStates = await detectSystemStates(guildId);
    const setupState = await setupStateRepo().findOneBy({ guildId });

    return {
      guildId,
      selectedSystems: setupState?.selectedSystems ?? null,
      systemStates: dbStates,
      partialData: setupState?.partialData ?? null,
      hasSetupState: !!setupState,
    };
  });

  /**
   * POST /internal/guilds/:guildId/setup/systems
   *
   * Update which systems are enabled/disabled.
   * Body: { enabledSystems: string[] }
   * Pass null or omit to enable all systems.
   */
  routes.set('POST /setup/systems', async (guildId, body) => {
    const enabledSystems = optionalStringArray(body, 'enabledSystems') ?? null;

    let state = await setupStateRepo().findOneBy({ guildId });
    if (!state) {
      const dbStates = await detectSystemStates(guildId);
      state = setupStateRepo().create({
        guildId,
        selectedSystems: enabledSystems ?? null,
        systemStates: dbStates,
        partialData: null,
      });
    } else {
      state.selectedSystems = enabledSystems ?? null;
    }

    await setupStateRepo().save(state);

    return {
      success: true,
      guildId,
      selectedSystems: state.selectedSystems,
    };
  });

  /**
   * POST /internal/guilds/:guildId/setup/toggle
   *
   * Toggle a single system on or off.
   * Body: { systemId: string, enabled: boolean }
   */
  routes.set('POST /setup/toggle', async (guildId, body) => {
    const systemId = requireString(body, 'systemId');
    const enabled = requireBoolean(body, 'enabled');

    let state = await setupStateRepo().findOneBy({ guildId });
    if (!state) {
      const dbStates = await detectSystemStates(guildId);
      state = setupStateRepo().create({
        guildId,
        selectedSystems: null,
        systemStates: dbStates,
        partialData: null,
      });
      await setupStateRepo().save(state);
    }

    // Build the current enabled set
    const allSystemIds = [
      'staffRole',
      'ticket',
      'application',
      'announcement',
      'baitchannel',
      'memory',
      'rules',
      'reactionRole',
    ];
    const currentEnabled = new Set(state.selectedSystems ?? allSystemIds);

    if (enabled) {
      currentEnabled.add(systemId);
    } else {
      currentEnabled.delete(systemId);
    }

    state.selectedSystems = currentEnabled.size === allSystemIds.length ? null : [...currentEnabled];
    await setupStateRepo().save(state);

    return {
      success: true,
      guildId,
      systemId,
      enabled,
      selectedSystems: state.selectedSystems,
    };
  });
}
