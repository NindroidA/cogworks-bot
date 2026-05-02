/**
 * Centralized Interaction Router
 *
 * Dispatches button, select menu, and modal interactions to the correct
 * feature handler. Each feature handler is a `FeatureDispatcher` that
 * inspects the customId itself and returns `true` when it claims the
 * interaction (`false` otherwise). This router is just an ordered loop —
 * the per-feature prefix knowledge lives WITH each feature, not duplicated
 * here. Order matters where prefixes overlap (see notes per dispatcher).
 *
 * Unmatched interactions are silently ignored — they may belong to
 * collector-based flows (e.g., bot-setup wizard, reaction role setup)
 * which handle their own interactions via message component collectors.
 */

import type { Client, Interaction } from 'discord.js';
import { applicationFieldsInteraction } from './applicationFieldsInteraction';
import { handleApplicationInteraction } from './applicationInteraction';
import { handleTicketInteraction } from './ticketInteraction';
import { typeFieldsInteraction } from './typeFieldsInteraction';

type FeatureDispatcher = (client: Client, interaction: Interaction) => Promise<boolean>;

/**
 * Per-feature dispatchers, tried in order. The first one returning `true`
 * claims the interaction; the rest are skipped. Field dispatchers come
 * first because their prefixes are narrower (`field_` / `appfield_`) and
 * the broader `apply_` / `ticket_` family wouldn't false-match them, but
 * keeping the narrower ones first makes the contract explicit.
 */
const FEATURE_DISPATCHERS: FeatureDispatcher[] = [
  typeFieldsInteraction,
  applicationFieldsInteraction,
  handleApplicationInteraction,
  handleTicketInteraction,
];

export const routeInteraction = async (client: Client, interaction: Interaction): Promise<void> => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) {
    return;
  }

  for (const dispatch of FEATURE_DISPATCHERS) {
    if (await dispatch(client, interaction)) return;
  }
};
