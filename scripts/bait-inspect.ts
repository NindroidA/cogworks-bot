/**
 * Bait State Inspector — dev/smoke-test harness.
 *
 * Dumps the full bait-channel state for a guild (optionally narrowed to one
 * user) directly from the DB: config + raid status, recent BaitChannelLog
 * rows with all audit columns, pending_actions (retry queue), and
 * idempotency_keys. This turns the v3.2.0 smoke-test checklist's manual
 * "capture DB state" steps (§2/§3/§4/§5/§6/§8/§10) into one command, so the
 * irreducible live items (post a bait message, get banned, receive a DM) are
 * the only thing you do by hand — verification is automated.
 *
 * Usage:
 *   bun run scripts/bait-inspect.ts <guildId> [userId] [--logs=N]
 *
 * Examples:
 *   bun run scripts/bait-inspect.ts 1337843971958767670
 *   bun run scripts/bait-inspect.ts 1337843971958767670 99887766554433221 --logs=10
 *
 * Reads the same DB as the bot (via .env / AppDataSource). Safe read-only.
 */

import dotenv from 'dotenv';
import { AppDataSource } from '../src/typeorm';
import { BaitChannelConfig } from '../src/typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../src/typeorm/entities/bait/BaitChannelLog';
import { IdempotencyKey } from '../src/typeorm/entities/bait/IdempotencyKey';
import { PendingAction } from '../src/typeorm/entities/bait/PendingAction';

dotenv.config();

function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number.parseInt(hit.split('=')[1] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(d: Date | null | undefined): string {
  return d ? new Date(d).toISOString() : '—';
}

function section(title: string): void {
  console.log(`\n${'━'.repeat(70)}\n${title}\n${'━'.repeat(70)}`);
}

async function inspect(): Promise<void> {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const guildId = positional[0];
  const userId = positional[1]; // optional
  const logLimit = arg('logs', 15);

  if (!guildId) {
    console.error('Usage: bun run scripts/bait-inspect.ts <guildId> [userId] [--logs=N]');
    process.exit(1);
  }

  await AppDataSource.initialize();
  console.log(`🎯 Bait state for guild ${guildId}${userId ? ` · user ${userId}` : ''}`);

  // --- Config + raid status ---------------------------------------------
  try {
    const config = await AppDataSource.getRepository(BaitChannelConfig).findOneBy({ guildId });
    section('CONFIG / RAID STATUS');
    if (!config) {
      console.log('  (no bait config for this guild)');
    } else {
      const raidActive =
        config.currentRaidModeUntil && new Date(config.currentRaidModeUntil).getTime() > Date.now();
      console.log(`  enabled:               ${config.enabled}`);
      console.log(`  gracePeriodSeconds:    ${config.gracePeriodSeconds}`);
      console.log(`  deleteMessageHours:    ${config.deleteMessageHours}`);
      console.log(`  logChannelId:          ${config.logChannelId ?? '—'}`);
      console.log(`  enableRaidMode:        ${config.enableRaidMode}  (threshold ${config.raidModeThreshold} / ${config.raidModeWindowSeconds}s)`);
      console.log(`  raid ACTIVE:           ${raidActive ? `YES → until ${fmt(config.currentRaidModeUntil)}` : 'no'}`);
      console.log(`  enableAppealLink:      ${config.enableAppealLink}  base=${config.appealLinkBaseUrl ?? '—'}`);
      console.log(`  APPEAL_HMAC_SECRET set: ${process.env.APPEAL_HMAC_SECRET ? 'yes' : 'NO (appeal links silently omitted)'}`);
    }
  } catch (e) {
    console.log(`  config query failed: ${(e as Error).message}`);
  }

  // --- Recent BaitChannelLog rows ---------------------------------------
  try {
    const logRepo = AppDataSource.getRepository(BaitChannelLog);
    const logs = await logRepo.find({
      where: userId ? { guildId, userId } : { guildId },
      order: { createdAt: 'DESC' },
      take: logLimit,
    });
    section(`BAIT LOG (latest ${logs.length})`);
    if (logs.length === 0) console.log('  (none)');
    for (const l of logs) {
      const flags = Object.entries(l.detectionFlags ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k)
        .join(',');
      console.log(
        `  #${l.id} ${fmt(l.createdAt)} ${l.username} (${l.userId})\n` +
          `     action=${l.actionTaken} score=${l.suspicionScore} overridden=${l.overridden}\n` +
          `     dmSent=${l.dmSent} dmFail=${l.dmFailureReason ?? '—'} logDeliveryFailed=${l.logDeliveryFailed}\n` +
          `     auditLogId=${l.discordAuditLogId ?? '—'} confirmedAt=${fmt(l.actionConfirmedAt)} executorId=${l.executorId ?? '—'}\n` +
          `     unbannedAt=${fmt(l.unbannedAt)} unbannedBy=${l.unbannedBy ?? '—'}\n` +
          `     flags=[${flags}]`,
      );
    }
  } catch (e) {
    console.log(`  log query failed (table may not exist yet): ${(e as Error).message}`);
  }

  // --- pending_actions (retry queue + grace rows) -----------------------
  try {
    const pending = await AppDataSource.getRepository(PendingAction).find({
      where: userId ? { guildId, userId } : { guildId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
    section(`PENDING ACTIONS (${pending.length})`);
    if (pending.length === 0) console.log('  (none)');
    for (const p of pending) {
      const role = (p.attempts ?? 0) === 0 ? 'grace' : 'retry';
      const dead = p.deadAt ? `DEAD@${fmt(p.deadAt)}` : 'live';
      console.log(
        `  #${p.id} ${role} ${dead} action=${p.action} attempts=${p.attempts} ` +
          `expiresAt=${fmt(p.expiresAt)} user=${p.userId} lastError=${p.lastError ?? '—'}`,
      );
    }
  } catch (e) {
    console.log(`  pending_actions query failed: ${(e as Error).message}`);
  }

  // --- idempotency_keys --------------------------------------------------
  try {
    const keys = await AppDataSource.getRepository(IdempotencyKey).find({
      where: userId ? { guildId, userId } : { guildId },
      order: { createdAt: 'DESC' },
      take: 30,
    });
    section(`IDEMPOTENCY KEYS (${keys.length})`);
    if (keys.length === 0) console.log('  (none)');
    for (const k of keys) {
      console.log(
        `  #${k.id} action=${k.action} dayBucket=${fmt(k.dayBucket)} testMode=${k.testMode} ` +
          `executorId=${k.executorId ?? '—'} user=${k.userId} expiresAt=${fmt(k.expiresAt)}`,
      );
    }
  } catch (e) {
    console.log(`  idempotency_keys query failed: ${(e as Error).message}`);
  }

  console.log('');
  await AppDataSource.destroy();
}

inspect().catch((err) => {
  console.error('bait-inspect failed:', err);
  process.exit(1);
});
