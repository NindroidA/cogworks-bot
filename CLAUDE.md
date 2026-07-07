# Cogworks Bot - CLAUDE.md

## Quick Reference
- **Stack**: Discord.js v14 + TypeScript + TypeORM + MySQL
- **Runtime**: Bun
- **Deployment**: Docker containers
- **Branches**: `main` (production)
- **Version**: 3.14.4 (see `package.json` — this line drifts; trust the package)

## Critical Rules

### Multi-Server Data Isolation
**CRITICAL**: All database operations MUST be guild-scoped to prevent cross-server data leaks.
- Every entity has a `guildId` column with index: `@Index(['guildId'])`
- Always filter queries by `guildId`: `await repo.find({ where: { guildId } })`
- Use helper from `src/utils/database/guildQueries.ts` for safe queries

```typescript
// CRITICAL BUG - Query matches user across ALL guilds
const archivedTicket = await archivedTicketRepo.findOneBy({ createdBy });

// CORRECT - Guild-scoped query
const archivedTicket = await archivedTicketRepo.findOneBy({ guildId, createdBy });
```

### Deletion Order: Discord First, Then DB
Always delete Discord objects before database records to prevent orphaned objects:
```typescript
import { verifiedChannelDelete, verifiedThreadDelete, buildErrorMessage } from '../utils';

// Delete Discord first → verify → then DB
const result = await verifiedChannelDelete(channel, { guildId, label: 'ticket channel' });
if (!result.success) {
  // Don't delete from DB — Discord object still exists
  await interaction.reply({ content: buildErrorMessage('Failed to delete the channel.') });
  return;
}
// Now safe to remove from DB
await repo.remove(entity);
```
- Helpers: `verifiedMessageDelete`, `verifiedChannelDelete`, `verifiedThreadDelete`, `verifiedMessageDeleteById`
- Each returns `{ success, alreadyGone, error? }` — "already gone" (10003/10008) counts as success
- `buildErrorMessage(msg)` appends a bug report link for unexpected failures
- Source: `src/utils/discord/verifiedDelete.ts`

## Architecture

### Layering rule

```
events ─┬─► utils ◄─┬─ commands/handlers
        │           │
        └─► entities (typeorm/) ◄────────┘
```

`events/*` and `commands/handlers/*` both depend on `utils/*` and `typeorm/entities/*`. Cross-cutting workflows (close ticket, archive application, XP config caching, etc.) belong in `utils`, not in a slash-command handler — both events and slash commands then call into the same util.

**Documented exception — dispatch:** the autocomplete + interaction-route dispatchers (`src/events/autocomplete.ts`, `src/events/ticket/interactionRoutes.ts`, `src/events/application/interactionRoutes.ts`, `src/events/typeFieldsInteraction.ts`, `src/events/applicationFieldsInteraction.ts`) DO import handler functions from `commands/handlers`. That's intentional — they exist precisely to route Discord interactions to the right per-command handler. Don't try to "fix" the dependency direction by moving handlers to utils; the per-command logic lives with its slash command builder, and the dispatcher is the bridge.

Entities never import from utils (the entity is the data shape; the runtime helper consumes the shape). If you find an entity importing a util-side type, the type belongs with the entity — see `typeorm/entities/ticket/routingTypes.ts` for the pattern.

### Command Handler Pattern
All commands follow this structure (see `src/commands/commands.ts`):
```typescript
// 1. Global rate limit check (30 cmd/min per user)
// 2. Guild validation
// 3. BotConfig check (except /bot-setup)
// 4. Route to handler in src/commands/handlers/
// 5. Record metrics: healthMonitor.recordCommand(commandName, executionTime, failed)
```

### Subcommand Group Pattern
Commands with many subcommands use **subcommand groups** (Discord limit: 25 per level):
```typescript
// Builder: /ticket type add, /ticket sla stats, /baitchannel escalation enable
builder.addSubcommandGroup(group => group.setName('type').setDescription('...').addSubcommand(...))

// Router: use getSubcommandGroup() + getSubcommand()
const group = interaction.options.getSubcommandGroup(true);
const subcommand = interaction.options.getSubcommand();
const handler = TICKET_GROUP_ROUTES[group]?.[subcommand];
```
Commands using groups: `ticket` (5 groups), `baitchannel` (6 groups), `application`, `event`, `announcement`, `automod`, `role`.

