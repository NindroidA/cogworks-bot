/**
 * Build a structured audit-log reason string for a bait moderation action.
 *
 * The string surfaces in Discord's audit log next to every ban/kick/timeout,
 * so server mods reviewing actions can see WHY the bot acted without having
 * to cross-reference internal logs. Format:
 *
 *   cogworks:bait score=87 ch=#trap-channel flags=[free,nitro] msgId=123
 *
 * Discord caps the `X-Audit-Log-Reason` header at 512 chars — we truncate
 * defensively.
 */

const MAX_AUDIT_REASON_LENGTH = 512;

export interface AuditReasonParts {
  score: number;
  channelName: string;
  flags?: string[];
  messageId?: string;
  extra?: string;
}

export function buildAuditReason(parts: AuditReasonParts): string {
  const tokens: string[] = ['cogworks:bait', `score=${parts.score}`];

  if (parts.channelName) {
    // Channel name may contain non-ASCII or whitespace — keep it tagged but
    // strip the leading #/whitespace so the reason stays parseable. Trim
    // first so leading whitespace doesn't hide an existing # prefix.
    const cleanName = parts.channelName.trim().replace(/^#+/, '').trim();
    if (cleanName) tokens.push(`ch=#${cleanName}`);
  }

  if (parts.flags && parts.flags.length > 0) {
    tokens.push(`flags=[${parts.flags.join(',')}]`);
  }

  if (parts.messageId) {
    tokens.push(`msgId=${parts.messageId}`);
  }

  if (parts.extra) {
    tokens.push(parts.extra);
  }

  const joined = tokens.join(' ');
  return joined.length > MAX_AUDIT_REASON_LENGTH ? joined.slice(0, MAX_AUDIT_REASON_LENGTH) : joined;
}

/**
 * Extract the non-zero flag names from a detection-flags object for
 * inclusion in an audit reason. Order-stable so the reason is deterministic
 * for the same input.
 */
export function flagsTriggered(flags: Record<string, boolean | undefined> | null | undefined): string[] {
  if (!flags) return [];
  return Object.entries(flags)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}
