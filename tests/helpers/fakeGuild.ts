/**
 * Plain-object Discord guild fake for code that reads guild caches
 * (health checks first). Caches are plain `Map`s, so code under test must use
 * Map methods only (`get`, `has`, `values`), not Collection extras.
 *
 * The @everyone role always exists with the guild's id, as in Discord. The bot
 * member's permissions are a real `PermissionsBitField`, so Administrator
 * implies everything exactly like discord.js.
 */
import { ChannelType, type Guild, type PermissionResolvable, PermissionsBitField } from 'discord.js';

export const FAKE_GUILD_ID = '100000000000000001';
export const FAKE_BOT_ID = '100000000000000999';

export interface FakeRoleInit {
  id: string;
  name?: string;
  position?: number;
  managed?: boolean;
  mentionable?: boolean;
}

export interface FakeChannelInit {
  id: string;
  type?: ChannelType;
  name?: string;
  parentId?: string | null;
  /** The bot's effective permissions in this channel. Defaults to its guild-level permissions. */
  botPermissions?: PermissionResolvable;
}

export interface FakeGuildInit {
  id?: string;
  /** False simulates an outage: the caches may be incomplete. */
  available?: boolean;
  roles?: FakeRoleInit[];
  channels?: FakeChannelInit[];
  /** The bot's guild-level permissions. `null` means the bot member is not cached. */
  botPermissions?: PermissionResolvable | null;
  botHighestPosition?: number;
}

export function makeFakeGuild(init: FakeGuildInit = {}): Guild {
  const id = init.id ?? FAKE_GUILD_ID;

  const roles = new Map<string, any>();
  for (const role of [{ id, name: '@everyone', position: 0 }, ...(init.roles ?? [])]) {
    roles.set(role.id, {
      name: `role-${role.id}`,
      position: 1,
      managed: false,
      mentionable: false,
      ...role,
      guild: { id },
    });
  }

  const me =
    init.botPermissions === null
      ? null
      : {
          id: FAKE_BOT_ID,
          permissions: new PermissionsBitField(init.botPermissions ?? []),
          roles: { highest: { position: init.botHighestPosition ?? 10 } },
        };

  const channels = new Map<string, any>();
  for (const channel of init.channels ?? []) {
    const { botPermissions, ...rest } = channel;
    const perms = botPermissions === undefined ? me?.permissions : new PermissionsBitField(botPermissions);
    channels.set(channel.id, {
      name: `channel-${channel.id}`,
      type: ChannelType.GuildText,
      parentId: null,
      ...rest,
      guildId: id,
      permissionsFor: (member: unknown) => (member && member === me ? (perms ?? null) : null),
    });
  }

  return {
    id,
    name: 'Fake Guild',
    available: init.available ?? true,
    roles: { cache: roles, everyone: roles.get(id) },
    channels: { cache: channels },
    members: { me },
  } as unknown as Guild;
}