### Language System
Use centralized `lang` module (NOT hardcoded strings):
```typescript
import { lang } from '../utils';
lang.ticket.created;          // Direct access
lang.ticketSetup.createTicket; // Setup strings are under ticketSetup/applicationSetup keys
```
Translation files: per-locale dirs `src/lang/<locale>/*.json` (en, es, fr, de, pt-BR — English is the Proxy fallback) with types in `src/lang/types.ts`.

### Error Handling
```typescript
// Pre-reply: log + send a user-facing error embed
await handleInteractionError(interaction, error, 'Custom context message');

// Post-deferReply cleanup: log only (caller follows up with editReply)
import { logHandlerError } from '../utils';
} catch (error) {
  logHandlerError('Memory tag-add', error, { guildId });
  await interaction.editReply({ content: tl.tags.add.error });
}

// For non-interaction code
const { category, severity } = classifyError(error);
logError({ category, severity, message: 'Description', error, context });

// User-facing errors with bug report link
import { buildErrorMessage } from '../utils';
await interaction.reply({ content: buildErrorMessage('Something went wrong.') });
```
- ErrorCategory: `DATABASE`, `PERMISSIONS`, `VALIDATION`, `CONFIGURATION`, `EXTERNAL_API`, `UNKNOWN`
- ErrorSeverity: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`
- `handleInteractionError` vs `logHandlerError`: the former logs AND replies with an error embed (use pre-reply); the latter logs only (use post-`deferReply` when the handler still wants to control its own `editReply` body).

**Modal Timeout Feedback** — Use `notifyModalTimeout(interaction)` in `awaitModalSubmit` catch blocks:
```typescript
const modal = await interaction.awaitModalSubmit({ time: 300_000 })
    .catch(async () => { await notifyModalTimeout(interaction); return null; });
if (!modal) return;
```

### Rate Limiting
Multi-level protection via `src/utils/security/rateLimiter.ts`:
```typescript
const key = createRateLimitKey.user(userId, 'ticket-create');
const check = rateLimiter.check(key, RateLimits.TICKET_CREATE);
if (!check.allowed) { /* deny */ }
```

### Permission Validation
Prefer the `guard*` wrappers from `utils/interactions` over the raw `require*` validators — they reply ephemerally and return `{ allowed }` in one line. Use feature-scoped guards when the action is in the `FEATURES` catalog (see `src/utils/validation/featurePermission.ts`); reserve `guardAdmin` / `guardOwner` for meta-features (`/bot-setup`, `/bot-reset`, `/data-export`, `/status`).

```typescript
import { guardAdmin, guardOwner, guardFeatureAccess, guardFeatureRateLimit } from '../utils';

// Admin (legacy / meta-features)
const guard = await guardAdmin(interaction);
if (!guard.allowed) return;

// Bot owner only (status commands, dev tools)
const guard = await guardOwner(interaction);
if (!guard.allowed) return;

// Feature-scoped — preferred for anything in FEATURES
const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
if (!guard.allowed) return;

// Feature + rate limit (drop-in for guardAdminRateLimit)
const guard = await guardFeatureRateLimit(interaction, 'tickets', 'manage', {
  action: 'ticket-create',
  limit: RateLimits.TICKET_CREATE,
});
if (!guard.allowed) return;
```

Levels: `'use'` (read-only / view), `'manage'` (mutate config / per-item CRUD), `'admin'` (GDPR-scoped or destructive). Higher levels satisfy lower ones. Unconfigured guilds fall back to admin-only via `hasFeatureAccess`. Raw validators (`requireAdmin`, `hasRole`, `hasPermission`, `hasAnyPermission`, `requireBotOwner`) are still exported but should be reserved for cases the wrappers don't cover (e.g. permission overwrite assembly, non-interaction code paths).

### Input Sanitization
Use helpers from `src/utils/validation/inputSanitizer.ts`:
```typescript
import { sanitizeUserInput, escapeDiscordMarkdown, validateSnowflake, truncateWithNotice } from '../utils';

