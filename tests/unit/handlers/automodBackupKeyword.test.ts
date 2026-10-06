/**
 * AutoMod backup/restore round trip and keyword remove (v3.16.33).
 *
 * Restore used to drop the alert channel (so alert rules failed to create),
 * the exemptions, the allow list and keyword presets, and reported failures
 * only as a lower count. Keyword remove lowercased its input, so keywords
 * added with capitals in Server Settings could not be removed.
 */

import { describe, expect, jest, spyOn, test } from 'bun:test';
import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  Collection,
} from 'discord.js';
import { backupHandler } from '../../../src/commands/handlers/automod/backup';
import { keywordHandler } from '../../../src/commands/handlers/automod/keyword';
import { lang } from '../../../src/lang';
import { createAutoModRule, serializeRules } from '../../../src/utils/automod/helpers';

const tl = lang.automod;
const GUILD_ID = '100000000000000001';
const ALERT_CHANNEL = '400000000000000001';
const GONE_CHANNEL = '400000000000000002';
const MOD_ROLE = '300000000000000001';
const GONE_ROLE = '300000000000000002';

function makeGuild(create = jest.fn(async (options: unknown) => options)) {
  return {
    id: GUILD_ID,
    name: 'Test',
    channels: { cache: new Map([[ALERT_CHANNEL, {}]]) },
    roles: { cache: new Map([[MOD_ROLE, {}]]) },
    autoModerationRules: { fetch: async () => new Collection(), create },
  };
}

describe('AutoMod serialization', () => {
  test('a backup keeps keyword presets', () => {
    const rule = {
      name: 'Presets',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      triggerMetadata: { presets: [AutoModerationRuleKeywordPresetType.Slurs], allowList: ['ok'] },
      actions: [{ type: AutoModerationActionType.BlockMessage, metadata: {} }],
      enabled: true,
      exemptRoles: new Collection([[MOD_ROLE, { id: MOD_ROLE }]]),
      exemptChannels: new Collection(),
    };
    const backup = serializeRules(new Collection([['1', rule]]) as never, makeGuild() as never);
    expect(backup.rules[0].triggerMetadata).toMatchObject({
      presets: [AutoModerationRuleKeywordPresetType.Slurs],
      allowList: ['ok'],
    });
    expect(backup.rules[0].exemptRoles).toEqual([MOD_ROLE]);
  });

  test('createAutoModRule passes the alert channel, exemptions, allow list and presets to Discord', async () => {
    const guild = makeGuild();
    await createAutoModRule(guild as never, {
      name: 'Full',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: ['bad'], allowList: ['badge'] },
      actions: [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channelId: ALERT_CHANNEL } }],
      enabled: true,
      exemptRoles: [MOD_ROLE],
      exemptChannels: [ALERT_CHANNEL],
    });
    expect(guild.autoModerationRules.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerMetadata: { keywordFilter: ['bad'], allowList: ['badge'] },
        actions: [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: ALERT_CHANNEL } }],
        exemptRoles: [MOD_ROLE],
        exemptChannels: [ALERT_CHANNEL],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// /automod backup restore
// ---------------------------------------------------------------------------

function serializedRule(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: { keywordFilter: ['bad'], regexPatterns: [], allowList: ['badge'] },
    actions: [
      { type: AutoModerationActionType.BlockMessage, metadata: {} },
      { type: AutoModerationActionType.SendAlertMessage, metadata: { channelId: ALERT_CHANNEL } },
    ],
    enabled: true,
    exemptRoles: [MOD_ROLE, GONE_ROLE],
    exemptChannels: [GONE_CHANNEL],
    ...overrides,
  };
}

async function runRestore(rules: unknown[], create: ReturnType<typeof jest.fn>) {
  const backup = { version: 1, guildId: GUILD_ID, guildName: 'Test', exportedAt: '', rules };
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => new Response(JSON.stringify(backup))) as never);
  const button = { customId: 'automod_restore_yes', update: jest.fn(async () => undefined), editReply: jest.fn(async () => undefined) };
  const interaction: any = {
    guild: makeGuild(create),
    user: { id: '200000000000000001' },
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => 'restore',
      getAttachment: () => ({ name: 'automod.json', url: 'https://cdn.example/automod.json' }),
    },
    editReply: jest.fn(async () => ({ awaitMessageComponent: async () => button })),
  };
  interaction.deferReply = jest.fn(async () => {
    interaction.deferred = true;
  });
  try {
    await backupHandler({} as never, interaction);
  } finally {
    fetchSpy.mockRestore();
  }
  return button.editReply.mock.calls[0]?.[0]?.embeds?.[0]?.data as { description: string } | undefined;
}

describe('/automod backup restore', () => {
  test('restores the alert channel, allow list and the exemptions that exist here', async () => {
    const create = jest.fn(async (options: unknown) => options);
    const embed = await runRestore([serializedRule('Full')], create);

    expect(create).toHaveBeenCalledTimes(1);
    const options = create.mock.calls[0][0] as Record<string, any>;
    expect(options.actions[1]).toEqual({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: ALERT_CHANNEL } });
    expect(options.triggerMetadata.allowList).toEqual(['badge']);
    expect(options.exemptRoles).toEqual([MOD_ROLE]);
    expect(options.exemptChannels).toEqual([]);
    expect(embed?.description).toBe(lang.automod.restore.success.replace('{0}', '1'));
  });

  test('names each rule that was not restored, and why', async () => {
    const create = jest.fn(async (options: { name: string }) => {
      if (options.name === 'Rejected') throw new Error('Invalid Form Body');
      return options;
    });
    const goneAlert = serializedRule('Gone alert', {
      actions: [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channelId: GONE_CHANNEL } }],
    });
    const embed = await runRestore([serializedRule('Kept'), goneAlert, serializedRule('Rejected')], create);

    // The rule whose alert channel is gone is never sent to Discord
    expect(create.mock.calls.map(c => (c[0] as { name: string }).name)).toEqual(['Kept', 'Rejected']);
    expect(embed?.description).toContain(lang.automod.restore.success.replace('{0}', '1'));
    expect(embed?.description).toContain(tl.restore.failedList.replace('{0}', '2'));
    expect(embed?.description).toContain(`**Gone alert**: ${tl.restore.alertChannelMissing}`);
    expect(embed?.description).toContain('**Rejected**: Invalid Form Body');
  });
});

// ---------------------------------------------------------------------------
// /automod keyword remove
// ---------------------------------------------------------------------------

describe('/automod keyword remove', () => {
  test('removes a keyword stored with capitals', async () => {
    const edit = jest.fn(async () => undefined);
    const rule = {
      name: 'Scams',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: ['FreeNitro', 'scam'] },
      edit,
    };
    const interaction = {
      guild: { id: GUILD_ID, autoModerationRules: { fetch: async () => new Collection([['r1', rule]]) } },
      user: { id: '200000000000000001' },
      options: {
        getSubcommandGroup: () => 'keyword',
        getSubcommand: () => 'remove',
        getString: (name: string) => (name === 'rule' ? 'r1' : 'FreeNitro'),
      },
      reply: jest.fn(async () => undefined),
    };

    await keywordHandler({} as never, interaction as never);

    expect(edit).toHaveBeenCalledWith({ triggerMetadata: expect.objectContaining({ keywordFilter: ['scam'] }) });
  });
});
