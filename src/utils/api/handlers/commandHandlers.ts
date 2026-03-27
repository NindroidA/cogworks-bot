/**
 * Command Handlers — GET /internal/commands
 *
 * Returns all registered slash commands in a structured format
 * for the webapp's interactive command browser.
 */

import type { RouteHandler } from '../router';

// Discord API option types
const OPTION_TYPE_SUB_COMMAND = 1;
const OPTION_TYPE_SUB_COMMAND_GROUP = 2;

/** Category mapping for command grouping */
const COMMAND_CATEGORIES: Record<string, string> = {
  'bot-setup': 'Setup',
  'bot-reset': 'Setup',
  'ticket-setup': 'Setup',
  'application-setup': 'Setup',
  'announcement-setup': 'Setup',
  'memory-setup': 'Setup',
  'rules-setup': 'Setup',
  'xp-setup': 'Setup',
  ticket: 'Tickets',
  application: 'Applications',
  announcement: 'Announcements',
  baitchannel: 'Moderation',
  automod: 'Moderation',
  memory: 'Memory',
  reactionrole: 'Roles',
  role: 'Roles',
  starboard: 'Engagement',
  xp: 'Engagement',
  rank: 'Engagement',
  leaderboard: 'Engagement',
  onboarding: 'Engagement',
  event: 'Events',
  insights: 'Analytics',
  import: 'Data',
  'data-export': 'Data',
  archive: 'Data',
  migrate: 'Data',
  status: 'System',
  ping: 'System',
  server: 'System',
  coffee: 'System',
  dashboard: 'System',
};

interface CommandOption {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: CommandOption[];
  choices?: Array<{ name: string; value: string }>;
}

interface CommandJson {
  name: string;
  description: string;
  default_member_permissions?: string | null;
  options?: CommandOption[];
  type?: number;
}

interface SubcommandInfo {
  name: string;
  description: string;
  usage: string;
  options?: Array<{ name: string; description: string; required: boolean; type: string }>;
}

interface SubcommandGroupInfo {
  name: string;
  description: string;
  subcommands: SubcommandInfo[];
}

interface CommandInfo {
  name: string;
  description: string;
  usage: string;
  category: string;
  permissions: string[];
  subcommands: SubcommandInfo[];
  subcommandGroups: SubcommandGroupInfo[];
}

const OPTION_TYPE_NAMES: Record<number, string> = {
  3: 'string',
  4: 'integer',
  5: 'boolean',
  6: 'user',
  7: 'channel',
  8: 'role',
  10: 'number',
  11: 'attachment',
};

const PERMISSION_NAMES: Record<string, string> = {
  '8': 'Administrator',
  '32': 'Manage Server',
};

function formatSubcommandOptions(options: CommandOption[] | undefined) {
  if (!options) return undefined;
  return options
    .filter(o => o.type !== OPTION_TYPE_SUB_COMMAND && o.type !== OPTION_TYPE_SUB_COMMAND_GROUP)
    .map(o => ({
      name: o.name,
      description: o.description,
      required: o.required ?? false,
      type: OPTION_TYPE_NAMES[o.type] ?? 'string',
    }));
}

function buildUsage(commandName: string, groupName: string | null, subName: string, options?: CommandOption[]): string {
  const base = groupName ? `/${commandName} ${groupName} ${subName}` : `/${commandName} ${subName}`;
  if (!options) return base;

  const params = options
    .filter(o => o.type !== OPTION_TYPE_SUB_COMMAND && o.type !== OPTION_TYPE_SUB_COMMAND_GROUP)
    .map(o => (o.required ? `<${o.name}>` : `[${o.name}]`))
    .join(' ');

  return params ? `${base} ${params}` : base;
}

function parseSubcommand(commandName: string, groupName: string | null, opt: CommandOption): SubcommandInfo {
  return {
    name: opt.name,
    description: opt.description,
    usage: buildUsage(commandName, groupName, opt.name, opt.options),
    options: formatSubcommandOptions(opt.options),
  };
}

function parseCommand(cmd: CommandJson): CommandInfo | null {
  // Skip context menu commands (type 2 = user, type 3 = message)
  if (cmd.type && cmd.type !== 1) return null;

  const name = cmd.name;
  const category = COMMAND_CATEGORIES[name] ?? 'Other';
  const permissions = cmd.default_member_permissions
    ? [PERMISSION_NAMES[cmd.default_member_permissions] ?? cmd.default_member_permissions]
    : [];

  const subcommands: SubcommandInfo[] = [];
  const subcommandGroups: SubcommandGroupInfo[] = [];

  if (cmd.options) {
    for (const opt of cmd.options) {
      if (opt.type === OPTION_TYPE_SUB_COMMAND_GROUP) {
        const groupSubs = (opt.options ?? [])
          .filter(s => s.type === OPTION_TYPE_SUB_COMMAND)
          .map(s => parseSubcommand(name, opt.name, s));
        subcommandGroups.push({
          name: opt.name,
          description: opt.description,
          subcommands: groupSubs,
        });
      } else if (opt.type === OPTION_TYPE_SUB_COMMAND) {
        subcommands.push(parseSubcommand(name, null, opt));
      }
    }
  }

  // Build usage string
  let usage: string;
  if (subcommandGroups.length > 0) {
    usage = `/${name} <group> <subcommand>`;
  } else if (subcommands.length > 0) {
    usage = `/${name} <subcommand>`;
  } else {
    const params = (cmd.options ?? []).map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    usage = params ? `/${name} ${params}` : `/${name}`;
  }

  return {
    name,
    description: cmd.description,
    usage,
    category,
    permissions,
    subcommands,
    subcommandGroups,
  };
}

export function registerCommandHandlers(routes: Map<string, RouteHandler>): void {
  // Lazy-load to avoid circular dependency with command builders
  let cachedResponse: Record<string, unknown> | null = null;

  routes.set('GET /internal/commands', async () => {
    if (cachedResponse) return cachedResponse;

    const { commands } = await import('../../../commands/commandList');

    const parsed: CommandInfo[] = [];
    for (const cmd of commands) {
      const info = parseCommand(cmd as unknown as CommandJson);
      if (info) parsed.push(info);
    }

    // Sort by category then name
    parsed.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const categories = [...new Set(parsed.map(c => c.category))].sort();

    cachedResponse = { commands: parsed, categories };
    return cachedResponse;
  });
}