const clean = sanitizeUserInput(rawInput, { escapeMarkdown: true, maxLength: 2048 });
```
**Decision Framework:**
- User content displayed as-is in its own section → NO escaping
- User content inserted WITHIN a markdown structure → Escape
- User content used in embed fields → No escaping (Discord handles it)

### Constants Module
All magic numbers centralized in `src/utils/constants.ts`:
```typescript
import { CACHE_TTL, INTERVALS, RETENTION_DAYS, MAX, TEXT_LIMITS } from '../utils';
```

### Shared REST Client
```typescript
import { CLIENT_ID, getRest } from '../utils/restClient';
await getRest().put(...); // lazy — constructs the REST client on first call
```

### Lazy Repository Pattern
Use `lazyRepo()` for deferred repository initialization (avoids accessing DataSource before it's ready):
```typescript
import { lazyRepo } from '../utils/database/lazyRepo';
const ticketRepo = lazyRepo(TicketConfig);
// Use ticketRepo like AppDataSource.getRepository(TicketConfig) — same API
```

### Interaction Helpers
Standardized patterns for common Discord interaction flows (`src/utils/interactions/`):
```typescript
import { guardAdminRateLimit, awaitConfirmation, showAndAwaitModal, RateLimits, TIMEOUTS } from '../utils';

// Combined admin + rate limit guard (replaces 8-12 lines of boilerplate)
const guard = await guardAdminRateLimit(interaction, {
  action: 'ticket-create',
  limit: RateLimits.TICKET_CREATE,
  scope: 'user', // or 'guild', 'userGuild'
});
if (!guard.allowed) return;

// Standardized confirm/cancel button flow
const result = await awaitConfirmation(interaction, {
  message: 'Delete this item?',
  confirmStyle: ButtonStyle.Danger,
});
if (!result) return; // cancelled or timed out
await result.interaction.editReply({ content: 'Deleted!' });

