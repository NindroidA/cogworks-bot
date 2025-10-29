/**
 * Collectors Module
 * 
 * Provides simplified interaction collector patterns for Discord.js components.
 * Includes utilities for button collectors and role select collectors with
 * proper TypeScript typing and error handling.
 */

import {
    ButtonInteraction,
    ComponentType,
    InteractionResponse,
    Message,
    RoleSelectMenuInteraction
} from 'discord.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Collector configuration options
 */
export interface CollectorOptions {
	/** Timeout in milliseconds (default: 60000 = 1 minute) */
	timeout?: number;
	/** User ID that should be able to interact */
	userId: string;
}

/**
 * Callback for handling button interactions
 */
export type ButtonCollectorCallback = (interaction: ButtonInteraction) => Promise<void> | void;

/**
 * Callback for handling role select interactions
 */
export type RoleSelectCollectorCallback = (interaction: RoleSelectMenuInteraction) => Promise<void> | void;

// ============================================================================
// Button Collector
// ============================================================================

/**
 * Creates a button collector with standard configuration
 * 
 * Supports two modes:
 * - Simple mode: Just message and timeout
 * - Full mode: With options, callbacks, and user filtering
 * 
 * @param message - The message to collect interactions from
 * @param optionsOrTimeout - Either collector options object or timeout in ms
 * @param onCollect - Optional callback when button is clicked
 * @param onTimeout - Optional callback when collector times out
 * @returns The collector for further customization if needed
 * @example
 * // Simple mode
 * createButtonCollector(message, 60000);
 * 
 * // Full mode with callbacks
 * createButtonCollector(
 *   message,
 *   { userId: '123456', timeout: 30000 },
 *   async (interaction) => {
 *     await interaction.reply('Clicked!');
 *   },
 *   async () => {
 *     await message.edit('Timed out');
 *   }
 * );
 */
export function createButtonCollector(
	message: Message | InteractionResponse,
	optionsOrTimeout: CollectorOptions | number,
	onCollect?: ButtonCollectorCallback,
	onTimeout?: () => Promise<void> | void
) {
	// Determine if using simple mode (just timeout) or full mode (with options)
	const isSimpleMode = typeof optionsOrTimeout === 'number';
	const timeout = isSimpleMode ? optionsOrTimeout : (optionsOrTimeout.timeout || 60_000);
	const userId = isSimpleMode ? undefined : optionsOrTimeout.userId;

	const collector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		time: timeout,
		filter: userId ? (i) => i.user.id === userId : undefined,
	});

	if (onCollect) {
		collector.on('collect', onCollect);
	}

	if (onTimeout) {
		collector.on('end', async (collected, reason) => {
			if (reason === 'time') {
				await onTimeout();
			}
		});
	}

	return collector;
}

// ============================================================================
// Role Select Collector
// ============================================================================

/**
 * Creates a role select menu collector with standard configuration
 * @param message - The message to collect interactions from
 * @param options - Collector configuration
 * @param onCollect - Callback when role is selected
 * @param onTimeout - Optional callback when collector times out
 * @returns The collector for further customization if needed
 * @example
 * createRoleSelectCollector(
 *   message,
 *   { userId: '123456', timeout: 60000 },
 *   async (interaction) => {
 *     const roles = interaction.values;
 *     await interaction.reply(`Selected ${roles.length} roles`);
 *   },
 *   async () => {
 *     await message.edit('Selection timed out');
 *   }
 * );
 */
export function createRoleSelectCollector(
	message: Message | InteractionResponse,
	options: CollectorOptions,
	onCollect: RoleSelectCollectorCallback,
	onTimeout?: () => Promise<void> | void
) {
	const collector = message.createMessageComponentCollector({
		componentType: ComponentType.RoleSelect,
		time: options.timeout || 60_000,
		filter: (i) => i.user.id === options.userId,
	});

	collector.on('collect', onCollect);

	if (onTimeout) {
		collector.on('end', async (collected, reason) => {
			if (reason === 'time') {
				await onTimeout();
			}
		});
	}

	return collector;
}

