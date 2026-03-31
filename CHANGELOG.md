# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.8]

### Fixed
- **Desloppify Rescore + Fixes**: Fresh 20-dimension subjective review and targeted fixes
  - Timing-safe auth comparison in `maintenance.ts` (was using string `!==` instead of `timingSafeEqual`)
  - Removed 3 dead exports from `utils/types.ts` (getGuildId, DownloadOptions, SavedRoleTypes)
  - Replaced duplicate SSRF-weak `isUrlSafe` in guildWebhook.ts with shared `validateSafeUrl`
  - Fixed raw `typeof body.weight` in baitChannelHandlers.ts — now uses `optionalNumber()` helper
  - Unified repo access: baitChannelHandlers.ts and setupHandlers.ts now use `lazyRepo()` like all other API handlers
  - API field name consistency: approve/deny endpoints now accept `triggeredBy` (alongside legacy `approvedBy`/`deniedBy`)
- **Scorecard**: Strict score 82.8/100 (up from 74.9), objective score 100%, scorecard regenerated

## [3.0.7]

### Changed
- **Cosmetic Cleanup**: Normalized handler export style and file naming
  - Converted all 118 `export const = async () =>` arrow handlers to `export async function` declarations across 75 files
  - Renamed `StatusManager.ts` to `statusManager.ts` (camelCase, matches project convention)
  - Zero `export const = async` patterns remaining in `src/commands/handlers/`

## [3.0.6]

### Added
- **Test Coverage Push (Session 1)**: +117 new tests (747 → 864), 1797 assertions across 33 files
  - New `tests/unit/utils/api/helpers.test.ts` — 74 tests covering all 10 API body extraction helpers (requireString, optionalString, requireNumber, etc.) plus extractId, isValidSnowflake, validateHexColor
  - New `tests/unit/utils/setup/channelFormatDetector.test.ts` — 25 tests for formatChannelName and formatCategoryName pure functions
  - Expanded `tests/unit/utils/rateLimiter.test.ts` — 20 new tests for getRemaining, getResetTime, getStats, userGuild key, custom messages, formatTime edge cases

## [3.0.5]

### Changed
- **Architecture Cleanup**: Deduplicated and consolidated bait channel files
  - Extracted shared `configureForumSystem()` from near-identical `configureTicket`/`configureApplication` (~380 lines → ~170 lines)
  - Moved `BaitChannelManager` from `utils/` root to `utils/baitChannel/`
  - Consolidated `BaitChannelConfig` and `BaitChannelLog` into `entities/bait/` alongside `BaitKeyword` and `JoinEvent`
  - Net reduction: ~2000 lines removed across 39 files (mostly import path updates)

## [3.0.4]

### Changed
- **Interaction Helper Migration**: Migrated all handlers to standardized interaction helpers
  - All `showModal` + `awaitModalSubmit` patterns replaced with `showAndAwaitModal()` (13 files, 20 sites)
  - Confirm/cancel button flows replaced with `awaitConfirmation()` (5 files: keywords, automod rule, manageTags, announcement templates, event templates)
  - Removed `channel?.awaitMessageComponent` anti-pattern from delete/reset confirms (scoped to response instead)
  - Net reduction: ~300 lines of boilerplate removed across 16 files
  - Consistent timeout handling and UX patterns across all handlers
  - Only remaining manual pattern: announcement preview+send flow (intentionally different UX)

## [3.0.3]

### Fixed
- **Bait Channel Message Deletion Hardening**: Messages from detected offenders are now aggressively cleaned up
  - Ban always deletes messages via Discord API (default 24 hours), no longer opt-in
  - Kick uses softban (ban + immediate unban) to leverage Discord's message deletion
  - Kick falls back to regular kick + bot-side purge if bot lacks Ban Members permission
  - Timeout always runs bot-side purge across all channels
  - Cross-channel purge no longer skips bait channels

### Changed
- Added `deleteMessageHours` column to BaitChannelConfig (default: 24, replaces impractical `deleteMessageDays`)
- Repurposed `deleteUserMessages` toggle — now controls additional cross-channel sweep (ban/kick always delete via Discord regardless)
- Renamed settings UI label from "Delete User Messages" to "Extra Message Sweep" with updated description

## [3.0.2]

### Added
- **Maintenance Mode**: `MAINTENANCE_MODE=true` env var for lightweight operation without a database
  - Bot stays online on Discord, replies to all interactions with a maintenance embed
  - Sets presence to "Under Maintenance" with idle status
  - Own lightweight health server (live returns 200, ready returns 503)
  - Minimal internal API (`GET /internal/maintenance`, `GET /internal/health`)
  - Suitable for running on a Raspberry Pi during downtime
- **Status API Endpoints**: Dashboard integration for bot status management
  - `GET /internal/maintenance` — check if bot is in maintenance mode
  - `GET /internal/status` — current bot status, presence text, override state, uptime
  - `POST /internal/status/override` — set a fixed presence message + status level
  - `DELETE /internal/status/override` — clear override, resume normal presence rotation
- Internal API now supports DELETE method

## [3.0.1]

### Hotfix
- Last migration (hopefully)

## [3.0.0]

### Added
- **Interaction Utility Helpers**: New `src/utils/interactions/` module with standardized patterns
  - `guardAdminRateLimit()` — combined admin + rate limit guard (replaces 25+ copies of boilerplate)
  - `awaitConfirmation()` — standardized confirm/cancel button flow with auto-cancel and timeout
  - `showAndAwaitModal()` — modal show + await + timeout notification wrapper
  - `TIMEOUTS` constants (modal, confirmation, component, dashboard)
- **Wired 8 Previously Orphaned Features**: Connected handlers that were built but never registered
  - Ticket SLA commands: `/ticket sla-enable`, `sla-disable`, `sla-per-type`, `sla-stats`
  - Ticket routing commands: `/ticket routing-enable`, `routing-disable`, `routing-rule-add/remove`, `routing-strategy`, `routing-stats`
  - Application workflow commands: `/application status`, `note`, `claim`, `info`, `check`, `workflow-enable/disable`, `workflow-add/remove-status`
  - Event handlers: onboarding join, scheduled events (5 lifecycle hooks), XP message tracking, XP voice tracking
  - Analytics snapshot job: periodic daily snapshots with proper start/stop lifecycle
  - Added `GuildScheduledEvents` and `GuildVoiceStates` intents
- **Forum Welcome Threads**: Bot-setup now creates pinned welcome threads for all forum channels
  - Ticket archive, application archive, and memory forums (both auto-create and existing-channel paths)
- **Codebase Health Scorecard**: Desloppify scorecard at `public/scorecard.png`, displayed in README

- **Constants Consolidation**: Centralized all magic numbers into `src/utils/constants.ts`
  - Cache TTLs, intervals, retention days, max limits, text limits
  - Single source of truth for all configuration values across the codebase
- **Input Sanitization Hardening**: 4 new sanitization functions applied across 15+ handlers
  - `stripZeroWidthChars()` — removes invisible Unicode characters that bypass keyword detection
  - `sanitizeMentions()` — escapes `@everyone` and `@here` to prevent mass pings
  - `validateTextLength()` — structured validation with field name in error messages
  - `sanitizeUserInput()` — convenience pipeline (trim + zero-width + mentions + optional markdown escape + truncation)
- **Legacy Data Migration System**: Application-level data migrations for semantic transformations
  - `LegacyMigrationRunner` with configurable concurrency, dry-run mode, and per-guild error isolation
  - `asyncPool` utility for bounded concurrent processing
  - Runs on startup after TypeORM sync, before event processing
  - Initial migrations: `announcementRoleRename`, `baitChannelIdsBackfill`
- **Announcement System Overhaul**: Template-based announcement system replacing hardcoded templates
  - `AnnouncementTemplate` entity with per-guild storage (max 25 templates)
  - Template CRUD commands: `/announcement template create/edit/delete/list/preview/reset`
  - `/announcement send` — send using any template with autocomplete
  - Placeholder engine: `{version}`, `{duration}`, `{time}`, `{time_relative}`, `{user}`, `{role}`, `{server}`, `{channel}`
  - 5 default templates auto-seeded on first setup (maintenance, maintenance-scheduled, back-online, update-scheduled, update-complete)
  - `defaultRoleId` column on `AnnouncementConfig` (replaces `minecraftRoleId`, kept for legacy migration)
  - Live preview with example values via `/announcement template preview`
  - API endpoints: template list (GET), create (POST), delete (POST)
- **Custom Memory Tags**: Per-channel tag management for memory system
  - `/memory-setup tag-add` — add category or status tag with emoji, synced to Discord forum
  - `/memory-setup tag-remove` — remove non-default tags (autocomplete)
  - `/memory-setup tag-edit` — edit tag name and/or emoji (autocomplete)
  - `/memory-setup tag-list` — list all tags with type and default status
  - `/memory-setup tag-reset` — reset to defaults (confirmation required)
  - Limits: 10 category tags, 6 status tags per channel (20 total Discord forum tag limit)
  - Tag name sanitization and duplicate detection (case-insensitive)