// Modal show + await + timeout notification
const submit = await showAndAwaitModal(interaction, modal);
if (!submit) return; // timed out, user notified automatically
```

### Client-Attached Managers
BaitChannelManager and StatusManager are attached to the Discord client via `ExtendedClient`:
```typescript
import type { ExtendedClient } from '../types/ExtendedClient';
const { baitChannelManager, statusManager } = client as ExtendedClient;
```

## Database

### TypeORM Patterns
```typescript
@Entity({ name: 'tickets' })
@Index(['guildId', 'status'])
export class Ticket {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    guildId: string;  // REQUIRED on all multi-guild entities
}
```

### Data Source Access
```typescript
import { AppDataSource } from '../typeorm';
const repo = AppDataSource.getRepository(Ticket);
```

### All Entities
```
src/typeorm/entities/
├── AuditLog.ts           # Dashboard action audit log (90-day TTL)
├── BotConfig.ts          # Per-guild bot configuration
├── GuildPermission.ts    # Feature-based permission overrides (v3.1.3)
├── SetupState.ts         # Persistent setup dashboard state (v3)
├── StaffRole.ts          # Staff/saved roles (table: staff_roles)
├── UserActivity.ts       # User activity tracking
├── analytics/            # AnalyticsConfig, AnalyticsSnapshot
├── announcement/         # AnnouncementConfig, AnnouncementLog, AnnouncementTemplate
├── application/          # ApplicationConfig, ArchivedApplicationConfig, Position, Application, ArchivedApplication
├── bait/                 # BaitChannelConfig, BaitChannelLog, BaitKeyword, JoinEvent, PendingAction, IdempotencyKey
├── event/                # EventConfig, EventTemplate, EventReminder
├── import/               # ImportLog
├── memory/               # MemoryConfig, MemoryItem, MemoryTag
├── onboarding/           # OnboardingConfig, OnboardingCompletion
├── reactionRole/         # ReactionRoleMenu, ReactionRoleOption (CASCADE)
├── rules/                # RulesConfig
├── shared/               # CustomInputField (interface, not an entity)
├── starboard/            # StarboardConfig, StarboardEntry
├── status/               # BotStatus (singleton, PrimaryColumn id=1), StatusIncident
├── ticket/               # TicketConfig, ArchivedTicketConfig, Ticket, ArchivedTicket,
│                         #   CustomTicketType, UserTicketRestriction
└── xp/                   # XPConfig, XPUser, XPRoleReward
```

### Migrations
In **dev** mode (`RELEASE=dev`), `synchronize: true` auto-syncs. In **prod**, `migrationsRun: true` runs pending migrations.
```bash
bun run migration:generate src/typeorm/migrations/$(date +%s)000-DescriptiveName
bun run migration:run
bun run migration:revert
```

### Legacy Data Migrations
Application-level migrations run on startup for semantic data transforms:
```typescript
import { LegacyMigrationRunner } from '../utils/database/legacyMigration';
const runner = new LegacyMigrationRunner({ concurrency: 5 });
runner.register(myMigration);
await runner.runAll(guildIds);
```

## Development

### Environment Variables
- `RELEASE=dev` → `DEV_BOT_TOKEN` + `DEV_CLIENT_ID` (separate bot)
- `RELEASE=prod` → `BOT_TOKEN` + `CLIENT_ID` (production)
- `MYSQL_DB_HOST` / `MYSQL_DB_PORT` / `MYSQL_DB_USERNAME` / `MYSQL_DB_PASSWORD` / `MYSQL_DB_DATABASE` — DataSource connection
- `MAINTENANCE_MODE=true` — Lightweight mode, no DB, replies with maintenance message (see `src/maintenance.ts`)
- `BOT_OWNER_ID` — Required for `/status` commands
- `DEV_GUILD_ID` — Skips API webhooks and join velocity for this guild
- `COGWORKS_INTERNAL_API_TOKEN` — Bearer token for internal API
- `BOT_INTERNAL_PORT` — Internal API port (default: 3002)
- `HEALTH_PORT` — Health server port
- `APPEAL_HMAC_SECRET` — 32+ byte random secret (v3.2.0). Required only when any guild has `BaitChannelConfig.enableAppealLink=true`; signed appeal URLs are silently omitted from DMs when missing.
- `ERROR_WEBHOOK_URL` / `ERROR_REPORTING_ENABLED` — Discord error-reporter webhook (v3.1.1; default on in prod, off in dev)
- `STATUS_CHANNEL_ID` — Channel for the status manager's persistent embed
- `MEMORY_ALERT_CHANNEL_ID` — Memory watchdog alert channel (falls back to `STATUS_CHANNEL_ID`); tunables: `MEMORY_WARN_HEAP_PCT`, `MEMORY_CRIT_HEAP_PCT`, `MEMORY_MAP_WARN_SIZE`
- `MEMORY_THRESHOLD_MB` — Health-check memory threshold (healthMonitor/healthServer, default 512)
- `API_URL` — External dashboard API endpoint (apiConnector + guild webhooks)
- `DASHBOARD_URL` — Base URL for user-facing dashboard links (`/dashboard` command, profile embeds)
- `NODE_ENV` — Log level / file logging / colorization (enhancedLogger)

### Build & Run
```bash
bun run dev        # Development with watch mode
bun run build      # Compile TypeScript to dist/
bun run start      # Production: run directly with Bun
bun test           # Unit tests (Bun test runner)
```

### Linting & Formatting (Biome)
```bash
bun run check      # Lint + format check (CI-friendly)
bun run check:fix  # Lint + format with auto-fix
```
Config: `biome.json` — single quotes, semicolons, trailing commas, 120 char line width.

### Docker
```bash
docker build -t cogworks-bot .
docker compose up -d
docker compose logs -f cogworks-bot
```

### Health Monitoring
```typescript
healthMonitor.initialize(client);
healthServer.start(HEALTH_PORT);
// GET /health, /health/ready, /health/live
```

### Enhanced Logging
```typescript
import { enhancedLogger, LogCategory } from './utils';
enhancedLogger.info('Bot started', LogCategory.SYSTEM, { guilds: count });
enhancedLogger.error('Query failed', error, LogCategory.DATABASE);
```
Categories: `SYSTEM`, `DATABASE`, `COMMAND_EXECUTION`, `ERROR`, `API`, `SECURITY`, `GUILD_LIFECYCLE`, `RATE_LIMIT`, `PERMISSION`, `PERFORMANCE`

## File Organization

### Directory Structure
```
src/
├── commands/
│   ├── builders/           # SlashCommandBuilder definitions
│   ├── handlers/           # Command execution logic (grouped by feature)
│   │   ├── analytics/      # /analytics command: overview, growth, channels, hours, setup
│   │   ├── announcement/   # handler, setup, templates
│   │   ├── application/    # applicationSetup, applicationFields, applicationPosition
│   │   ├── archive/        # cleanup (export + delete archived data)
│   │   ├── baitChannel/    # setup, detection, keywords, stats, settings, etc.
│   │   ├── botSetup/       # Unified setup dashboard (v3)
│   │   │   ├── index.ts          # Dashboard controller
│   │   │   ├── setupDashboard.ts # Embed builder + state detection
│   │   │   └── systemFlows.ts    # Per-system auto-create + config flows
│   │   ├── contextMenus/   # Right-click context menu commands
│   │   ├── dev/            # devSuite, devTest, scaffold, workflows
│   │   ├── memory/         # add, capture, update, delete, tags, manageTags, setup
│   │   ├── reactionRole/   # create, add, remove, edit, delete, list, validate
│   │   ├── rules/          # setup
│   │   ├── shared/         # fieldManagerCore (generic field management)
│   │   ├── ticket/         # typeAdd, typeEdit, workflow, emailImport, setup, etc.
│   │   ├── botReset.ts     # Factory reset with archive + cleanup
│   │   └── ...
│   ├── commands.ts         # Central routing hub
│   └── commandList.ts      # Command registration list
├── events/                 # Discord event handlers
│   ├── channelDelete.ts    # Config cleanup for 13 entities
│   ├── messageDelete.ts    # Config cleanup for 8 entities
│   ├── roleDelete.ts       # Config cleanup for 9 entities
│   ├── threadDelete.ts     # MemoryItem cleanup
│   ├── guildDelete.ts      # GDPR: full data purge
│   └── ...
├── lang/                   # Translation JSON + TypeScript types
├── typeorm/
│   ├── entities/           # Database models (see entity list above)
│   ├── migrations/         # TypeORM migrations
│   └── index.ts            # DataSource configuration
├── utils/
│   ├── analytics/          # activityTracker, snapshot query helpers
│   ├── announcement/       # preview builders, send orchestration
│   ├── api/                # Internal API server, router, handlers, guildWebhook, helpers
│   ├── application/        # closeWorkflow (archiveAndCloseApplication)
│   ├── archive/            # archiveExporter (export + delete archived data)
│   ├── automod/            # automod rules + feature setup
│   ├── baitChannel/        # BaitChannelManager + whitelist + keyword helpers
│   ├── database/           # guildQueries, logCleanup, legacyMigration, lazyRepo, statusFlip, configCache
│   ├── discord/            # verifiedDelete (deletion with verification + bug report)
│   ├── event/              # event template + reminder helpers
│   ├── import/             # mee6 / bot-import helpers (some deferred)
│   ├── interactions/       # guardHelper, confirmHelper, modalHelper (standardized patterns)
│   ├── monitoring/         # enhancedLogger, healthMonitor, healthServer, memoryWatchdog, errorReporter
│   ├── offboarding/        # archiveCompiler, messageCleanup (for bot-reset)
│   ├── onboarding/         # onboarding flow helpers
│   ├── reactionRole/       # menu + option persistence helpers
│   ├── rules/              # rulesCache (invalidateRulesCache lives here — v3.1.6)
│   ├── security/           # rateLimiter
│   ├── setup/              # channelCreator, channelDefaults, channelFormatDetector, configStatusEmbed
│   ├── status/             # statusManager (client-attached)
│   ├── ticket/             # autoClose, slaChecker, smartRouter, closeWorkflow, builtinTypes, transcriptBuilder, transcriptPoster
│   ├── validation/         # permissionValidator, featurePermission, inputSanitizer, validators
│   ├── workflow/           # cross-feature workflow helpers
│   ├── xp/                 # xp calc + role reward helpers
│   ├── apiConnector.ts     # External API client (dashboard sync)
│   ├── collectors.ts       # createButtonCollector, createSelectMenuCollector
│   ├── colors.ts           # Brand color constants
│   ├── constants.ts        # CACHE_TTL, INTERVALS, RETENTION_DAYS, MAX, TEXT_LIMITS
│   ├── emojis.ts           # Emoji constants
│   ├── errorHandler.ts     # classifyError, handleInteractionError
│   ├── fetchAllMessages.ts # fetchMessagesAsTranscript (v3.1.8)
│   ├── forumTagManager.ts  # ensureForumTag helpers
│   ├── time.ts             # sleep, toUnixSeconds, nowUnixSeconds (v3.11.1)
│   ├── modalComponents.ts  # Shared modal field helpers
│   ├── profileFunctions.ts # Per-request performance profiling
│   ├── reactionCooldown.ts # Reaction add throttling
│   ├── restClient.ts       # Shared REST client (lazy getRest)
│   ├── types.ts            # Shared TS interfaces
│   └── index.ts            # Barrel (keep imports direct inside utils/ to avoid cycles)
└── index.ts                # Main entry point
```

### Auto-Channel Creation System (v3)
When users choose "Create Channels For Me" in bot-setup, channels are auto-created with guild format matching:
- **Config file**: `src/utils/setup/channelDefaults.ts` — editable names, emojis, types per system
- **Creator**: `src/utils/setup/channelCreator.ts` — creates categories + channels at bottom of server
- **Format detector**: `src/utils/setup/channelFormatDetector.ts` — detects emoji/casing/separator patterns
- **System flows**: `src/commands/handlers/botSetup/systemFlows.ts` — full setup (channels + embeds + tags)

### Delete Event Handlers
Automatic config cleanup when Discord objects are deleted:
- `channelDelete` — clears references in 13 entities (TicketConfig, BaitChannelConfig, StarboardConfig, XPConfig, etc.)
- `messageDelete` — clears tracked messageIds in 8 entities
- `roleDelete` — clears role references in 9 entities (BotConfig, RulesConfig, ReactionRoleOption, XPRoleReward, etc.)
- `threadDelete` — deletes orphaned MemoryItems

### Bait Channel Subsystem (v3.2.0)
Honeypot moderation engine. Per-message flow:

```text
messageCreate
  → BaitChannelManager.handleMessage
  → analyzeSuspicion (15-flag scoring, 0-100)
  → contentBurstDetector.recordMessage  (cross-channel; +30 if bursting)
  → grace period setTimeout OR executeAction immediately
  → executeBanAction(opts, idempotencyRepo)
      ↳ INSERT IGNORE into idempotency_keys (dedup)
      ↳ guild.bans.create(userId, {deleteMessageSeconds, reason})  [REST]
      ↳ retryQueue.enqueue on 'queued'  /  dead-letter after 3 attempts
  → raidModeManager.recordTrigger (sticky lockdown if N actions in M sec)
  → sendDmNotification (5s race; DmResult.failureReason)
  → logToChannel (owner-DM fallback on failure)
  → logAction (persist BaitChannelLog row with audit columns)

