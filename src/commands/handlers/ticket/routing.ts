/**
 * Ticket Smart Routing Command Handlers
 *
 * Handles /ticket routing-enable, routing-disable, routing-rule-add,
 * routing-rule-remove, routing-strategy, routing-stats subcommands.
 *
 * All handlers are admin-only and guild-scoped.
 */

import {
  type CacheType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { Ticket } from '../../../typeorm/entities/ticket/Ticket';
import { TicketConfig } from '../../../typeorm/entities/ticket/TicketConfig';
import { enhancedLogger, LANGF, LogCategory, lang, requireAdmin } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import {
  getStaffWorkload,
  type RoutingRule,
  type RoutingStrategy,
  resetRoundRobin,
} from '../../../utils/ticket/smartRouter';

const tl = lang.ticket.routing;
const ticketConfigRepo = lazyRepo(TicketConfig);
const ticketRepo = lazyRepo(Ticket);

const MAX_ROUTING_RULES = 25;
const VALID_STRATEGIES: RoutingStrategy[] = ['round-robin', 'least-load', 'random'];

// ============================================================================
// Helper: Get config with routing fields
// ============================================================================

interface RoutingConfig {
  smartRoutingEnabled: boolean;
  routingRules: RoutingRule[] | null;
  routingStrategy: string;
}

function getRoutingFields(config: TicketConfig): RoutingConfig {
  // Access the routing columns (added by separate migration)
  const c = config as TicketConfig & RoutingConfig;
  return {
    smartRoutingEnabled: c.smartRoutingEnabled ?? false,
    routingRules: c.routingRules ?? null,
    routingStrategy: c.routingStrategy ?? 'least-load',
  };
}

function setRoutingFields(config: TicketConfig, fields: Partial<RoutingConfig>): void {
  const c = config as TicketConfig & RoutingConfig;
  if (fields.smartRoutingEnabled !== undefined) c.smartRoutingEnabled = fields.smartRoutingEnabled;
  if (fields.routingRules !== undefined) c.routingRules = fields.routingRules;
  if (fields.routingStrategy !== undefined) c.routingStrategy = fields.routingStrategy;
}

// ============================================================================
// /ticket routing-enable
// ============================================================================

export const routingEnableHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!config.enableWorkflow) {
    await interaction.reply({
      content: tl.requiresWorkflow,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routing = getRoutingFields(config);
  if (routing.smartRoutingEnabled) {
    await interaction.reply({
      content: tl.alreadyEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  setRoutingFields(config, { smartRoutingEnabled: true });
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: tl.enabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Smart routing enabled', LogCategory.COMMAND_EXECUTION, {
    guildId,
  });
};

// ============================================================================
// /ticket routing-disable
// ============================================================================

export const routingDisableHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routing = getRoutingFields(config);
  if (!routing.smartRoutingEnabled) {
    await interaction.reply({
      content: tl.alreadyDisabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  setRoutingFields(config, { smartRoutingEnabled: false });
  await ticketConfigRepo.save(config);

  // Clear round-robin state for this guild
  resetRoundRobin(guildId);

  await interaction.reply({
    content: tl.disabled,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Smart routing disabled', LogCategory.COMMAND_EXECUTION, {
    guildId,
  });
};

// ============================================================================
// /ticket routing-rule-add <type> <role> [max-open]
// ============================================================================

export const routingRuleAddHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routing = getRoutingFields(config);
  if (!routing.smartRoutingEnabled) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const ticketTypeId = interaction.options.getString('type', true);
  const role = interaction.options.getRole('role', true);
  const maxOpen = interaction.options.getInteger('max-open') ?? undefined;

  const rules: RoutingRule[] = routing.routingRules ?? [];

  // Check for duplicate type
  if (rules.some(r => r.ticketTypeId === ticketTypeId)) {
    await interaction.reply({
      content: LANGF(tl.ruleDuplicate, ticketTypeId),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check max rules
  if (rules.length >= MAX_ROUTING_RULES) {
    await interaction.reply({
      content: LANGF(tl.maxRules, MAX_ROUTING_RULES),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const newRule: RoutingRule = {
    ticketTypeId,
    staffRoleId: role.id,
    ...(maxOpen != null ? { maxOpen } : {}),
  };

  rules.push(newRule);
  setRoutingFields(config, { routingRules: rules });
  await ticketConfigRepo.save(config);

  const maxOpenText = maxOpen != null ? ` (max ${maxOpen} open per staff)` : '';
  await interaction.reply({
    content: LANGF(tl.ruleAdded, ticketTypeId, role.name) + maxOpenText,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Routing rule added', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ticketTypeId,
    staffRoleId: role.id,
    maxOpen,
  });
};

// ============================================================================
// /ticket routing-rule-remove <type>
// ============================================================================

export const routingRuleRemoveHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routing = getRoutingFields(config);
  if (!routing.smartRoutingEnabled) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const ticketTypeId = interaction.options.getString('type', true);
  const rules: RoutingRule[] = routing.routingRules ?? [];

  const ruleIndex = rules.findIndex(r => r.ticketTypeId === ticketTypeId);
  if (ruleIndex === -1) {
    await interaction.reply({
      content: LANGF(tl.ruleNotFound, ticketTypeId),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  rules.splice(ruleIndex, 1);
  setRoutingFields(config, { routingRules: rules });
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: LANGF(tl.ruleRemoved, ticketTypeId),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Routing rule removed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ticketTypeId,
  });
};

// ============================================================================
// /ticket routing-strategy <strategy>
// ============================================================================

export const routingStrategyHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routing = getRoutingFields(config);
  if (!routing.smartRoutingEnabled) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const strategy = interaction.options.getString('strategy', true) as RoutingStrategy;

  if (!VALID_STRATEGIES.includes(strategy)) {
    await interaction.reply({
      content: LANGF(tl.invalidStrategy, VALID_STRATEGIES.join(', ')),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Reset round-robin index when switching away from it
  if (routing.routingStrategy === 'round-robin' && strategy !== 'round-robin') {
    resetRoundRobin(guildId);
  }

  setRoutingFields(config, { routingStrategy: strategy });
  await ticketConfigRepo.save(config);

  await interaction.reply({
    content: LANGF(tl.strategySet, strategy),
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.info('Routing strategy changed', LogCategory.COMMAND_EXECUTION, {
    guildId,
    strategy,
  });
};

// ============================================================================
// /ticket routing-stats
// ============================================================================

export const routingStatsHandler = async (interaction: ChatInputCommandInteraction<CacheType>) => {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message ?? '',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.reply({
      content: lang.ticket.ticketConfigNotFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const routing = getRoutingFields(config);
  if (!routing.smartRoutingEnabled) {
    await interaction.reply({
      content: tl.notEnabled,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const rules: RoutingRule[] = routing.routingRules ?? [];

  // Count assigned vs unassigned open tickets
  const assignedCount = await ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId })
    .andWhere('ticket.status != :closed', { closed: 'closed' })
    .andWhere('ticket.assignedTo IS NOT NULL')
    .getCount();

  const totalOpen = await ticketRepo
    .createQueryBuilder('ticket')
    .where('ticket.guildId = :guildId', { guildId })
    .andWhere('ticket.status != :closed', { closed: 'closed' })
    .getCount();

  const unassignedCount = totalOpen - assignedCount;

  // Build rules summary
  let rulesText = tl.noRules;
  if (rules.length > 0) {
    rulesText = rules
      .map(r => {
        const maxText = r.maxOpen != null ? ` (max: ${r.maxOpen})` : '';
        return `\`${r.ticketTypeId}\` \u2192 <@&${r.staffRoleId}>${maxText}`;
      })
      .join('\n');
  }

  // Build staff workload for all rules
  let workloadText = '';
  if (rules.length > 0 && interaction.guild) {
    const allStaffIds = new Set<string>();
    for (const rule of rules) {
      const role = interaction.guild.roles.cache.get(rule.staffRoleId);
      if (role) {
        for (const [id] of role.members) {
          if (!role.members.get(id)?.user.bot) {
            allStaffIds.add(id);
          }
        }
      }
    }

    if (allStaffIds.size > 0) {
      // Create mock GuildMember array for workload query
      const staffMembers = [...allStaffIds]
        .map(id => interaction.guild!.members.cache.get(id))
        .filter((m): m is NonNullable<typeof m> => m != null);

      if (staffMembers.length > 0) {
        const workload = await getStaffWorkload(guildId, staffMembers);
        const topStaff = workload.slice(0, 10);
        workloadText = topStaff.map(w => `<@${w.memberId}>: **${w.openTickets}** open`).join('\n');
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(tl.statsTitle)
    .setColor(0x5865f2)
    .addFields(
      {
        name: tl.statsStrategy,
        value: routing.routingStrategy,
        inline: true,
      },
      {
        name: tl.statsOpenTickets,
        value: totalOpen.toString(),
        inline: true,
      },
      {
        name: tl.statsAssigned,
        value: `${assignedCount} assigned / ${unassignedCount} unassigned`,
        inline: true,
      },
      {
        name: tl.statsRules,
        value: rulesText,
      },
    )
    .setTimestamp();

  if (workloadText) {
    embed.addFields({
      name: tl.statsWorkload,
      value: workloadText,
    });
  }

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
};

// ============================================================================
// Autocomplete: routing rule types (for removal)
// ============================================================================

export const routingRuleAutocomplete = async (interaction: {
  guildId: string | null;
  respond: (choices: { name: string; value: string }[]) => Promise<void>;
}) => {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const config = await ticketConfigRepo.findOneBy({ guildId });

  if (!config) {
    await interaction.respond([]);
    return;
  }

  const routing = getRoutingFields(config);
  if (!routing.smartRoutingEnabled) {
    await interaction.respond([]);
    return;
  }

  const rules: RoutingRule[] = routing.routingRules ?? [];
  const choices = rules.map(r => ({
    name: r.ticketTypeId,
    value: r.ticketTypeId,
  }));

  await interaction.respond(choices.slice(0, 25));
};
