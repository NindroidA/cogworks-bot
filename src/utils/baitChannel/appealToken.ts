/**
 * HMAC-signed one-shot appeal tokens for bait pre-ban DMs.
 *
 * Format: `<payload_base64url>.<sig_base64url>` where payload is
 * URL-safe base64 of a JSON object:
 *   `{guildId, userId, action, banReason, iat, exp, iss: 'cogworks'}`
 *
 * Signing: HMAC-SHA256 over the payload bytes, secret from the
 * `APPEAL_HMAC_SECRET` env var (32+ random bytes recommended).
 *
 * Verification (used by webapp `/appeal?token=` in v3.2.1):
 *   - Re-computes HMAC and compares with `timingSafeEqual`.
 *   - Checks `exp` against `Date.now()`.
 *   - No replay protection — webapp side enforces single-use by
 *     marking the bait log row as "appealed" on consumption.
 *
 * Why HMAC vs JWT / JWK / paseto: this is a single-issuer, single-
 * consumer flow inside one organization's infrastructure. Pulling in
 * a JWT library for this would be over-engineering. The format is
 * stable and short (~300 bytes typical).
 */

import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

const ISSUER_NAME = 'cogworks';
const DEFAULT_EXP_HOURS = 7 * 24; // 7 days — long enough for most ban-appeal workflows

export interface AppealTokenPayload {
  guildId: string;
  userId: string;
  action: 'ban' | 'softban' | 'kick' | 'timeout';
  banReason?: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expires-at, unix seconds. */
  exp: number;
  /** Issuer — sanity check against tokens from other systems. */
  iss: string;
}

export interface SignAppealTokenInput {
  guildId: string;
  userId: string;
  action: AppealTokenPayload['action'];
  banReason?: string;
  /** Override default 7-day expiry. */
  expiresInHours?: number;
}

export type VerifyResult =
  | { valid: true; payload: AppealTokenPayload }
  | {
      valid: false;
      error: 'invalid_format' | 'invalid_signature' | 'expired' | 'wrong_issuer';
    };

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  // Restore padding before standard base64 decode.
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Pull the signing secret, throwing if missing.
 *
 * Bot won't start with `enableAppealLink=true` on any guild and a
 * missing/empty secret — that's enforced in the slash-handler that sets
 * `enableAppealLink`. This getter is the secondary defense (don't sign
 * with a known/default value).
 */
function getSecret(): string {
  const secret = process.env.APPEAL_HMAC_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'APPEAL_HMAC_SECRET is not set (or too short — recommend 32+ bytes). Bait appeal links require this env var. See .env.example.',
    );
  }
  return secret;
}

export function signAppealToken(input: SignAppealTokenInput): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.expiresInHours ?? DEFAULT_EXP_HOURS) * 3600;
  const payload: AppealTokenPayload = {
    guildId: input.guildId,
    userId: input.userId,
    action: input.action,
    banReason: input.banReason,
    iat: now,
    exp,
    iss: ISSUER_NAME,
  };
  const payloadStr = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(payloadStr).digest();
  return `${payloadStr}.${b64urlEncode(sig)}`;
}

export function verifyAppealToken(token: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, error: 'invalid_format' };
  const [payloadStr, sigStr] = parts;

  // Recompute HMAC. Compare with timingSafeEqual to avoid timing oracles.
  let expectedSig: Buffer;
  let providedSig: Buffer;
  try {
    expectedSig = createHmac('sha256', getSecret()).update(payloadStr).digest();
    providedSig = b64urlDecode(sigStr);
  } catch {
    return { valid: false, error: 'invalid_format' };
  }
  if (providedSig.length !== expectedSig.length) {
    return { valid: false, error: 'invalid_signature' };
  }
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return { valid: false, error: 'invalid_signature' };
  }

  let payload: AppealTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadStr).toString('utf-8')) as AppealTokenPayload;
  } catch {
    return { valid: false, error: 'invalid_format' };
  }

  if (payload.iss !== ISSUER_NAME) return { valid: false, error: 'wrong_issuer' };
  if (typeof payload.exp !== 'number') return { valid: false, error: 'invalid_format' };
  if (payload.exp * 1000 < Date.now()) return { valid: false, error: 'expired' };

  return { valid: true, payload };
}

/**
 * Build the full appeal URL for embedding in a DM.
 * Returns null if appeal links aren't configured (caller falls back to
 * the static `appealInfo` text from BaitChannelConfig).
 */
export function buildAppealUrl(input: SignAppealTokenInput & { baseUrl: string | null | undefined }): string | null {
  if (!input.baseUrl) return null;
  if (!process.env.APPEAL_HMAC_SECRET) return null; // secret missing — silently skip the link

  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const token = signAppealToken({
    guildId: input.guildId,
    userId: input.userId,
    action: input.action,
    banReason: input.banReason,
    expiresInHours: input.expiresInHours,
  });

  url.searchParams.set('token', token);
  return url.toString();
}