GuildAuditLogEntryCreate event (separate)
  → confirmSelfAction: patch BaitChannelLog.discordAuditLogId + actionConfirmedAt
  → handleModSupersedes: cancel pending_actions + write idempotency key + mark log 'superseded-by-mod'
  → handleUnban: patch BaitChannelLog.unbannedAt / unbannedBy
```

Module map (`src/utils/baitChannel/`):
- `baitChannelManager.ts` — orchestrator; per-guild config cache; grace timers
- `channelList.ts` — `getBaitChannelIds`/`setBaitChannels`: single owner of the `channelIds`/legacy `channelId` column pair (v3.15.3) — all list reads/writes go through these; the raw legacy column is read directly only as the warning-banner home
- `banExecutor.ts` — REST executor + idempotency claim (use this, never `member.ban()` directly)
- `auditReason.ts` — structured `cogworks:bait score=N ch=#X flags=[…]` reason
- `retryQueue.ts` — 5s/30s/5min backoff + dead-letter; orphaned grace row sweep
- `raidModeManager.ts` — sticky lockdown; `enterRaidMode` / `releaseRaidMode` / `getStatus`
- `contentBurstDetector.ts` — same-content-in-N-channels in M sec
- `appealToken.ts` — HMAC-SHA256 signed appeal URLs (requires `APPEAL_HMAC_SECRET`)
- `joinVelocityTracker.ts`, `urlAnalyzer.ts`, `usernameAnalyzer.ts` — pre-v3.2.0 helpers