- **Ticket Workflow States**: Configurable ticket statuses, staff assignment, and auto-close
  - `/ticket workflow-enable/disable` — toggle workflow per guild
  - `/ticket status` — change ticket status with autocomplete
  - `/ticket assign/unassign` — staff assignment tracking with timestamps
  - `/ticket info` — view ticket details with status history (last 5 entries)
  - `/ticket workflow-add-status/workflow-remove-status` — custom status management (max 10)
  - `/ticket autoclose-enable/autoclose-disable` — automatic closure of inactive tickets
  - Default statuses: Open, In Progress, Awaiting Response, Resolved, Closed
  - Required statuses `open` and `closed` cannot be removed
  - Status history capped at 50 entries per ticket
  - Auto-close: configurable days (1-90), warning hours (1-72), and target status
  - Hourly auto-close check via `src/utils/ticket/autoClose.ts`
  - New `Ticket` columns: `assignedTo`, `assignedAt`, `lastActivityAt`, `statusHistory`
  - New `TicketConfig` columns: `enableWorkflow`, `workflowStatuses`, `autoCloseEnabled`, `autoCloseDays`, `autoCloseWarningHours`, `autoCloseStatus`
- **Shared REST Client**: `src/utils/restClient.ts` — single Discord REST instance shared across index.ts and event handlers
- **Multi-Channel Memory System**: Support up to 3 memory forum channels per guild
  - `/memory-setup add-channel` — Add an additional memory forum channel
  - `/memory-setup remove-channel` — Remove a memory channel
  - `/memory-setup view` — View all configured memory channels
  - Per-channel tags (categories and statuses scoped to each channel)
  - Channel picker when guild has multiple memory channels
- **`/server` Command**: Shows Cogworks development Discord server invite link
- **Bot Internal API**: HTTP server (port 3002) for dashboard-triggered operations
  - Ticket close/assign, application approve/deny/archive
  - Announcement send, memory create, rules setup, reaction role create/rebuild
  - Bearer token auth with timing-safe comparison
- **Dashboard (Beta)**:
  - Dashboard URL to the bot's profile description
  - `/dashboard` - Opens the Cogworks web dashboard with Discord OAuth authentication
  - Note: The web dashboard is in beta — the Cogworks Discord bot itself is stable
- **Dashboard Integration Endpoints (Beta)**:
  - `GET /internal/guilds` — Live guild list from Discord.js gateway cache
  - `GET /internal/guilds/:guildId/members/:userId/permissions` — Permission verification
  - `GET /internal/guilds/:guildId/channels` — Guild channel list from cache
  - `GET /internal/guilds/:guildId/roles` — Guild role list with colors and member counts
  - `GET /internal/guilds/:guildId/members/search?query=&limit=` — Member search
  - `GET /internal/guilds/:guildId/audit-log?limit=N` — Recent audit log entries
  - `GET /internal/health` — Health status on internal API port
  - `POST /internal/guilds/:guildId/config/refresh` — Cache invalidation for baitChannel, reactionRole, rules
- **Guild Lifecycle Webhooks**: Join/leave notifications to ninsys-api (fire-and-forget)
- **Audit Logging**: `AuditLog` entity for dashboard-triggered actions (beta) with 90-day TTL cleanup
  - Included in `/data-export` for GDPR compliance
- **Thread Locking**: Memory items lock thread on completion
- **Useful Links**: Cogworks Home, Dashboard, and my dev Discord server links now in the README
- **Bait Channel Smart Detection v2**: Comprehensive overhaul of the anti-bot detection system
  - Profile and behavioral detection flags: default avatar, empty profile, suspicious username, no roles
  - Content analysis: Discord invite detection, phishing URL detection, attachment-only messages
  - Custom keyword management with configurable weights (up to 50 per server)
  - Graduated escalation: score-based action selection (log/timeout/kick/ban) with configurable thresholds
  - Timeout action support with configurable duration (1 minute to 28 days)
  - DM notifications before actions with optional appeal information
  - Join velocity detection: burst detection with configurable threshold and sliding window
  - Multi-channel support: monitor up to 3 bait channels per server
  - Test mode: full detection pipeline without real actions for safe threshold tuning
  - Override tracking: mark false positives for detection accuracy feedback
  - Weekly summary digest: automated analytics posted to a channel every Sunday at midnight UTC
- **Memory Watchdog**: Heap and Map size monitoring with threshold-based alerting
- **Bait Channel API Endpoints**: Internal API endpoints for dashboard integration
  - `GET /internal/guilds/:guildId/bait-channel/keywords` — List keywords
  - `POST /internal/guilds/:guildId/bait-channel/keywords/add` — Add keyword
  - `POST /internal/guilds/:guildId/bait-channel/keywords/remove` — Remove keyword
  - `POST /internal/guilds/:guildId/bait-channel/keywords/reset` — Reset to defaults
  - `POST /internal/guilds/:guildId/bait-channel/override` — Override a detection
  - `GET /internal/guilds/:guildId/bait-channel/stats` — Detection statistics
  - `GET /internal/guilds/:guildId/bait-channel/join-events` — Join event history

- **Starboard System**: "Democratic pins" — messages reaching a configurable reaction threshold are posted to a starboard channel
  - `/starboard setup/config/toggle/ignore/unignore/stats/random`
  - Configurable emoji, threshold (1-25), self-star prevention, bot/NSFW filtering
  - Gold-gradient embeds with "Jump to Original" link button
  - `StarboardConfig` and `StarboardEntry` entities with full GDPR support
- **XP & Reputation System**: Message and voice-based leveling with role rewards
  - `/rank [user]`, `/leaderboard [page]` — XP rank card and server leaderboard
  - `/xp-setup enable/disable/config/role-reward/ignore-channel/multiplier`
  - `/xp admin set/reset/reset-all` — manual XP management
  - MEE6-compatible XP formula: `level = floor(0.1 * sqrt(xp))`
  - Per-channel multipliers, ignored channels/roles, configurable cooldown
  - Level-up announcements with customizable message template
  - `XPConfig`, `XPUser`, `XPRoleReward` entities
- **Bot Data Migration System**: Import XP/leveling data from other bots
  - `/import mee6 xp [overwrite] [dry-run]` — MEE6 leaderboard import
  - `/import csv <attachment>` — generic CSV import
  - `/import status/history/cancel` — import management
  - Rate limited (1 import/hour per guild), progress reporting, dry-run mode
  - `ImportLog` entity for import history tracking
- **Interactive Onboarding Flow**: Guided DM-based welcome for new members
  - `/onboarding setup/config/step-add/step-remove/step-list/stats/preview/resend`
  - Step types: message, role-select, channel-suggest, rules-accept, custom-question
  - Completion role, 24h collector TTL, completion rate tracking
  - `OnboardingConfig` and `OnboardingCompletion` entities
