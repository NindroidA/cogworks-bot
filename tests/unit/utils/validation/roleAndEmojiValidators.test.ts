/**
 * validateEmoji (#131) and validateAssignableRole (#84).
 *
 * validateEmoji must take every unicode emoji Discord reacts with: keycaps,
 * flags, skin tones and ZWJ sequences used to be rejected, which blocked them
 * in /reactionrole add and /rules-setup.
 *
 * validateAssignableRole guards every config that makes the bot grant a role:
 * the bot grants with its own Manage Roles, so without it a delegated feature
 * manager could hand themselves Administrator.
 */

import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { lang } from '../../../../src/lang';
import { validateAssignableRole, validateEmoji } from '../../../../src/utils/validation/validators';

const tl = lang.errors.assignableRole;

describe('validateEmoji', () => {
  test.each([
    ['a plain emoji', '👍'],
    ['an emoji with its variation selector', '❤️'],
    ['a ZWJ family', '👨‍👩‍👧'],
    ['a skin tone', '👍🏽'],
    ['a flag', '🇺🇸'],
    ['a keycap digit', '1️⃣'],
    ['the # keycap', '#️⃣'],
    ['a tag-sequence flag', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'],
    ['a lone regional indicator (Discord reacts with these)', '🇦'],
    ['a custom emoji', '<:blob:700000000000000001>'],
    ['an animated custom emoji', '<a:blob:700000000000000001>'],
  ])('accepts %s', (_label, emoji) => {
    expect(validateEmoji(emoji).valid).toBe(true);
  });

  test.each([
    ['text', 'a'],
    ['two emoji', '👍👍'],
    ['a digit with a variation selector but no keycap', '1️'],
    ['a flag followed by a letter', '🇺🇸🇦'],
    ['a broken custom emoji', '<:blob:123>'],
  ])('rejects %s', (_label, emoji) => {
    expect(validateEmoji(emoji).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateAssignableRole
// ---------------------------------------------------------------------------

const GUILD_ID = '100000000000000001';
const OWNER_ID = '200000000000000001';
const INVOKER_ID = '200000000000000002';

function makeCtx(opts: { botTop?: number; invokerTop?: number; invokerId?: string; admin?: boolean } = {}) {
  const fetchedMembers: string[] = [];
  const guild = {
    id: GUILD_ID,
    ownerId: OWNER_ID,
    members: {
      fetchMe: async () => ({ roles: { highest: { position: opts.botTop ?? 20 } } }),
      fetch: async (id: string) => {
        fetchedMembers.push(id);
        return { roles: { highest: { position: opts.invokerTop ?? 10 } } };
      },
    },
  };
  const memberPermissions = new PermissionsBitField(opts.admin ? PermissionFlagsBits.Administrator : 0n);
  return {
    interaction: { guild: guild as never, user: { id: opts.invokerId ?? INVOKER_ID }, memberPermissions },
    fetchedMembers,
  };
}

function role(over: Partial<{ id: string; managed: boolean; position: number; permissions: unknown }> = {}) {
  return {
    id: '300000000000000001',
    managed: false,
    position: 5,
    permissions: new PermissionsBitField(PermissionFlagsBits.SendMessages),
    ...over,
  } as never;
}

describe('validateAssignableRole', () => {
  test('accepts a plain role below the bot and the invoker', async () => {
    const { interaction } = makeCtx();
    expect(await validateAssignableRole(interaction, role())).toEqual({ valid: true });
  });

  test('rejects @everyone and managed roles', async () => {
    const { interaction } = makeCtx();
    expect((await validateAssignableRole(interaction, role({ id: GUILD_ID }))).error).toBe(tl.everyone);
    expect((await validateAssignableRole(interaction, role({ managed: true }))).error).toBe(tl.managed);
  });

  test('rejects a role at or above the bot', async () => {
    const { interaction } = makeCtx({ botTop: 5 });
    expect((await validateAssignableRole(interaction, role({ position: 5 }))).error).toBe(tl.aboveBot);
  });

  test('rejects a role at or above the invoker, even for an admin', async () => {
    const { interaction } = makeCtx({ invokerTop: 8, admin: true });
    expect((await validateAssignableRole(interaction, role({ position: 8 }))).error).toBe(tl.aboveInvoker);
  });

  test('the server owner may set up any role below the bot', async () => {
    const { interaction, fetchedMembers } = makeCtx({ invokerId: OWNER_ID, invokerTop: 1 });
    const adminRole = role({ position: 15, permissions: new PermissionsBitField(PermissionFlagsBits.Administrator) });
    expect(await validateAssignableRole(interaction, adminRole)).toEqual({ valid: true });
    expect(fetchedMembers).toEqual([]);
  });

  test.each([
    ['Administrator', PermissionFlagsBits.Administrator],
    ['Manage Roles', PermissionFlagsBits.ManageRoles],
    ['Ban Members', PermissionFlagsBits.BanMembers],
    ['Timeout Members', PermissionFlagsBits.ModerateMembers],
    ['Manage Messages', PermissionFlagsBits.ManageMessages],
    ['Mention @everyone', PermissionFlagsBits.MentionEveryone],
    ['Manage Threads', PermissionFlagsBits.ManageThreads],
    ['Manage Expressions', PermissionFlagsBits.ManageGuildExpressions],
    ['Move Members', PermissionFlagsBits.MoveMembers],
    ['Mute Members', PermissionFlagsBits.MuteMembers],
    ['Deafen Members', PermissionFlagsBits.DeafenMembers],
  ])('a non-admin feature manager cannot hand out a role with %s', async (_label, bit) => {
    const { interaction } = makeCtx();
    const result = await validateAssignableRole(interaction, role({ permissions: new PermissionsBitField(bit) }));
    expect(result).toEqual({ valid: false, error: tl.privileged });
  });

  test('a server admin can hand out a moderation role below their own', async () => {
    const { interaction } = makeCtx({ admin: true });
    const modRole = role({ permissions: new PermissionsBitField(PermissionFlagsBits.BanMembers) });
    expect(await validateAssignableRole(interaction, modRole)).toEqual({ valid: true });
  });

  test('reads the raw API role permission string from getRole()', async () => {
    const { interaction } = makeCtx();
    const apiRole = role({ permissions: String(PermissionFlagsBits.ManageGuild) });
    expect((await validateAssignableRole(interaction, apiRole)).error).toBe(tl.privileged);
    expect((await validateAssignableRole(interaction, role({ permissions: '0' }))).valid).toBe(true);
  });
});