Required intent: `GatewayIntentBits.GuildModeration` for `auditLogEntryCreate`.

### Forum Tag System
Forum tags should **accumulate**, not replace:
```typescript
const existingTags = thread.appliedTags || [];
const mergedTags = [...existingTags, newTagId];
thread.edit({ appliedTags: mergedTags });
```

### Internal API (v3.0.0)
HTTP server on port 3002 for dashboard. Auth: Bearer token with timing-safe comparison.
- Pattern: `POST /internal/guilds/:guildId/<feature>/<action>`
- Handlers: `src/utils/api/handlers/` — tickets, applications, announcements, memory, rules, reactionRoles, guilds, config, setup, analytics, baitChannel, commands, maintenance, permissions, status
- **Body field validation**: Use helpers from `src/utils/api/helpers.ts` — never use `as string` casts on `body` fields:
```typescript
import { requireString, optionalString, requireNumber, optionalNumber, requireBoolean, optionalStringArray } from '../helpers';

const channelId = requireString(body, 'channelId');    // throws 400 if missing/not string
const color = optionalString(body, 'color') ?? '#5865F2'; // undefined if absent, 400 if wrong type
const triggeredBy = optionalString(body, 'triggeredBy');   // for audit logs
```

## Common Pitfalls

### Don't
- Hardcode strings (use `lang` module)
- Query without `guildId` filter (causes data leaks)
- Delete DB record before Discord object (use verified deletion helpers)
- Replace forum tags (use tag accumulation pattern)
- Use deprecated `ephemeral: true` (use `flags: [MessageFlags.Ephemeral]`)
- Use `requireAdmin()` with truthy check (use `.allowed` property)
- Use raw `requireAdmin`/`requireBotOwner` and format your own reply (use `guardAdmin`/`guardOwner` wrappers — same shape, one line)
- Use `guardAdmin` when the action is in the `FEATURES` catalog (use `guardFeatureAccess`/`guardFeatureRateLimit` so the webapp permission UI is load-bearing)
- Create new REST instances (use shared `getRest()` from `restClient.ts`)
- Use `as string` casts on API request body fields (use `requireString`/`optionalString` from `api/helpers`)
- Write manual `requireAdmin` + `rateLimiter.check` boilerplate (use `guardAdminRateLimit` from `utils/interactions`)
- Swallow errors silently with `catch {}` (at minimum log with `enhancedLogger`)
- Use deprecated `fetchReply: true` (use `withResponse: true`)
- Use `member.ban()` / `member.kick()` directly in bait paths (use `executeBanAction()` from `utils/baitChannel/banExecutor.ts` — REST-based, idempotent, leave-tolerant. v3.2.0+)
- Add new bait actions outside `executeAction` / `executeBanAction` (bypasses idempotency key + retry queue, breaks audit-log correlation)

