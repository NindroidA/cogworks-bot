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
import { lang, logHandlerError, replyEphemeralError } from '../utils';
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

export const routeInteraction = async (
  client: Client,
  interaction: Interaction,
  dispatchers: FeatureDispatcher[] = FEATURE_DISPATCHERS,
): Promise<void> => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) {
    return;
  }

  try {
    for (const dispatch of dispatchers) {
      if (await dispatch(client, interaction)) return;
    }
  } catch (error) {
    // A feature handler threw mid-dispatch. If it had already acknowledged the
    // interaction (reply/update/defer), Discord shows no "interaction failed" —
    // the user is stranded on a stale loading state forever. Convert any such
    // post-ack throw into a visible ephemeral error so a button can never hang.
    // (Site-level guards still handle the non-throwing early returns; this is
    // the defense-in-depth net for every feature, not a substitute for them.)
    logHandlerError('interaction-router', error, { customId: interaction.customId });
    await replyEphemeralError(interaction, lang.general.fatalError, { bugReport: true });
  }
};
