/**
 * /data-export Handler Unit Tests (v3.16.8 regressions)
 *
 * Before: closed DMs (or an oversized file) left the admin with a reply
 * pointing at a download button that didn't exist, and the 24h limit was
 * already spent. Now the gzipped export falls back to an attachment on the
 * ephemeral reply. The limit is given back when delivery fails, but not when
 * the export is too large, since a retry would build the same file.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dataExportHandler } from '../../../src/commands/handlers/dataExport';
import { lang } from '../../../src/utils';
import { MAX_EXPORT_ATTACHMENT_BYTES } from '../../../src/utils/offboarding/guildDataExport';
import { createRateLimitKey, rateLimiter } from '../../../src/utils/security/rateLimiter';
import { makeRepo, patchRepositories } from '../utils/archive/fakeDiscord';

const GUILD = '300000000000000001';
const LIMIT_KEY = createRateLimitKey.guild(GUILD, 'data-export');

/** Extra AuditLog rows; the too-large test fills it with incompressible data. */
let auditRows: Record<string, unknown>[] = [];

const restore = await patchRepositories(() => ({
  GuildPermission: makeRepo([{ guildId: GUILD, feature: 'tickets', roleId: 'R1', level: 'manage' }]),
  AuditLog: makeRepo(auditRows),
}));
afterAll(restore);

const originalRelease = process.env.RELEASE;
beforeEach(() => {
  process.env.RELEASE = 'prod';
  rateLimiter.destroy();
});
afterEach(() => {
  auditRows = [];
  rateLimiter.reset(LIMIT_KEY);
  process.env.RELEASE = originalRelease;
  rateLimiter.destroy();
});

function makeInteraction(opts: { dmFails?: boolean; fallbackFails?: boolean } = {}) {
  const calls = { edits: [] as any[], dms: [] as any[] };
  const interaction = {
    guildId: GUILD,
    guild: { name: 'Test Guild' },
    commandName: 'data-export',
    member: { permissions: { has: () => true } },
    deferred: false,
    user: {
      id: 'admin-1',
      tag: 'admin#0001',
      createDM: async () => ({
        send: async (o: unknown) => {
          if (opts.dmFails) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
          calls.dms.push(o);
        },
      }),
    },
    isRepliable: () => true,
    deferReply: async () => {
      interaction.deferred = true;
    },
    reply: async () => {},
    editReply: async (o: any) => {
      if (opts.fallbackFails && o.files) throw new Error('Request entity too large');
      calls.edits.push(o);
    },
  };
  return { interaction: interaction as any, calls };
}

describe('/data-export', () => {
  test('DMs a gzipped export that includes role grants and no global bot status', async () => {
    const { interaction, calls } = makeInteraction();
    await dataExportHandler({} as any, interaction);

    const file = calls.dms[0].files[0];
    expect(file.name).toEndWith('.json.gz');
    const exported = JSON.parse(gunzipSync(file.attachment).toString());
    expect(exported.data.guildPermissions).toHaveLength(1);
    expect(exported.data.botStatus).toBeUndefined();
    expect(calls.edits.at(-1).content).toBe(lang.dataExport.dmSuccess);
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(0);
  });

  test('closed DMs fall back to an attachment on the ephemeral reply', async () => {
    const { interaction, calls } = makeInteraction({ dmFails: true });
    await dataExportHandler({} as any, interaction);

    const last = calls.edits.at(-1);
    expect(last.content).toBe(lang.dataExport.dmFailed);
    expect(last.files[0].name).toEndWith('.json.gz');
  });

  test('when nothing could be delivered, the daily export is given back', async () => {
    const { interaction, calls } = makeInteraction({ dmFails: true, fallbackFails: true });
    await dataExportHandler({} as any, interaction);

    expect(calls.edits.at(-1).content).toBe(lang.dataExport.error);
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(1);
  });

  test('an export over the upload cap is refused, sends no file, and still spends the daily export', async () => {
    // ~13 MB of base64 random bytes stays ~10 MB after gzip, above the 8 MiB cap.
    auditRows = [{ guildId: GUILD, action: 'filler', details: randomBytes(10_000_000).toString('base64') }];
    const { interaction, calls } = makeInteraction();
    await dataExportHandler({} as any, interaction);

    expect(calls.dms).toHaveLength(0);
    const last = calls.edits.at(-1);
    expect(last.files).toBeUndefined();
    const [before, after] = lang.dataExport.tooLarge.split('{size}');
    expect(last.content).toStartWith(before);
    expect(last.content).toEndWith(after);
    const size = last.content.slice(before.length, last.content.length - after.length);
    expect(size).toMatch(/^\d+(\.\d+)? MB$/);
    expect(Number.parseFloat(size) * 1024 * 1024).toBeGreaterThan(MAX_EXPORT_ATTACHMENT_BYTES);
    // A retry would build the same file, so the limit is not given back.
    expect(rateLimiter.getRemaining(LIMIT_KEY, 1)).toBe(0);
  });
});
