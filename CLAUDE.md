# Cogworks Bot - CLAUDE.md

## Quick Reference
- **Stack**: Discord.js v14 + TypeScript + TypeORM + MySQL
- **Runtime**: Bun
- **Deployment**: Docker containers
- **Branches**: `main` (production)
- **Version**: 3.0.7

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
Commands using groups: `ticket` (5 groups), `baitchannel` (5 groups), `application`, `event`, `announcement`, `automod`, `role`.

### Language System
Use centralized `lang` module (NOT hardcoded strings):
```typescript
import { lang } from '../utils';
lang.ticket.created;          // Direct access
lang.ticketSetup.createTicket; // Setup strings are under ticketSetup/applicationSetup keys
```
Translation files: `src/lang/*.json` with types in `src/lang/types.ts`.

### Error Handling
```typescript
// For command handlers
await handleInteractionError(interaction, error, 'Custom context message');

// For non-interaction code
const { category, severity } = classifyError(error);
logError({ category, severity, message: 'Description', error, context });

// User-facing errors with bug report link
import { buildErrorMessage } from '../utils';
await interaction.reply({ content: buildErrorMessage('Something went wrong.') });
```
- ErrorCategory: `DATABASE`, `PERMISSIONS`, `VALIDATION`, `CONFIGURATION`, `EXTERNAL_API`, `UNKNOWN`
- ErrorSeverity: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

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
`requireAdmin()` and `requireOwner()` accept any Discord `Interaction` (commands, buttons, modals):
```typescript
const adminCheck = requireAdmin(interaction);
if (!adminCheck.allowed) {
    await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
    return;
}
// Other validators: requireOwner(), hasRole(), hasPermission(), hasAnyPermission()
```

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
import { rest, CLIENT_ID } from '../utils/restClient';
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
├── bait/                 # BaitChannelConfig, BaitChannelLog, BaitKeyword, JoinEvent
├── BotConfig.ts          # Per-guild bot configuration
├── PendingBan.ts         # Pending ban queue
├── SavedRole.ts          # Staff/saved roles
├── SetupState.ts         # Persistent setup dashboard state (v3)
├── UserActivity.ts       # User activity tracking
├── analytics/            # AnalyticsConfig, AnalyticsSnapshot
├── announcement/         # AnnouncementConfig, AnnouncementLog, AnnouncementTemplate
├── application/          # ApplicationConfig, ArchivedApplicationConfig, Position, Application, ArchivedApplication
├── event/                # EventConfig, EventTemplate, EventReminder
├── import/               # ImportLog
├── memory/               # MemoryConfig, MemoryItem, MemoryTag
├── onboarding/           # OnboardingConfig, OnboardingCompletion
├── reactionRole/         # ReactionRoleMenu, ReactionRoleOption (CASCADE)
├── rules/                # RulesConfig
├── shared/               # CustomInputField (interface)
├── starboard/            # StarboardConfig, StarboardEntry
├── status/               # BotStatus (singleton, PrimaryColumn id=1), StatusIncident
├── ticket/               # TicketConfig, ArchivedTicketConfig, Ticket, ArchivedTicket,
│                         #   CustomTicketType, CustomTicketField, UserTicketRestriction
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
- `MAINTENANCE_MODE=true` — Lightweight mode, no DB, replies with maintenance message (see `src/maintenance.ts`)
- `BOT_OWNER_ID` — Required for `/status` commands
- `DEV_GUILD_ID` — Skips API webhooks and join velocity for this guild
- `COGWORKS_INTERNAL_API_TOKEN` — Bearer token for internal API
- `BOT_INTERNAL_PORT` — Internal API port (default: 3002)

### Build & Run
```bash
bun run dev        # Development with watch mode
bun run build      # Compile TypeScript to dist/
bun run start      # Production: run directly with Bun
bun test           # Jest unit tests
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
│   │   ├── memory/         # add, capture, update, delete, tags, manageTags
│   │   ├── reactionRole/   # create, add, remove, edit, delete, list, validate
│   │   ├── shared/         # fieldManagerCore (generic field management)
│   │   ├── ticket/         # typeAdd, typeEdit, workflow, emailImport, etc.
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
│   ├── api/                # Internal API server, router, handlers, guildWebhook
│   ├── archive/            # archiveExporter (export + delete archived data)
│   ├── database/           # guildQueries, logCleanup, legacyMigration, lazyRepo
│   ├── discord/            # verifiedDelete (deletion with verification + bug report)
│   ├── interactions/       # guardHelper, confirmHelper, modalHelper (standardized patterns)
│   ├── monitoring/         # enhancedLogger, healthMonitor, healthServer, memoryWatchdog
│   ├── offboarding/        # archiveCompiler, messageCleanup (for bot-reset)
│   ├── setup/              # channelCreator, channelDefaults, channelFormatDetector, configStatusEmbed
│   ├── security/           # rateLimiter
│   ├── ticket/             # autoClose, slaChecker, smartRouter, closeWorkflow, legacyTypes
│   ├── validation/         # permissionValidator, inputSanitizer, validators
│   └── ...
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
- Handlers: `src/utils/api/handlers/` — tickets, applications, announcements, memory, rules, reactionRoles, guilds, config, setup
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
- Create new REST instances (use shared `rest` from `restClient.ts`)
- Use `as string` casts on API request body fields (use `requireString`/`optionalString` from `api/helpers`)
- Write manual `requireAdmin` + `rateLimiter.check` boilerplate (use `guardAdminRateLimit` from `utils/interactions`)
- Swallow errors silently with `catch {}` (at minimum log with `enhancedLogger`)
- Use deprecated `fetchReply: true` (use `withResponse: true`)

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

- Config: `jest.config.js` (ts-jest), Setup: `tests/setup.ts`
- Run: `bun test` or `bun run test:watch`
- Tests: `tests/unit/` — events, utils, handlers

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