### Do
- Use `archiveAndCloseTicket()` from `utils/ticket/closeWorkflow` for ticket close logic
- Use `verifiedChannelDelete`/`verifiedThreadDelete` for Discord deletions
- Use `buildErrorMessage()` for user-facing error messages
- Use `lazyRepo()` for deferred repository access
- Use `MessageFlags.Ephemeral` for error/info replies
- Record command metrics with `healthMonitor.recordCommand()`
- Import from `src/utils/index.ts` barrel (exports all utilities)
- Use `import type` for types that could cause circular dependencies
- Use constants from `src/utils/constants.ts` instead of magic numbers
- Use `isValidSnowflake()` from `api/helpers` for snowflake validation (single source of truth)

## Testing

- Runner: `bun test` (no separate config or preload — `tests/setup.ts` exists but is not wired).
- Run: `bun test` or `bun run test:watch`
- Tests: `tests/unit/` — commands, contract, events, handlers, utils (plus `tests/integration/` and `tests/manual/`)
- Imports: use `from 'bun:test'` (NOT `from '@jest/globals'` — Jest was removed in v3.1.35).
- Mocking: prefer hand-rolled fakes / `mock.module(...)` from `bun:test`. `jest.fn()` / `jest.spyOn()` work via Bun's compatibility shim. `jest.mock()` is NOT supported — use `mock.module()` instead.

## Security

### Rate Limits
- Ticket creation: 3/hour per user
- Application: 2/day per user
- Announcements: 5/hour per user
- Bot setup: 5/hour per guild
- Data export: 1/24h per guild
- Global: 30 cmd/min per user

### Permission Levels
| Level | Access |
|-------|--------|
| **Bot Owner** | Status commands (`BOT_OWNER_ID`) |
| **Admin** | All setup + management + data export |
| **Staff** | Ticket replies, limited moderation |

### GDPR Compliance
- `/data-export` — Admin-only data export
- `/bot-reset` — Factory reset with archive DM + command unregistration
- Auto-deletion on guild leave via `guildDelete.ts`
