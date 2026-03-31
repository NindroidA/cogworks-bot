import type { Client } from 'discord.js';
import type { BaitChannelManager } from '../utils/baitChannel/baitChannelManager';
import type { JoinVelocityTracker } from '../utils/baitChannel/joinVelocityTracker';
import type { StatusManager } from '../utils/status/StatusManager';

/**
 * Extended Discord.js Client with attached managers.
 * Used to avoid verbose type assertions throughout the codebase.
 *
 * Managers are attached in src/index.ts during the `clientReady` event.
 */
export interface ExtendedClient extends Client {
  baitChannelManager: BaitChannelManager;
  joinVelocityTracker: JoinVelocityTracker;
  statusManager: StatusManager;
}
