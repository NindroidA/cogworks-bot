/**
 * Setup State API Handlers
 *
 * Exposes the SetupState (system enable/disable, configuration status)
 * to the webapp dashboard so it stays in sync with the bot's setup dashboard.
 */

import type { Client } from 'discord.js';
import { SetupState } from '../../../typeorm/entities/SetupState';
import { lazyRepo } from '../../database/lazyRepo';
import { detectSystemStates } from '../../setup/systemStates';
import { optionalStringArray, requireBoolean, requireString } from '../helpers';
import type { RouteHandler } from '../router';
import { writeAuditAction } from './auditHelper';

const setupStateRepo = lazyRepo(SetupState);

export function registerSetupHandlers(_client: Client, routes: Map<string, RouteHandler>): void {
  /**
   * GET /internal/guilds/:guildId/setup/state
   *
   * Returns the setup state for a guild: enabled systems, configuration status per system.
   * If no SetupState exists, auto-detects from DB configs.
   */
  routes.set('GET /setup/state', async guildId => {
    const dbStates = await detectSystemStates(guildId);
    const setupState = await setupStateRepo.findOneBy({ guildId });

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

    let state = await setupStateRepo.findOneBy({ guildId });
    if (!state) {
      const dbStates = await detectSystemStates(guildId);
      state = setupStateRepo.create({
        guildId,
        selectedSystems: enabledSystems ?? null,
        systemStates: dbStates,
        partialData: null,
      });
    } else {
      state.selectedSystems = enabledSystems ?? null;
    }

    await setupStateRepo.save(state);

    await writeAuditAction(guildId, body, 'setup.systems', {
      enabledSystems,
    });

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

    let state = await setupStateRepo.findOneBy({ guildId });
    if (!state) {
      const dbStates = await detectSystemStates(guildId);
      state = setupStateRepo.create({
        guildId,
        selectedSystems: null,
        systemStates: dbStates,
        partialData: null,
      });
      await setupStateRepo.save(state);
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
    await setupStateRepo.save(state);

    await writeAuditAction(guildId, body, 'setup.toggle', {
      systemId,
      enabled,
    });

    return {
      success: true,
      guildId,
      systemId,
      enabled,
      selectedSystems: state.selectedSystems,
    };
  });
}