- **Smart AutoMod Integration**: Command interface for Discord's native AutoMod API
  - `/automod rule create/edit/delete/list`
  - `/automod template apply` — anti-spam, anti-phishing, family-friendly, gaming presets
  - `/automod backup export/restore` — JSON backup/restore of all rules
  - `/automod keyword/regex/exempt add/remove` — rule management
  - No database entities (rules stored on Discord's side)
- **Ticket SLA Tracking**: Response time targets with breach alerts
  - `/ticket-setup sla enable/disable/per-type/stats`
  - Configurable target minutes per ticket type, breach channel alerts
  - Hourly SLA check with automatic breach detection
  - New `TicketConfig` columns: `slaEnabled`, `slaTargetMinutes`, `slaBreachChannelId`, `slaPerType`
  - New `Ticket` columns: `firstResponseAt`, `slaBreached`, `slaBreachNotified`
- **Application Workflow States**: Intermediate review states for applications
  - `/application status/note/claim/info/check`
  - Default statuses: Submitted, Under Review, Interview, Approved, Denied, On Hold
  - Internal notes, status history, reviewer tracking
  - New `ApplicationConfig` columns: `enableWorkflow`, `workflowStatuses`
  - New `Application` columns: `reviewedBy`, `reviewedAt`, `internalNotes`, `statusHistory`
- **Ticket Smart Routing**: Auto-assign tickets based on staff workload
  - `/ticket-setup routing enable/disable/rule-add/rule-remove/strategy/stats`
  - Strategies: least-load, round-robin, random
  - Type-to-role mapping with max open ticket limits
- **Scheduled Events Manager**: Full lifecycle management for Discord Scheduled Events
  - `/event create/from-template/cancel/remind`
  - `/event template create/edit/delete/list`
  - `/event setup enable/disable/reminder-channel/summary-channel`
  - Hourly reminder checks, recurring event support
  - `EventConfig`, `EventTemplate`, `EventReminder` entities
- **Server Analytics & Insights**: Built-in analytics with privacy-first aggregate data
  - `/insights overview/growth/channels/hours`
  - `/insights setup enable/disable/channel/frequency`
  - Daily snapshots, weekly/monthly digest embeds, text sparklines
  - `AnalyticsConfig` and `AnalyticsSnapshot` entities (90-day retention)
- **Enhanced Status System**: Incident history and status subscriptions
  - `/status history [days]`, `/status subscribe/unsubscribe`
  - `/status monitor set <url>` — external monitoring integration
  - Status banners during outages, `StatusIncident` entity
- **Command-Based Audit Logging**: Unified activity feed from commands and dashboard
  - State-changing commands now logged to `AuditLog` with `source: 'command'`
  - Covers all setup, ticket, memory, role, announcement, baitchannel, reactionrole commands
- **API Error Status Codes**: Proper HTTP status codes for internal API
  - `ApiError` class with static factories: badRequest(400), notFound(404), conflict(409)
  - All handlers now throw typed errors instead of returning `{ error: '...' }` with 200
- **Permission System Consolidation**: Merged `permissions.ts` into `permissionValidator.ts`
  - Single canonical module with `PermissionSets`, `createPrivateChannelPermissions`, and all validators
- **Discord Components v2 Integration**: New modal components (RadioGroup, CheckboxGroup, Checkbox, Label)
  - Raw API component helpers (`modalComponents.ts`) for discord-api-types enums
  - Bait channel settings modal with radio groups and checkboxes
  - Ticket restriction checkbox group modal (replaces button grid)
  - Ticket workflow settings modal (enable/disable workflow + auto-close)
  - Announcement setup with optional modal flow (role + channel selects)
  - Channel and role select menus in modals
- **Context Menu Commands**: 6 right-click actions for messages and users
  - Capture to Memory, Post as Announcement, Close Application (message context)
  - Open Ticket For User, View Bait Score, Manage Restrictions (user context)
- **Bot Setup Dashboard**: Unified setup flow replacing 3 separate wizards
  - Persistent `SetupState` entity tracks configuration progress per guild
  - Checkbox group for system selection, StringSelectMenu for per-system config
  - Partial save support (resume later without re-entering data)
  - Real-time DB state detection for accurate status display
- **Auto Channel Creation**: Detects guild channel naming patterns and auto-creates channels
  - Channel format detector analyzes emoji prefixes, separators, casing conventions
  - Channel creator utility with permission overwrites and category support
- **Bot Reset (`/bot-reset`)**: Factory reset with archive compilation
  - Two-stage confirmation (initial warning + final "are you ABSOLUTELY sure")
  - Compiles all archived data into gzipped JSON and DMs to admin
  - Cleans up all bot-sent messages (buttons, menus, embeds)
  - Purges all guild data from database
- **Archive Cleanup (`/archive cleanup`)**: Export and clean up archived data
  - Export archived tickets, applications, or all to compressed JSON
  - DM export file to admin, then optionally delete archived DB entries
- **Admin Guide Revamp**: Full rewrite covering all v3 systems (removed from .gitignore)

### Improved
- **Single-Message Bot Setup UX**: Eliminated stale ephemeral message clutter
  - Channel choice uses `update()` to morph dashboard in-place (no new messages)
  - Auto-create shows loading state, modals use `deferUpdate()`
  - Dashboard always refreshes after system flows (restores from any intermediate state)
- **Bot-Setup Existing-Channel Parity**: All existing-channel paths now match auto-create functionality
  - Bait channel: sends warning message + seeds default keywords
  - Memory: creates default forum tags + welcome thread
  - Ticket/Application archive: creates welcome thread + pin
- **Monster Function Refactoring**: Extracted 26 helper functions from 6 oversized handlers
  - `memory/delete.ts`, `memory/update.ts`, `ticket/emailImport.ts`, `ticketSetup.ts`, `applicationSetup.ts`, `insights/setup.ts`
- **Dead Code Removal**: Removed 8 dead exports, 1 dead barrel re-export, deduplicated `getTicketCreationTime` and `deleteForumThreads`
- **Security Hardening**: Added `requireAdmin()` to 9 ticket/application sub-handlers that were missing auth checks
  - `typeAdd`, `typeEdit`, `typeFields`, `typeList`, `typeRemove`, `typeToggle`, `typeDefault`, `applicationEdit`, `applicationFields`
- **API Runtime Validation**: Replaced 69 unsafe `as string` type casts in API handlers with runtime body validators
  - New helpers in `src/utils/api/helpers.ts`: `requireString`, `optionalString`, `requireNumber`, `optionalNumber`, `requireBoolean`, `optionalStringArray`
  - All API handler body fields now validated at runtime before use (throws 400 on bad input)
- **Admin Boilerplate Migration**: 33 handlers migrated from manual `requireAdmin` + `rateLimiter.check` (~18 lines each) to single `guardAdminRateLimit()` call (~5 lines)
- **Deprecated Code Removal**: Removed `minecraftRoleId` fallback reads from 3 announcement files; unified duplicate snowflake validators into single `isValidSnowflake()` in `api/helpers.ts`
- **Code Quality (Desloppify)**: Comprehensive AI debt cleanup and type safety improvements
  - Removed section separator comments, trivial JSDoc, and restating comments across 30+ files
  - Fixed nullable entity types (BaitActionType union, ExtendedClient assertion reduction)
  - UTC timezone fix for timestamp handling
  - Empty guildId guards added where missing
  - Duplicate whitelist logic merged into single code path
  - All remaining `logger()` calls migrated to `enhancedLogger` with proper categories
  - Silent catch blocks documented with intent comments
  - Shared REST client pattern eliminates duplicate Discord REST instances
- **Code Consolidation**: Reduced duplication across key systems
  - Unified announcement preview/send: 3 functions → 1 `previewAndSend()` (~150 lines saved)
  - Shared ticket close workflow: `archiveAndCloseTicket()` used by both event and API handlers — fixes API handler missing legacy type support and forum tag merging
  - Shared legacy type info: `LEGACY_TYPE_INFO` with display names and emojis
  - Removed 2,802 lines of orphaned dead code (comprehensiveWizard, modalWizard, channelSetupFlow, 5 step files)
- **Type Safety**: Tightened types across permission and routing systems
  - `requireAdmin`/`requireOwner`/`requireGuild` accept any `Interaction` (not just commands)
  - `TicketConfig.routingStrategy` typed as `RoutingStrategy` union instead of `string`
  - Announcement setup: `| any` replaced with `| ModalSubmitInteraction`
  - `askChannelChoice` return typed with `ButtonInteraction` instead of `any`
- **Documentation**: README revamp with full v3 feature grid, ARCHITECTURE.md with mermaid diagrams

### Fixed
- **Archive Cleanup "Unknown Interaction"**: Defer button update before slow async deletion (was timing out)
- **Bot Setup Buttons Missing After Flow**: Dashboard refresh now clears stale `content` field
- **Bot Setup Heap Watchdog**: Uses `heap_size_limit` instead of `heapTotal` for accurate threshold
- **Duplicate Shutdown**: Added re-entry guard to prevent double graceful shutdown on Ctrl+C
- **Bot Reset**: 3-stage flow (warning → save data choice → confirm), reset confirmation prompt added
- **Command Registration**: Now registers commands for unconfigured guilds on startup
- **Bot Reset Forum Cleanup**: Deletes forum threads (archived tickets, applications, memory) during reset
- **Archive Cleanup Forum Threads**: Deletes forum threads before DB records
- **Removed All `.setTimestamp()`**: 82 instances across 50 files (embeds no longer show stale timestamps)
- **Memory Close/Complete**: Fixed "internal error" — reply now sent before thread archive
- **Memory Close Reply**: Now visible (non-ephemeral) as archive notice in thread
- **Bot Setup Wizard Duplicate Messages**: Wizard now cleans up old messages before sending new ones on re-setup
- **Bot Setup Application Message**: Wizard now sends proper formatted message with positions (was sending plain text placeholder)
- **Internal API Query Param Routing**: Fixed route matching for endpoints with query parameters (e.g., `?limit=5`)

### Changed
- **Command Structure**: `/ticket` and `/baitchannel` refactored from flat subcommands to subcommand groups
  - `/ticket` (31 subcommands → 5 groups): `type`, `manage`, `workflow`, `sla`, `routing` — e.g., `/ticket type add`, `/ticket manage status`, `/ticket sla stats`
  - `/baitchannel` (20 subcommands → 5 groups): `setup`, `detection`, `escalation`, `dm`, `stats` — e.g., `/baitchannel setup toggle`, `/baitchannel escalation enable`
  - Subcommand prefixes dropped within groups (e.g., `type-add` → `type add`, `escalation-enable` → `escalation enable`)
- **Biome Config**: `lineWidth` 150 → 120, `noFloatingPromises` set to `error` (12 violations fixed)
- **Discord.js Cache**: Added guild member + message sweepers, cache limits for messages (200) and threads (100)
- **Connection Pool**: MySQL pool tuning (min: 2, max: 10), `keepAliveInitialDelay` fix
- **Docker**: Added `docker-compose.yml` for containerized deployment
- **`MemoryConfig`**: No longer has unique constraint on `guildId` (supports multiple channels)
- **`MemoryTag` and `MemoryItem`**: Now reference `memoryConfigId` for per-channel scoping
- **TypeORM Migrations**: Production uses `migrationsRun: true` instead of `synchronize: true`
- **Internal API Security**: Snowflake validation on all Discord ID inputs, hex color validation on announcements
- **Internal API Performance**: Pre-compiled route regex patterns (no per-request compilation)
- **Guild Webhook Safety**: URL validation blocks private/internal IPs in production
- **Privacy Policy & Terms of Service**: Updated with dashboard, audit logging, guild webhook disclosures, Discord server link
- **Lang System Completion**: Migrated all hardcoded user-facing strings to centralized `lang` module
  - Field manager UI (modal labels, button labels, placeholders, error messages)
  - Application edit modal labels, memory tag selection fields
  - Scattered button labels across ticket, memory, and announcement handlers
  - Added `fieldManager`, `tagSelection`, and new shared button entries to lang files
- **Logger Migration**: All command and event handlers migrated from basic `logger()` to structured `enhancedLogger` with `LogCategory` tagging (11 files, ~40 calls)
- **Deployment**: Migrated from PM2 to Docker containers
- **Bait Channel Stats**: Enhanced with override rate, score distribution histogram, and top detection flags
- **Bait Channel Log Embeds**: Consistent emoji scheme, new fields for DM status, escalation info, coordinated raid indicator, test mode annotation
- **Health Endpoint**: Now includes memory stats (heap usage, tracked Map sizes)
- **New Entities**: `BaitKeyword` (custom detection keywords), `JoinEvent` (join velocity tracking)
- **`BaitChannelConfig` Columns**: Added `channelIds`, `testMode`, escalation fields, DM notification fields, join velocity fields, weekly summary fields
- **`BaitChannelLog` Columns**: Added `overridden`, `overriddenBy`, `overriddenAt` for override tracking
- **Database Migration**: `BaitChannelDetectionV2` consolidated migration for all bait channel v2 schema changes
- **GDPR Compliance**: Custom keywords and join events included in data export and guild deletion
- **CI/CD Pipeline**: GitHub Actions CI workflow (build, lint, test on PRs); deploy now requires passing CI
- **Git Workflow**: Removed `dev` branch and `sync-dev.yml`, migrated to GitHub flow
- **`DEV_GUILD_ID` Env Var**: Skips API webhooks and join velocity tracking for the dev server
- **`MEMORY_ALERT_CHANNEL_ID` Env Var**: Private channel for memory/heap alerts (falls back to `STATUS_CHANNEL_ID`)
- **Memory Watchdog Dev Mode**: Alerts suppressed when `RELEASE=dev`
- **`.env.example`**: Reorganized into categorized sections
- **Tests**: Removed `tests/` from `.gitignore` — tests now tracked in repo

### Removed
- **`ServerConfig` Entity**: Unused entity removed (was never queried)
- **`formatBytes()` Utility**: Unused export removed

## [2.12.10] - 2026-03-09

### Fixed
- **Production Schema Safety**: Disabled TypeORM `synchronize` in production — now dev-only (`synchronize: RELEASE === 'dev'`)
- **Fatal Shutdown Cleanup**: `uncaughtException` handler now calls `gracefulShutdown` instead of raw `process.exit(1)`, ensuring proper cleanup
- **Commands Per Minute Metric**: Fixed `commandsPerMinute` to count actual command executions using rolling timestamp array (was counting distinct command names)
- **Lightweight Liveness Probe**: `/health/live` now checks process uptime only — no longer queries the database on every probe

### Changed
- **Cache TTL**: Added 30-minute TTL eviction to `menuCache` (reaction roles) and `rulesCache` (rules reactions) to prevent unbounded memory growth
- **Shutdown Hygiene**: `gracefulShutdown` now stops `healthMonitor` periodic check intervals and calls `rateLimiter.destroy()`
- **Tracked Intervals**: `healthMonitor.startPeriodicChecks()` now stores interval handles in `periodicCheckIntervals[]` for proper cleanup via `stopPeriodicChecks()`
- **Cached Dev Mode**: `rateLimiter` now lazily caches `process.env.RELEASE` on first access instead of reading it on every `check()` call

## [2.12.9] - 2026-03-09

### Changed
- **Bait Channel Gate**: `trackMessage()` now checks bait channel config before tracking, avoiding unnecessary DB lookups
- **Async File I/O**: Replaced `fs.writeFileSync` with `fs.promises.writeFile` in ticket/application transcript and zip writes
- **Async Directory Creation**: Replaced sync `fs.existsSync`/`fs.mkdirSync` with `fs.promises.mkdir({ recursive: true })` in ticket/application close and data export
- **Lazy Config Queries**: Deferred config queries in `handleTicketInteraction` and `handleApplicationInteraction` via lazy-loaded helpers
- **Reused Query Results**: Single `CustomTicketType` fetch reused for description, display name, and ping check in ticket creation
- **Parallel Startup**: Guild command registration now uses `Promise.allSettled` for parallel execution
- **Parallel Data Export**: Data export queries run with `Promise.all` for 25 concurrent queries

## [2.12.8] - 2026-03-09

### Fixed
- **[CRITICAL] Ticket User-Restrict Permission**: Added `requireAdmin()` check — was accessible to all guild members
- **[CRITICAL] Ticket Settings Permission**: Added `requireAdmin()` check — was accessible to all guild members
- **[CRITICAL] GDPR Data Deletion**: Added missing entities to `deleteAllGuildData()`: CustomTicketType, UserTicketRestriction, PendingBan, AnnouncementLog, MemoryConfig, MemoryItem, MemoryTag
- **[CRITICAL] GDPR Data Export**: Added missing entities to data export: CustomTicketType, UserTicketRestriction, ReactionRoleMenu, ReactionRoleOption, RulesConfig, PendingBan, AnnouncementLog, MemoryConfig, MemoryItem, MemoryTag, BotStatus
- **Ticket Update After Creation**: Added `await` to fire-and-forget DB write that could leave ticket in `created` state
- **Application Update After Creation**: Added `await` to fire-and-forget DB write (same pattern)
- **PendingBan Delete Scope**: Added `guildId` to PendingBan delete query (was missing guild scope)
- **Guild-Scoped Updates**: Added `guildId` to ticket/application update WHERE clauses in ticketInteraction, applicationInteraction, ticket/close, application/close, ticket/adminOnly

### Changed
- **Export Temp Cleanup**: Data export now cleans up temp file on DM failure

## [2.12.7] - 2026-03-09

### Changed
- **Resource Management**: Improved interval and timer cleanup across monitoring, caching, and security subsystems
- **Cache Optimization**: Added size limits and eviction policies to in-memory caches
- **Interval Cleanup**: All periodic intervals now tracked and properly cleared on shutdown

## [2.12.6] - 2026-03-09

### Changed
- **Logger Migration**: Migrated `apiConnector` from basic `logger()` to `enhancedLogger` with proper categories
- **Type Safety**: Improved type annotations across utility modules
- **Dead Code Cleanup**: Removed unused imports, variables, and unreachable code paths

## [2.12.5] - 2026-03-09

### Fixed
- **Critical Guild Scope Fix**: Added missing `guildId` filters to archived entity queries preventing cross-guild data visibility
- **Error Handling**: Improved error handling in event handlers and interaction flows
- **Async File Operations**: Fixed blocking file I/O in hot paths

## [2.12.4] - 2026-03-08

### Added
- **Memory Capture Error Handling**: Improved error messages for invalid message links and missing permissions
- **Email Import Rate Limiting**: Added per-user rate limiting to email import handler
- **Bait Channel Threshold Config**: Configurable detection thresholds via environment variables
- **New Unit Tests**: 82 new event handler tests (ticketInteraction, applicationInteraction)

### Changed
- **API Connector Logger**: Migrated from basic `logger()` to `enhancedLogger` with proper categories
- **License**: Changed from MIT to PolyForm Noncommercial 1.0.0

## [2.12.1] - 2026-03-08

### Added
- **Custom Announcement Messages**: Announcement templates now support custom message content
- **Modal Timeout Feedback**: `notifyModalTimeout()` utility for clear user feedback on modal timeouts
- **Memory Quick-Update Commands**: `/memory update-status` and `/memory update-tags` for quick updates from any channel

### Fixed
- **Timestamp Accuracy**: Fixed announcement timestamps to use server time correctly
- **Language Fixes**: Corrected various lang string issues

## [2.12.0] - 2026-03-08

### Added
- **Shared Field Manager Core**: Extracted generic `fieldManagerCore.ts` module eliminating ~1,300 LOC duplication between ticket type fields and application position fields
- **Shared Tag Selection UI**: Extracted `tagSelection.ts` module with reusable Discord collector pattern for memory add/capture flows
- **New Unit Tests**: Added test coverage for `errorHandler` (classifyError, safeDbOperation), `inputSanitizer` (escapeDiscordMarkdown, validateSnowflake, truncateWithNotice), and `logger` (getTimestamp, logger) - 53 new tests

### Fixed
- **Import Cycle**: Broke circular dependency between ReactionRoleMenu and ReactionRoleOption using `import type` + lazy `require()` pattern
- **MemoryTagType Export**: Fixed type-only export in memory entity barrel file causing Bun resolver errors
- **Unused E Import**: Removed unused emoji import from tagSelection.ts

### Changed
- **Dead Export Cleanup**: Removed unused exports from botSetup steps, announcement templates, application templates, and comprehensiveWizard
- **Dead Code Removal**: Removed unused imports, variables, and functions across private scripts and extractCommands utility
- **Inlined botSetupNotFound**: Removed deprecated exported function, inlined logic in commands.ts
- **Code Smell Fixes**: Refactored monster functions in memory/add.ts (391 -> 180 LOC) and memory/capture.ts (503 -> 265 LOC)

## [2.11.4] - 2026-03-08

### Added
- **Bait Channel Message Purge**: Auto-purge banned user messages across all server channels after bait channel ban
  - Scans text, announcement, and voice channels (skips bait channel itself)
  - Uses bulkDelete for recent messages with individual delete fallback for older messages
  - Sequential channel processing to avoid Discord rate limits
  - Checks bot permissions per channel before attempting purge
  - Purge summary logged in ban embed (deleted count, channel count)

### Fixed
- **Email Import Permission Check**: Added missing requireAdmin() check to email import handler (was accessible to all users)
- **Ticket Close Guild Scoping**: Added guildId to ticket query in close and admin-only handlers (data isolation convention)
- **Attachment URL Validation**: Restricted email import attachment URLs to HTTP/HTTPS only (blocked file:, data:, javascript: schemes)
- **Purge Error Logging**: Added debug logging to empty catch block in purge channel loop

## [2.11.3] - 2026-03-07

### Changed
- **Email Import Channel Naming**: Channel name now uses sender name format: emoji_sender-name
- **Email Import Privacy**: Email address hidden from ticket embed (kept internal for privacy)
- **Email Import From Field**: Shows sender name or email username instead of full email address
- **Email Import Email Field**: Reverted email field back to required (needed for archive matching)

### Added
- **Email Import Buttons**: Close and Admin Only buttons added to email import tickets (matches regular ticket behavior)
- **Email Archive Grouping**: Email tickets now archive by sender email address instead of importing user
  - Repeat emails from same sender group into one archive thread
  - Archive thread named after sender (name or email username)

## [2.11.2] - 2026-03-07

### Fixed
- **Email Import Staff Role Crash**: Fixed permission overwrite crash when globalStaffRole is stored as mention string instead of raw ID
  - Now uses extractIdFromMention() utility for consistent ID extraction
- **Email Import Staff Role Check**: Added missing enableGlobalStaffRole check to match codebase convention

## [2.11.1] - 2026-02-21

### Fixed
- **Reorder UI Crash**: Fixed 5-field reorder exceeding Discord's 5 action row limit — "Done" button now merges into the last field's row
- **Auto-Reindex on Removal**: Position removal now auto-reindexes remaining display numbers to fill gaps
- **Stale Field Editor Detection**: Interacting with a completed field editor now shows a "already completed" message instead of silently failing
- **Session Timeout Handling**: Field management sessions now properly expire after 15 minutes with clear feedback
- **Ephemeral Message Optimization**: Replaced `setTimeout` hack in field deletion with `deferUpdate()` + `showFieldManager()`, fixed error paths to use `followUp()`

### Changed
- **New Positions Default Inactive**: Positions now default to inactive on creation — use `/application position toggle` to activate
- **Application Message Emoji**: Position titles now display emoji in the channel message headings
- **Button Differentiation**: Duplicate emoji buttons now cycle through Primary/Secondary/Success/Danger styles
- **Button Labels**: Apply buttons now show "Apply - {Title}" instead of just "Apply"
- **"No Positions" Message**: Added emoji prefix to the empty positions message
- **Position List Display**: Now shows `#displayOrder (ID: id)` format for clarity
- **Position Autocomplete**: Now shows `#displayOrder` prefix with active/inactive status

### Added
- **Reindex Command**: `/application position reindex` to manually reindex position display numbers
- **Session Timeout System**: Field management sessions auto-expire after 15 minutes

## [2.11.0] - 2026-02-21

### Added
- **Custom Application Templates**: 5 preset templates (General, Staff, Content Creator, Developer, Partnership) with pre-configured fields, emoji, and age gate settings
- **Custom Application Fields**: Per-position custom modal fields (up to 5 per Discord limits) — same interactive field manager as the ticket system with Add, Delete, Reorder, and Preview
- **Position Edit Command**: `/application position edit` with modal-based editing for title, description, emoji, and age gate toggle
- **Position Fields Command**: `/application position fields` for interactive custom field management
- **Per-Position Emoji**: Each position can have a custom emoji displayed on its apply button
- **Per-Position Age Gate**: Age verification can be toggled on/off per position (previously always on)
- **Dynamic Application Modals**: Application modals are built dynamically from custom fields instead of hardcoded inputs
- **Position Autocomplete**: Remove, toggle, edit, and fields subcommands now use autocomplete instead of integer IDs

### Changed
- **Shared CustomInputField Interface**: Moved `CustomInputField` from ticket entity to shared location (`src/typeorm/entities/shared/`) for reuse across tickets and applications
- **Application Position Handler**: Migrated all logging from `logger()` to `enhancedLogger` with proper categories
- **Position List Display**: Now shows emoji, field count, and age gate status per position
- **Application Responses**: Dynamic field display instead of hardcoded 5-field messages — supports any combination of short and paragraph fields
- **Template System**: Replaced single "Set Builder" template with 5 versatile preset templates

### Removed
- Hardcoded "Set Builder" template and its specific modal fields
- Hardcoded "Please remember to include reels/examples" prompt (was Set Builder-specific)
- Fixed 5-field modal (Name, Experience, Why, Location, Availability) — replaced by dynamic fields

## [2.10.2] - 2026-02-19

### Fixed
- **LOC Badge Label**: Changed from "TypeScript" to "lines of code" for conventional labeling
- **LOC Badge Logo**: Added code brackets `</>` icon to match other badge styling
- **Discord Changelog Spacing**: Removed extra blank lines between section headers in webhook messages

## [2.10.1] - 2026-02-19

### Added
- **Cogworks Updates Logo**: Whipped up a lil icon for the Discord webhook profile pic

### Fixed
- **False "Degraded Performance" Status**: Health monitor now uses RSS memory instead of heap ratio for degraded detection — the V8 heap ratio was consistently triggering false positives under normal load
- Configurable via `MEMORY_THRESHOLD_MB` env var (default: 512MB)

### Changed
- **Changelog Format**: Migrated to [Keep a Changelog](https://keepachangelog.com) convention
- **Changelog Workflow**: Random subheader quotes, updated awk parser for new format
- **Cogworks Banner Logo**: Updated banner logo

## [2.10.0] - 2026-02-18

### Added
- **Message Guard System**: Shared utility for safe channel/message fetching and cleanup (`src/utils/setup/messageGuard.ts`)
  - `safeChannelFetch()` — wraps guild channel fetch with null-safe error handling
  - `safeMessageFetch()` — wraps message fetch with null-safe error handling
  - `cleanupOldMessage()` — combines both + deletion, returns true if message is gone
- **Channel Delete Handler**: New `channelDelete` event listener cleans up all config references when channels are deleted
  - Checks TicketConfig, ArchivedTicketConfig, ApplicationConfig, ArchivedApplicationConfig, BaitChannelConfig, RulesConfig, ReactionRoleMenu, MemoryConfig, AnnouncementConfig
  - Uses `Promise.allSettled` for fault isolation — one failure doesn't block others
  - RulesConfig and ReactionRoleMenu entries are fully deleted (can't function without channel)
  - BaitChannelConfig is disabled when its main channel is deleted
- **Random Presence Messages**: Bot now randomly selects from 12 humorous presence messages on startup instead of a single static message
- **Emoji Validation**: New `validateEmoji()` utility validates Unicode and custom Discord emoji format in `/rules-setup` and `/reactionrole add`
- **`requireBotOwner()` Helper**: Centralized bot-owner permission check used across all `/status` subcommands

### Fixed
- **Duplicate Bot Messages on Re-Setup**: `/ticket-setup`, `/application-setup`, and `/rules-setup` now always clean up old messages, even when re-running with the same channel
  - Previously only cleaned up when the channel *changed* — same-channel re-setup left orphan messages
- **Dev Bot Status Presence**: Dev mode now respects non-operational status levels (degraded, outage, maintenance) instead of always showing "Development Mode"
- **Rules Cache Invalidation**: `/rules-setup setup` and `/rules-setup remove` now properly invalidate the in-memory rules cache after config changes
- **Reaction Role Create Crash**: Fixed `rateCheck.message` crash when rate limit triggers — now uses `LANGF()` for formatted messages
- **Guild-Scoped Reload Queries**: `/reactionrole add` and `/reactionrole remove` now include `guildId` in reload queries to prevent cross-guild data leaks
- **`truncateWithNotice()` Edge Case**: Fixed negative slice when `maxLength` is smaller than the suffix length
- **Reaction Role List Error**: Fixed incorrect error message key reference
- **Import Paths**: Fixed `../../lang` → `../index` in StatusManager and menuBuilder for consistent barrel exports

### Changed
- **Enhanced `messageDelete` Handler**: Expanded from bait-channel-only to tracking all config entity message IDs
  - Now clears stale references when tracked bot messages are externally deleted
  - RulesConfig and ReactionRoleMenu entries are fully deleted when their message is removed
  - Bait channel handling preserved as first check (regression safety)
  - Performance guard: skips non-bot messages early
- **Rate Limiting Expanded**: Added rate limits to `/reactionrole add`, `/reactionrole remove`, `/reactionrole edit`, `/status set`, `/status clear`
- **Input Length Constraints**: Added `setMaxLength()` to all user-facing string options (emoji: 64, descriptions: 200-4000, messages: 1800, status systems: 500)
- **Affected Systems Cap**: `/status set` now caps affected systems to 10 entries with `escapeDiscordMarkdown()` on each
- **GDPR Enhancement**: `guildDelete` handler now clears `BotStatus.updatedBy` when a guild is removed
- **Cache Guild Verification**: Rules reaction and reaction role caches now verify guild ownership before serving cached data
- **Reaction Cooldowns**: 2-second per-user cooldown on rules reaction and reaction role handlers to prevent spam
- **Database Indexes**: Added `@Index(['guildId'])` to BaitChannelConfig, composite `@Index(['guildId', 'messageId'])` to ReactionRoleMenu
- **Autocomplete Performance**: Removed eager `relations: ['options']` from reaction role autocomplete queries
- **Status Command Visibility**: Added `setDefaultMemberPermissions(0)` to hide `/status` from non-admin users
- **Logging**: Migrated comprehensive wizard to `enhancedLogger`, improved logging in channelDelete and messageDelete
- **Biome Formatting**: Auto-formatted 30 files to single-quote, condensed import style

## [2.9.1] - 2026-02-18

### Changed
- **Dependency Updates**: Updated all production and dev dependencies to latest stable versions
  - discord.js 14.17.3 → 14.25.1, TypeScript 5.7 → 5.9, TypeORM 0.3.20 → 0.3.28
  - mysql2 3.12 → 3.17, express 5.1 → 5.2, axios 1.8 → 1.13, @discordjs/rest 2.4 → 2.6
- **Linting Migration**: Replaced ESLint + Prettier (7 dev deps) with Biome (1 dep)
  - Faster linting and formatting with zero-config setup
  - Consistent single-quote, semicolons, trailing commas formatting
  - Import organization via `biome check --write`
  - New scripts: `lint`, `lint:fix`, `format`, `format:fix`, `check`, `check:fix`

### Fixed
- Removed unused `this.startTime` assignment in APIConnector constructor
- Removed unused imports across the codebase (caught by Biome)
- Fixed `==` comparison to `===` in command router
- Fixed `isNaN()` to `Number.isNaN()` in validators
- Converted string concatenation to template literals across handlers

### Removed
- `eslint.config.js`, `.prettierrc`, `.prettierignore` (replaced by `biome.json`)
- ESLint/Prettier dev dependencies: eslint, @typescript-eslint/*, prettier, eslint-config-prettier, eslint-plugin-unused-imports, globals, typescript-eslint

## [2.9.0] - 2026-02-18

### Added
- **Outage Status System**: Bot-owner-only status management with automated health integration
  - **Bot presence sync**: Status level automatically updates Discord presence (online/idle/dnd)
  - **Manual override**: 24-hour window where automation won't override manually set status
  - **Health check integration**: Auto-set degraded/outage when health checks fail, auto-clear on recovery (respects manual override)
  - **Status channel posting**: Optional `STATUS_CHANNEL_ID` env var for posting status update embeds

## [2.8.0] - 2026-02-18

### Added
- **Rules Acknowledgment System**: React-to-accept-rules role assignment
  - `/rules-setup setup` — Configure rules message with channel, role, emoji, and optional custom message
  - `/rules-setup view` — View current rules configuration
  - `/rules-setup remove` — Remove rules message and configuration
  - Automatic role assignment on reaction, role removal on un-react
  - In-memory cache for fast reaction event handling
  - Role validation: prevents @everyone, managed roles, and roles above bot
  - Cache invalidated on setup/remove and guild leave
- **Reaction Role Menu System**: Carl-bot-style reaction role menus with 3 modes
  - `/reactionrole create` — Create a menu with channel, name, description, and mode (normal/unique/lock)
  - `/reactionrole add` — Add emoji→role option to a menu (validates role, duplicate checks)
  - `/reactionrole remove` — Remove an option by emoji
  - `/reactionrole edit` — Edit menu name, description, or mode
  - `/reactionrole delete` — Delete entire menu with confirmation
  - `/reactionrole list` — List all menus and their options
  - Autocomplete for menu selection in all subcommands
  - **Normal mode**: Users can select/deselect multiple roles
  - **Unique mode**: Only one role at a time — selecting new removes old
  - **Lock mode**: Once selected, role cannot be removed by un-reacting
  - In-memory caching for fast reaction event handling
  - Max 25 menus per guild, 20 options per menu (Discord reaction limit)
  - Deleted role detection shown with warning in list view

### Changed
- **GDPR Cleanup**: `deleteAllGuildData()` now covers RulesConfig and ReactionRoleMenu entities
- **Event Infrastructure**: Added `GatewayIntentBits.GuildMessageReactions` intent and `Partials` for uncached message/reaction handling

## [2.7.0] - 2026-02-18

### Changed
- **Setup Command Consolidation**: `/ticket-setup` and `/application-setup` no longer use subcommands
  - `/ticket-setup channel`, `/ticket-setup archive`, `/ticket-setup category` → Single `/ticket-setup` command with optional `channel`, `archive`, `category` options
  - `/application-setup` now uses optional `channel`, `archive`, `category` options (same pattern)
  - Admins can update individual settings or all at once in a single command

### Fixed
- **Memory System Bugs**:
  - Fixed markdown formatting in memory items (bold labels, description display)
  - `/memory capture` now accepts a `message_link` parameter (message ID or full link)
  - Fixed "interaction failed" error when setting memory items to "Completed" status (reply now sent before thread archive)
  - Added double-click guard on confirmation buttons in `/memory update`
- **SQL Injection in Database Migration**: Fixed 4 raw SQL statements using string interpolation in `databaseMigration.ts` — now uses parameterized queries with `?` placeholders
- **requireAdmin() Bypass**: Fixed critical security bug in 4 command handlers (`role/add`, `role/remove`, `role/list`, `announcement/setup`) where `requireAdmin()` result was incorrectly used as a boolean instead of checking `.allowed` property
- **Health Server Security**: Added `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers

### Added
- **Input Sanitization Utility** (`src/utils/validation/inputSanitizer.ts`):
  - `escapeDiscordMarkdown()` — escapes `*`, `_`, `` ` ``, `~`, `|`, `>` in user text
  - `validateSnowflake()` — validates Discord snowflake IDs (17-20 digit numeric)
  - `truncateWithNotice()` — truncates long text with indicator
- **Markdown Escaping**: Applied `escapeDiscordMarkdown()` to user-provided text in ticket forms (all types) and application submissions where content appears inline with bot formatting
- **DDL Allowlist Validation**: Database migration DDL queries now validate table/column names against hardcoded allowlists

### Security
- Parameterized all raw SQL in database migration
- Hardened health server HTTP headers
- Fixed permission bypass in 4 admin-only command handlers
- Added Discord markdown injection prevention on all ticket and application user inputs

## [2.6.0] - 2026-01-27

### Added
- **Memory System**: Forum-based todo/issue tracker for managing bugs, features, suggestions, reminders, and notes
  - `/memory-setup` - Configure memory system with existing or new forum channel
  - `/memory add` - Manually create memory items with title, description, category, and status
  - `/memory capture` - Capture existing messages as memory items via message link
  - `/memory update` - Update status of a memory item (run inside memory thread)
  - `/memory delete` - Delete a memory item (run inside memory thread)
  - `/memory tags` - Manage tags (add/edit/remove/list)
  - Default category tags: Bug, Feature, Suggestion, Reminder, Note
  - Default status tags: Open, In Progress, On Hold, Completed
  - Tags sync with Discord forum tags for visual organization
  - Auto-close threads when status set to "Completed"
  - Pinned welcome post in memory forum
- **Coffee Command**: New `/coffee` command to support Cogworks development
  - Links to Buy Me a Coffee page

## [2.5.0] - 2026-01-27

### Changed
- **Command Consolidation**: Consolidated role commands into single `/role` command
  - `/add-role` → `/role add staff` or `/role add admin`
  - `/remove-role` → `/role remove staff` or `/role remove admin`
  - `/get-roles` → `/role list`
- **Application Position**: Moved `/application-position` subcommands under `/application position`
  - `/application-position add` → `/application position add`
  - `/application-position remove` → `/application position remove`
  - `/application-position toggle` → `/application position toggle`
  - `/application-position list` → `/application position list`
  - `/application-position refresh` → `/application position refresh`

### Removed
- **Legacy Commands**: Removed deprecated commands
  - `/ticket-reply` command (legacy ban appeal feature)
  - `baResponses.json` (unused legacy file)
  - `/add-role`, `/remove-role`, `/get-roles` (consolidated into `/role`)
  - `/application-position` (moved under `/application`)

## [2.4.11] - 2026-01-21

### Changed
- **API Migration**: Updated all API endpoints from `/api/cogworks/*` to `/v2/cogworks/*`
  - Endpoints updated: register, stats, command-log, disconnect
  - Production API URL now: `https://api.nindroidsystems.com`
- **Environment Config**: Updated `.env.example` with new API URL format

### Fixed
- **Discord Changelog Truncation**: Fixed partial list items appearing when changelog is truncated for Discord's character limit

## [2.4.10] - 2026-01-17

### Added
- **Ping Command**: New `/ping` command to check bot latency and status
- **Ticket Settings Command**: New `/ticket settings` subcommand
  - `/ticket settings admin-only-mention <enabled>` - Toggle staff ping when ticket creator requests admin-only
  - `/ticket settings ping-on-create <enabled> type:<type>` - Toggle staff ping when a specific ticket type is created
- **Ping Staff on Ticket Creation**: Configurable per-type staff ping when tickets are created
  - Works for both legacy types (18_verify, ban_appeal, player_report, bug_report, other) and custom types
  - Legacy types stored in TicketConfig, custom types stored in CustomTicketType
  - Player Report now respects the toggle (previously always pinged)
- **Type Add/Edit Confirmation Embed**: When creating or editing custom ticket types
  - Shows detailed type information (ID, display name, color, status, ping setting)
  - Includes toggle button to enable/disable staff ping directly from confirmation
  - Consistent experience across `/ticket type-add` and `/ticket type-edit`
- **Dev Branch Auto-Sync**: New GitHub workflow to keep dev branch in sync with main

### Changed
- **Ticket Channel Naming**: Changed separator from hyphen to underscore
- **Ticket Welcome Message**: Added visual separation between buttons and description
- **Player Report**: Removed hardcoded staff ping, now uses centralized ping-on-create system
- **Custom Ticket Type Defaults**: Staff ping is now **disabled by default** when creating new ticket types
  - Admins must explicitly enable ping via the toggle button or `/ticket settings ping-on-create`
- **Logging Improvements**: Added debug logging for ticket type management
- **Debug Logging Overhaul**: Environment-aware logging throughout the codebase
  - **Development**: Shows DEBUG-level logs for detailed interaction tracking
  - **Production**: Shows only INFO+ logs for clean console output
- **Health Monitor Improvements**: Reduced console log flooding in production

## [2.4.9] - 2026-01-07

### Fixed
- **Discord Changelog Webhook**: Suppressed embed previews from webhook messages

## [2.4.8] - 2026-01-07

### Added
- **Centralized Emoji System**: New emoji configuration for consistent message styling
  - All emojis now use centralized `Emoji` constants (`src/utils/emojis.ts`)
  - Shorthand access via `E.*` (e.g., `E.ok`, `E.error`, `E.warn`)
  - Wrapper functions via `em.*` (e.g., `em.success(text)`, `em.error(text)`)
  - `emLANGF()` helper for combining emojis with formatted template strings

### Changed
- Migrated lang strings to emoji-free text
- Improved emoji consistency across all messages and embeds

## [2.4.7] - 2026-01-07

### Changed
- **Documentation Updates**: Comprehensive update to all documentation files
  - Updated `commands.md` with custom ticket types and new features
  - Updated `admin_guide.md` with configuration guides and auto-protected users
  - Updated `privacy_policy.md` with data handling information
  - Updated `terms_of_service.md` with current feature list
  - All dates updated to January 5, 2026

## [2.4.6] - 2026-01-07

### Added
- **Centralized Color System**: New color configuration for consistent embed styling
  - All embed colors now use centralized `Colors` constants
  - Semantic color naming by category (status, severity, moderation, bait, ticket, etc.)
  - Helper function `getColor()` for dynamic color access

### Changed
- Improved color consistency across all embeds

## [2.4.5] - 2026-01-07

### Changed
- **Complete Lang System Migration**: Migrated all hardcoded strings to centralized lang system
  - Command builders now use lang entries for descriptions
  - Welcome embed fully localized (`lang.general.welcome`)
  - Centralized button labels (`lang.general.buttons`)
  - Bait channel builder strings migrated
  - Dev and migrate command strings migrated
  - ~150+ strings migrated for future i18n support

## [2.4.4] - 2026-01-07

### Changed
- **Discord Changelog Webhook**: Improved markdown formatting in GitHub Actions workflow
  - Clean header with version number
  - Quote line for announcement style
  - Section headers (Added, Fixed, Changed, Removed)
  - Better spacing and readability
  - Small-text footer with GitHub link

## [2.4.3] - 2026-01-07

### Fixed
- **Lang System Cleanup**: Went through and removed unwanted emojis

## [2.4.2] - 2025-12-29

### Fixed
- **Bait Channel Message Cleanup**: Old warning message is now deleted when changing bait channel
  - Prevents duplicate messages when switching channels
  - Setup reply now shows "Updated" instead of "Configured" when modifying existing config
- **Server Owner Whitelist**: Server owner is now automatically whitelisted
  - Prevents "Missing Permissions" errors when owner tests the bait channel
  - Shows "User is the Server Owner" as whitelist reason
- **Log Embed Formatting**: Reformatted bait channel log embeds for better readability

### Removed
- **package-lock.json**: Removed redundant npm lockfile (project uses Bun with bun.lock)
- **`API_TOKEN` env variable**: Removed redundant token variable

## [2.4.1] - 2025-12-29

### Fixed
- **Bait Channel Ban/Kick Actions**: Actions now properly execute and report results
  - Restructured `executeAction()` to log AFTER action completes
  - Log channel now shows actual success/failure status with failure reason
- **Warning Message Deletion Race Condition**: Fixed duplicate deletion attempts
  - Added existence check in setTimeout callback before processing
  - Prevents "Failed to delete warning message" warnings in logs
- **Whitelisted User Handling**: Improved feedback for whitelisted users
  - Messages from whitelisted users are now deleted (previously ignored)
  - New embed logged to channel explaining whitelist status

## [2.4.0] - 2025-12-29

### Added
- **Docker Containerization**: Complete migration from PM2 to Docker
  - Multi-stage Dockerfile using Bun runtime on Alpine
  - docker-compose.yml for easy deployment
  - Health checks using existing `/health/live` endpoint
  - Non-root user for security
  - 1GB memory limit (matching previous PM2 config)
- **GitHub Actions Deployment**: New CI/CD pipeline
  - Automatic build and deploy on push to `main`
  - SSH-based deployment to production server
  - Deployment verification with health checks
- **Git Workflow**: Implemented `main` + `dev` branch structure
  - `main`: Production-ready, triggers deployments
  - `dev`: Work-in-progress development
- **CLAUDE.md**: AI assistant context documentation
  - Comprehensive project guidelines for Claude Code
  - Replaces `.github/copilot-instructions.md`

### Removed
- `ecosystem.config.js` - PM2 configuration (replaced by Docker)
- `nodemon.json` - Nodemon configuration (Docker handles development differently)

## [2.3.1] - 2025-12-16

### Added
- **User Ticket Restrictions**: New `/ticket user-restrict` command to manage user access to ticket types
  - Restrict specific users from creating specific ticket types
  - Interactive configurator embed when no type specified
  - Quick toggle with confirmation when type is specified
  - Restricted types are hidden from the user's ticket type selection menu
  - Guild-scoped for proper multi-server isolation

### Fixed
- Fixed bait channel system not detecting messages
- Added comprehensive DEBUG-level logging for easier troubleshooting
- Fixed bot-changelog action to handle backticks safely

### Changed
- Changed `/dev` and `/migrate` commands from owner-only to admin-only
- Enhanced logging for bait channel system at DEBUG level
- Silent failure points now log configuration issues
- Added console warning when forum tag limit (20) reached
- Migrated dev command strings to lang system
- Removed legacy devBulkClose files (functionality moved to `/dev bulk-close-tickets`)

## [2.3.0] - 2025-10-29

### Fixed
- Replaced all `ephemeral: true` with `flags: [MessageFlags.Ephemeral]` across entire codebase
- Added MessageFlags imports where needed
- Modernizes code to use current Discord.js v14 API

## [2.2.9] - 2025-10-29

### Fixed
- Fixed cross-server data leak in ticket/application close events

## [2.2.8] - 2025-10-29

### Added
- **Custom Ticket Type Fields**: New `/ticket type-fields` command for configuring custom input fields per ticket type
  - Interactive UI with add/delete/reorder/preview functionality
  - Supports short text and paragraph fields with validation
  - 5-minute draft caching for failed submissions
  - Up to 5 custom fields per ticket type (Discord modal limit)
- **Forum Tag System**: Automatic forum tags for archived tickets
  - Tags created based on ticket type (custom or legacy)
  - Tags accumulate on multi-type tickets (merging, not replacing)
  - Works for both new and re-closed tickets
  - Supports emoji icons for visual identification
- **Migration Command**: New `/migrate` command for retroactive updates
  - `/migrate ticket-tags` - Apply forum tags to existing archived tickets
  - Merges with existing tags without duplicates
- **Dev Command Consolidation**: New `/dev` command structure
  - `/dev bulk-close-tickets` - Close all active tickets
  - `/dev delete-archived-ticket` - Delete specific archived ticket + forum post
  - `/dev delete-all-archived-tickets` - Bulk delete with statistics
  - `/dev delete-archived-application` - Delete specific archived application + forum post
  - `/dev delete-all-archived-applications` - Bulk delete applications
  - All commands now delete both database records and forum posts
  - Detailed statistics for bulk operations
- **Ticket Type Management**: Enhanced ticket type system
  - `/ticket type-remove` - Delete custom ticket types with confirmation
  - New types auto-disabled until configured
  - Auto-prompt for field configuration after type creation
  - Field reordering with up/down buttons
  - Preview modal for testing field configurations

### Changed
- **Forum Tag Behavior**: Tags now add to existing tags instead of replacing them
- **Dev Commands**: Moved from standalone to subcommand structure (e.g., `dev-bulk-close` → `/dev bulk-close-tickets`)
- **Status Indicators**: Updated to use circles

### Fixed
- **Forum Tags**: Tags now properly apply on both first close and re-close scenarios
- **Forum Tag Accumulation**: Tags now merge with existing tags instead of replacing them
- **Ephemeral Deprecation**: Replaced `ephemeral: true` with `flags: [MessageFlags.Ephemeral]` in dev/migration commands
- **Autocomplete**: Fixed "Loading options failed" errors for type-remove and type-fields commands
- **Button Routing**: Fixed multi-underscore button ID parsing for field reordering
- **Delete Field**: Fixed timing issues with field deletion UI updates

## [2.2.7] - 2025-10-29

### Fixed
- Hot fix for archiving issues — if the directory for temp files doesn't exist, then make it
- Added env variable for temp directory name (for both ticket and application archiving)
- Added bulk close tickets command for dev bot

## [2.2.6] - 2025-10-29

### Changed
- Added admin permission checks to `/announcement`, `/application-positions`, and `/bot-setup` commands
- Made script for database verification
- Added rate limiting to missing handlers (ticketSetup, applicationSetup, addRole, removeRole, getRoles, applicationPosition, announcement/setup, baitChannel/setup)
- Went over data validation and injection protection

## [2.2.5] - 2025-11-03

### Fixed
- Fixed pm2 ecosystem file for server migration

## [2.2.4] - 2025-10-30

### Fixed
- Fixed NinSys API errors and made sure things lined up correctly
- Organized and implemented more things for the lang system

## [2.2.3] - 2025-10-29

### Fixed
- Hotfix for the bot-changelog github script

## [2.2.2] - 2025-10-29

### Added
- **Bun Runtime Support**: Switched to Bun for improved performance with Node.js fallback
- **GitHub Actions Deployment**: Auto-deploy on push to main or version tag
- **Dev Mode Rate Limit Bypass**: Rate limits automatically disabled when running dev bot

### Changed
- **Bait Channel Warnings**: Now uses in-channel replies instead of DMs (works even with DMs disabled)
- **Bait Channel Setup**: Removed setup messages from log channel (cleaner integration)
- **Documentation**: Cleaned up CHANGELOG and TODO for better readability
- Fixed duplicate shutdown messages

## [2.2.1] - 2025-10-29

### Added
- New language modules: `dataExport.json`, `errors.json`

### Changed
- Migrated all hardcoded strings to centralized lang system
- Full TypeScript autocomplete support for all language strings

## [2.2.0] - 2025-10-29

### Added
- **Multi-Server Support**: Guild-scoped queries with automatic data isolation
- **Guild Lifecycle**: Welcome messages, auto data deletion on leave, GDPR `/data-export` command
- **Rate Limiting**: Applied to all user-facing commands (tickets 3/hr, applications 2/day, global 30/min)
- **Permission System**: Centralized validation with helpful error messages
- **Health Monitoring**: HTTP endpoints (`/health`, `/health/ready`, `/health/live`)
- **Enhanced Logging**: Multi-level, category-based logging with file rotation
- **Testing Framework**: 121 passing tests across 5 test suites

### Changed
- Utils directory reorganized into `/validation`, `/monitoring`, `/database`, `/security`
- Database schema requires migration

## [2.1.0] - 2025-10-29

### Added
- Development mode indicators (yellow dot + "[DEV]" prefix)
- MIT License

### Changed
- Environment validation with safety defaults
- Updated README with multi-server features

## [2.0.0] - 2025-10-29

### Added
- **Bait Channel Anti-Bot System**:
  - **Smart Detection System**: 7 detection flags with suspicion scoring (0-100)
  - Configurable thresholds for account age, membership duration, message count
  - Automated actions: ban, kick, or log-only with grace period
  - Whitelist management (role-based and user-based)
  - Comprehensive logging with rich embeds and statistics dashboard
  - User activity tracking for improved detection accuracy
  - Commands: `/baitchannel` with 6 subcommands (setup, detection, whitelist, status, stats, toggle)
- **Announcement System**: Rich embed templates with preview, Discord timestamps, auto-crossposting
- **API Connector**: Retry logic with exponential backoff, circuit breaker pattern, health monitoring
- **Bot Setup System**: Step-by-step configuration wizard with progress indicators
- **Comprehensive Error Handling**: Centralized handler with severity levels, categories, and user-friendly messages
- **Utility Modules**: Embed builders, interaction collectors, validators, permissions

### Changed
- **Language System Refactoring**: Split monolithic `lang.json` into 9 separate modules with TypeScript types
- **Handler Refactoring**: Bot setup, ticket interaction, and application interaction handlers rewritten
- **Deployment**: PM2 process manager with auto-restart, graceful shutdown, and log management

### Removed
- Deprecated archiveMigration feature
- Unused error variables and imports

## [1.4.7] - 2025-09-21

### Fixed
- API status logging frequency reduced to prevent spam

## [1.4.6] - 2025-09-20

### Changed
- Removed API endpoint — no longer being run by Cogworks bot
- Added API connector logic to Nindroid Systems API

## [1.4.5] - 2025-07-21

### Added
- Announcement module (WIP)
- Announcement for server-side maintenance
- Helper function to parse time input

## [1.4.4] - 2025-07-21

### Added
- API endpoint for personal homepage

## [1.4.3] - 2025-07-19

### Changed
- Lang and file organization cleanup
- Added Global Staff Role mention when ticket creator attempts admin-only
- Better console logging with timestamps and colors
- Small niche fixes overall

## [1.4.2] - 2025-07-18

### Fixed
- Application going over the Discord message character limit

## [1.4.1] - 2025-07-18

### Changed
- Small format changes to application prefills

## [1.4.0] - 2025-07-17

### Added
- New ticket section for Applications (WIP)

## [1.3.8] - 2025-06-11

### Changed
- Migrator logic deprecated
- Started steps to get Cogworks as a verified app
- Cleaned up Bot Setup

## [1.3.7] - 2025-06-11

### Changed
- Fixed logic in migrator to accommodate duplicates
- Started announcement module organizing

## [1.3.6] - 2025-06-10

### Added
- Archive migration downloader and migrator logic

### Changed
- Large lang cleanup and organization

## [1.3.5] - 2025-06-04

### Fixed
- Major backend issue of things not updating
- Archive migration interaction replies

## [1.3.4] - 2025-06-03

### Added
- New command for archival migration

### Changed
- More work on Cogdeck battle manager (cards now managed in database)
- Cleaned up some lang stuff

## [1.3.3] - 2025-05-27

### Changed
- Small GitHub action format change

## [1.3.2] - 2025-05-27

### Fixed
- GitHub action to actually work (hopefully)

## [1.3.1] - 2025-05-27

### Fixed
- Small format issue with player report ticket and global staff command
- Bugs with Cogdeck
- Migrated cards from JSON to database

## [1.3.0] - 2025-05-04

### Added
- Card game logic (object-oriented)
- GitHub action to notify dev server of changelog updates (channel can be followed)

### Changed
- Using lint and prettier for code cleanup

## [1.2.4] - 2025-05-04

### Changed
- Added differentiation between applicationCommands and applicationGuildCommands
- Configured prettier and eslint for consistency
- Started making a card game
- Made a function to set the bot's profile description

## [1.2.3] - 2025-05-04

### Fixed
- Bot-setup roleCollector/buttonCollector not properly stopping
- Cleaned up lang stuff

## [1.2.2] - 2025-04-28

### Fixed
- Small oopsie fix

## [1.2.1] - 2025-04-28

### Added
- Ticket creator and staff can send reactions, emojis, and attachments in tickets
- `/bot-setup` command for initial configuration
- Global Staff Role (configurable in bot setup)
- Player report ticket now mentions Global Staff Role
- Custom presence

## [1.1.3] - 2025-04-20

### Removed
- Deprecated `GUILD_ID` env variable (no longer necessary)

## [1.1.2] - 2025-04-20

### Changed
- Admin Only button now sends a request instead of running logic directly
- Fixed slash commands only showing up on set Discord server

## [1.1.1] - 2025-04-17

### Changed
- Added logic for determining production vs development bot
- Added more console logging
- Fixed small lang issue with `/get-roles` command

## [1.1.0] - 2025-04-16

### Added
- First "Beta" version (deployed to larger server)
- Dev bot for safe testing

### Fixed
- Tickets now allow anyone who can view the ticket to close/admin-only it

## [1.0.3] - 2025-04-15

### Added
- Utility function for extracting role IDs from database
- "Admin Only" button next to ticket close button
- Ticket Category to ticket config database
- Ticket category adding command

### Changed
- Multiple files migrated to use lang JSON
- Fixed styling with Admin Only and Close Ticket buttons

## [1.0.2] - 2025-04-11

### Added
- Changelog
- Admin/staff roles v2 (`add-role` slash command)
- Removing admin/staff roles (`remove-role` slash command)
- Getting roles (`get-roles` slash command)
- Role permissions to channels for ticket creation
- Documentation

## [1.0.0] - 2025-03-23

Initial release.
