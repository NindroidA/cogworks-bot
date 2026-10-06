/**
 * /data-export Handler Unit Tests (v3.16.8 regressions)
 *
 * Before: closed DMs (or an oversized file) left the admin with a reply
 * pointing at a download button that didn't exist, and the 24h limit was
 * already spent. Now the gzipped export falls back to an attachment on the
 * ephemeral reply, and the limit is given back whenever nothing was delivered.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { gunzipSync } from 'node:zlib';
import { dataExportHandler } from '../../../src/commands/handlers/dataExport';
import { lang } from '../../../src/utils';
import { createRateLimitKey, rateLimiter } from '../../../src/utils/security/rateLimiter';
import { makeRepo, patchRepositories } from '../utils/archive/fakeDiscord';

const GUILD = '300000000000000001';
const LIMIT_KEY = createRateLimitKey.guild(GUILD, 'data-export');

const restore = await patchRepositories(() => ({
  GuildPermission: makeRepo([{ guildId: GUILD, feature: 'tickets', roleId: 'R1', level: 'manage' }]),
}));
afterAll(restore);

const originalRelease = process.env.RELEASE;
beforeEach(() => {
  process.env.RELEASE = 'prod';
  rateLimiter.destroy();
});
afterEach(() => {
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
});
