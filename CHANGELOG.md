# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
