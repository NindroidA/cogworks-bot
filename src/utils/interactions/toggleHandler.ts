/**
 * Enable/disable toggle handler factory (unification roadmap target #7).
 *
 * Several guild-config systems hand-roll the same enable/disable spine:
 * find(-or-create) the config row, run an idempotent "already enabled/disabled"
 * check, flip a boolean column, save, fire a side effect, and reply ephemerally.
 * This binds that spine to a config so callers only declare what diverges —
 * the field, the messages, an optional pre-enable guard, and an `onToggled`
 * side effect (where the Phase-B cache `invalidate*` calls plug in).
 *
 * Scope: covers the self-fetching, text-reply toggles (find-or-create or
 * require-existing) whose divergences are the column, the messages, an optional
 * pre-enable guard/seed, and a side effect. Toggles that read command options,
 * reply with embeds, or run on a dispatcher-prefetched config are left
 * hand-written — those need hooks that defeat the point of a thin helper.
 */

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import type { DeepPartial, FindOptionsWhere, Repository } from 'typeorm';
import { replyEphemeralError } from './replyHelper';

/** Keys of `T` whose value is a boolean — the columns this helper can toggle. */
type BooleanKeys<T> = { [K in keyof T]-?: T[K] extends boolean ? K : never }[keyof T];

export interface ToggleMessages {
  /** Reply when enable is requested but the flag is already on. */
  alreadyEnabled: string;
  /** Reply when disable is requested but the flag is already off. */
  alreadyDisabled: string;
  /** Success reply for enable. */
  enabled: string;
  /** Success reply for disable. */
  disabled: string;
}

export interface ToggleHandlerOptions<T extends { guildId: string }> {
  /** Guild-scoped config repository (e.g. from `lazyRepo`). */
  repo: Pick<Repository<T>, 'findOneBy' | 'create' | 'save'>;
  /** The boolean column to toggle. */
  field: BooleanKeys<T>;
  messages: ToggleMessages;
  /**
   * When set, the config row must already exist: enable/disable reply
   * `notConfigured` instead of creating the row (enable) or treating a missing
   * row as already-off (disable). Omit for the find-or-create default.
   */
  requireExisting?: { notConfigured: string };
  /**
   * Optional pre-enable guard. Return an error message to block enabling (sent
   * ephemerally), or null/undefined to allow it. Runs after the row is
   * found/created but before the already-enabled check.
   */
  canEnable?: (config: T) => string | null | undefined;
  /**
   * Mutate the config when enabling, after the flag is set and before save —
   * e.g. seed dependent defaults. Runs only on enable.
   */
  onEnable?: (config: T) => void;
  /**
   * Side effect after a successful toggle — cache invalidation, audit logging,
   * etc. This is where the Phase-B `invalidate*` cache calls plug in.
   */
  onToggled?: (interaction: ChatInputCommandInteraction, guildId: string, enabled: boolean) => void | Promise<void>;
}

export interface ToggleHandlers {
  enable: (interaction: ChatInputCommandInteraction, guildId: string) => Promise<void>;
  disable: (interaction: ChatInputCommandInteraction, guildId: string) => Promise<void>;
}

/**
 * Build `{ enable, disable }` handlers for a guild-scoped boolean config flag.
 *
 * Enable finds-or-creates the config row; disable finds it (a missing row counts
 * as already-disabled, so disabling never creates). Both flip the flag only when
 * it actually changes state.
 */
export function createToggleHandler<T extends { guildId: string }>(options: ToggleHandlerOptions<T>): ToggleHandlers {
  const { repo, field, messages, requireExisting, canEnable, onEnable, onToggled } = options;
  const where = (guildId: string) => ({ guildId }) as FindOptionsWhere<T>;

  async function enable(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    let config = await repo.findOneBy(where(guildId));
    if (!config) {
      if (requireExisting) {
        await replyEphemeralError(interaction, requireExisting.notConfigured);
        return;
      }
      config = repo.create({ guildId } as DeepPartial<T>);
    }

    const guardError = canEnable?.(config);
    if (guardError) {
      await replyEphemeralError(interaction, guardError);
      return;
    }
    if (config[field]) {
      await replyEphemeralError(interaction, messages.alreadyEnabled);
      return;
    }

    Object.assign(config, { [field]: true });
    onEnable?.(config);
    await repo.save(config);
    await onToggled?.(interaction, guildId, true);

    await interaction.reply({ content: messages.enabled, flags: [MessageFlags.Ephemeral] });
  }

  async function disable(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
    const config = await repo.findOneBy(where(guildId));
    if (requireExisting && !config) {
      await replyEphemeralError(interaction, requireExisting.notConfigured);
      return;
    }
    if (!config?.[field]) {
      await replyEphemeralError(interaction, messages.alreadyDisabled);
      return;
    }

    Object.assign(config, { [field]: false });
    await repo.save(config);
    await onToggled?.(interaction, guildId, false);

    await interaction.reply({ content: messages.disabled, flags: [MessageFlags.Ephemeral] });
  }

  return { enable, disable };
}
