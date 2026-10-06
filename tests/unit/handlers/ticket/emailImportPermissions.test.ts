/**
 * Email-import channel overwrites (v3.16.11 regression).
 *
 * The channel used to grant only the bot and the global staff role, and the
 * global staff role was parsed with a mention-only regex — v3 setup stores it
 * raw, so it was silently dropped. The importer and every saved staff role
 * were left out, so a non-admin importer couldn't open the ticket they made.
 */

import { describe, expect, test } from 'bun:test';
import { PermissionsBitField } from 'discord.js';
import { buildEmailTicketPermissions } from '../../../../src/commands/handlers/ticket/emailImport';
import type { BotConfig } from '../../../../src/typeorm/entities/BotConfig';
import { PermissionSets } from '../../../../src/utils/validation/permissionValidator';

const GUILD = '999999999999999999';
const IMPORTER = '423456789012345678';
const BOT = '523456789012345678';
const STAFF = '123456789012345678';
const ADMIN = '223456789012345678';
const GLOBAL = '623456789012345678';
const DELETED = '323456789012345678';

const existingRoles = new Set([GUILD, STAFF, ADMIN, GLOBAL]);

function build(botConfig: Partial<BotConfig>, staffRoleRefs: string[]) {
  return buildEmailTicketPermissions({
    guildId: GUILD,
    importerId: IMPORTER,
    botUserId: BOT,
    botConfig: botConfig as BotConfig,
    staffRoleRefs,
    existingRoles,
  });
}

describe('buildEmailTicketPermissions', () => {
  test('grants the importer, saved staff roles (raw + legacy), the raw global staff role and the bot', () => {
    const overwrites = build({ enableGlobalStaffRole: true, globalStaffRole: GLOBAL }, [STAFF, `<@&${ADMIN}>`]);

    expect(overwrites.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, ADMIN, GLOBAL, BOT]);
    expect(overwrites[0].deny).toEqual(PermissionSets.DENY_ALL);
    expect(overwrites.find(o => o.id === IMPORTER)?.allow).toBe(PermissionSets.STAFF_MEMBER);
    expect(overwrites.find(o => o.id === BOT)?.allow).toContain(PermissionsBitField.Flags.ManageChannels);
  });

  test('skips a disabled global staff role, duplicates and deleted roles', () => {
    const disabled = build({ enableGlobalStaffRole: false, globalStaffRole: GLOBAL }, [STAFF]);
    expect(disabled.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, BOT]);

    const messy = build({ enableGlobalStaffRole: true, globalStaffRole: `<@&${STAFF}>` }, [
      STAFF,
      DELETED,
      '@everyone',
    ]);
    expect(messy.map(o => o.id)).toEqual([GUILD, IMPORTER, STAFF, BOT]);
  });
});
