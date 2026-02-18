# Dev Update v2.10.0

## Added
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

## Fixed
- **Duplicate Bot Messages on Re-Setup**: `/ticket-setup`, `/application-setup`, and `/rules-setup` now always clean up old messages, even when re-running with the same channel
  - Previously only cleaned up when the channel *changed* — same-channel re-setup left orphan messages
- **Dev Bot Status Presence**: Dev mode now respects non-operational status levels (degraded, outage, maintenance) instead of always showing "Development Mode"
- **Rules Cache Invalidation**: `/rules-setup setup` and `/rules-setup remove` now properly invalidate the in-memory rules cache after config changes
- **Reaction Role Create Crash**: Fixed `rateCheck.message` crash when rate limit triggers — now uses `LANGF()` for formatted messages
- **Guild-Scoped Reload Queries**: `/reactionrole add` and `/reactionrole remove` now include `guildId` in reload queries to prevent cross-guild data leaks
- **`truncateWithNotice()` Edge Case**: Fixed negative slice when `maxLength` is smaller than the suffix length
- **Reaction Role List Error**: Fixed incorrect error message key reference
- **Import Paths**: Fixed `../../lang` → `../index` in StatusManager and menuBuilder for consistent barrel exports

## Changed
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

---

# Dev Update v2.9.1

## Changed
- **Dependency Updates**: Updated all production and dev dependencies to latest stable versions
  - discord.js 14.17.3 → 14.25.1, TypeScript 5.7 → 5.9, TypeORM 0.3.20 → 0.3.28
  - mysql2 3.12 → 3.17, express 5.1 → 5.2, axios 1.8 → 1.13, @discordjs/rest 2.4 → 2.6
- **Linting Migration**: Replaced ESLint + Prettier (7 dev deps) with Biome (1 dep)
  - Faster linting and formatting with zero-config setup
  - Consistent single-quote, semicolons, trailing commas formatting
  - Import organization via `biome check --write`
  - New scripts: `lint`, `lint:fix`, `format`, `format:fix`, `check`, `check:fix`

## Fixed
- Removed unused `this.startTime` assignment in APIConnector constructor
- Removed unused imports across the codebase (caught by Biome)
- Fixed `==` comparison to `===` in command router
- Fixed `isNaN()` to `Number.isNaN()` in validators
- Converted string concatenation to template literals across handlers

## Removed
- `eslint.config.js`, `.prettierrc`, `.prettierignore` (replaced by `biome.json`)
- ESLint/Prettier dev dependencies: eslint, @typescript-eslint/*, prettier, eslint-config-prettier, eslint-plugin-unused-imports, globals, typescript-eslint

---

# Dev Update v2.9.0

## Added
- **Outage Status System**: Bot-owner-only status management with automated health integration
  - **Bot presence sync**: Status level automatically updates Discord presence (online/idle/dnd)
  - **Manual override**: 24-hour window where automation won't override manually set status
  - **Health check integration**: Auto-set degraded/outage when health checks fail, auto-clear on recovery (respects manual override)
  - **Status channel posting**: Optional `STATUS_CHANNEL_ID` env var for posting status update embeds

---

# Dev Update v2.8.0

## Added
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

## Changed
- **GDPR Cleanup**: `deleteAllGuildData()` now covers RulesConfig and ReactionRoleMenu entities
- **Event Infrastructure**: Added `GatewayIntentBits.GuildMessageReactions` intent and `Partials` for uncached message/reaction handling

---

# Dev Update v2.7.0

## Changed
- **Setup Command Consolidation**: `/ticket-setup` and `/application-setup` no longer use subcommands
  - `/ticket-setup channel`, `/ticket-setup archive`, `/ticket-setup category` → Single `/ticket-setup` command with optional `channel`, `archive`, `category` options
  - `/application-setup` now uses optional `channel`, `archive`, `category` options (same pattern)
  - Admins can update individual settings or all at once in a single command

## Fixed
- **Memory System Bugs**:
  - Fixed markdown formatting in memory items (bold labels, description display)
  - `/memory capture` now accepts a `message_link` parameter (message ID or full link)
  - Fixed "interaction failed" error when setting memory items to "Completed" status (reply now sent before thread archive)
  - Added double-click guard on confirmation buttons in `/memory update`
- **SQL Injection in Database Migration**: Fixed 4 raw SQL statements using string interpolation in `databaseMigration.ts` — now uses parameterized queries with `?` placeholders
- **requireAdmin() Bypass**: Fixed critical security bug in 4 command handlers (`role/add`, `role/remove`, `role/list`, `announcement/setup`) where `requireAdmin()` result was incorrectly used as a boolean instead of checking `.allowed` property
- **Health Server Security**: Added `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers

## Added
- **Input Sanitization Utility** (`src/utils/validation/inputSanitizer.ts`):
  - `escapeDiscordMarkdown()` — escapes `*`, `_`, `` ` ``, `~`, `|`, `>` in user text
  - `validateSnowflake()` — validates Discord snowflake IDs (17-20 digit numeric)
  - `truncateWithNotice()` — truncates long text with indicator
- **Markdown Escaping**: Applied `escapeDiscordMarkdown()` to user-provided text in ticket forms (all types) and application submissions where content appears inline with bot formatting
- **DDL Allowlist Validation**: Database migration DDL queries now validate table/column names against hardcoded allowlists

## Security
- Parameterized all raw SQL in database migration
- Hardened health server HTTP headers
- Fixed permission bypass in 4 admin-only command handlers
- Added Discord markdown injection prevention on all ticket and application user inputs

---

# Dev Update v2.6.0

## Added
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

---

# Dev Update v2.5.0

## Changed
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

## Removed
- **Legacy Commands**: Removed deprecated commands
  - `/ticket-reply` command (legacy ban appeal feature)
  - `baResponses.json` (unused legacy file)
  - `/add-role`, `/remove-role`, `/get-roles` (consolidated into `/role`)
  - `/application-position` (moved under `/application`)

---

# Dev Update v2.4.11

## Changed
- **API Migration**: Updated all API endpoints from `/api/cogworks/*` to `/v2/cogworks/*`
  - Endpoints updated: register, stats, command-log, disconnect
  - Production API URL now: `https://api.nindroidsystems.com`
- **Environment Config**: Updated `.env.example` with new API URL format

## Fixed
- **Discord Changelog Truncation**: Fixed partial list items appearing when changelog is truncated for Discord's character limit

---

# Dev Update v2.4.10

## Added
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

## Changed
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

---

# Dev Update v2.4.9

## Fixed
- **Discord Changelog Webhook**: Suppressed embed previews from webhook messages

---

# Dev Update v2.4.8

## Added
- **Centralized Emoji System**: New emoji configuration for consistent message styling
  - All emojis now use centralized `Emoji` constants (`src/utils/emojis.ts`)
  - Shorthand access via `E.*` (e.g., `E.ok`, `E.error`, `E.warn`)
  - Wrapper functions via `em.*` (e.g., `em.success(text)`, `em.error(text)`)
  - `emLANGF()` helper for combining emojis with formatted template strings

## Changed
- Migrated lang strings to emoji-free text
- Improved emoji consistency across all messages and embeds

---

# Dev Update v2.4.7

## Changed
- **Documentation Updates**: Comprehensive update to all documentation files
  - Updated `commands.md` with custom ticket types and new features
  - Updated `admin_guide.md` with configuration guides and auto-protected users
  - Updated `privacy_policy.md` with data handling information
  - Updated `terms_of_service.md` with current feature list
  - All dates updated to January 5, 2026

---

# Dev Update v2.4.6

## Added
- **Centralized Color System**: New color configuration for consistent embed styling
  - All embed colors now use centralized `Colors` constants
  - Semantic color naming by category (status, severity, moderation, bait, ticket, etc.)
  - Helper function `getColor()` for dynamic color access

## Changed
- Improved color consistency across all embeds

---

# Dev Update v2.4.5

## Changed
- **Complete Lang System Migration**: Migrated all hardcoded strings to centralized lang system
  - Command builders now use lang entries for descriptions
  - Welcome embed fully localized (`lang.general.welcome`)
  - Centralized button labels (`lang.general.buttons`)
  - Bait channel builder strings migrated
  - Dev and migrate command strings migrated
  - ~150+ strings migrated for future i18n support

---

# Dev Update v2.4.4

## Changed
- **Discord Changelog Webhook**: Improved markdown formatting in GitHub Actions workflow
  - Clean header with version number
  - Quote line for announcement style
  - Section headers (Added, Fixed, Changed, Removed)
  - Better spacing and readability
  - Small-text footer with GitHub link

---

# Dev Update v2.4.3

## Fixed
- **Lang System Cleanup**: Went through and removed unwanted emojis

---

# Dev Update v2.4.2

## Fixed
- **Bait Channel Message Cleanup**: Old warning message is now deleted when changing bait channel
  - Prevents duplicate messages when switching channels
  - Setup reply now shows "Updated" instead of "Configured" when modifying existing config
- **Server Owner Whitelist**: Server owner is now automatically whitelisted
  - Prevents "Missing Permissions" errors when owner tests the bait channel
  - Shows "User is the Server Owner" as whitelist reason
- **Log Embed Formatting**: Reformatted bait channel log embeds for better readability

## Removed
- **package-lock.json**: Removed redundant npm lockfile (project uses Bun with bun.lock)
- **`API_TOKEN` env variable**: Removed redundant 'token' (I forgor what I was using this for, but it isn't necessary now)

---

# Dev Update v2.4.1

## Fixed
- **Bait Channel Ban/Kick Actions**: Actions now properly execute and report results
  - Restructured `executeAction()` to log AFTER action completes
  - Log channel now shows actual success/failure status with failure reason
- **Warning Message Deletion Race Condition**: Fixed duplicate deletion attempts
  - Added existence check in setTimeout callback before processing
  - Prevents "Failed to delete warning message" warnings in logs
- **Whitelisted User Handling**: Improved feedback for whitelisted users
  - Messages from whitelisted users are now deleted (previously ignored)
  - New embed logged to channel explaining whitelist status

---

# Dev Update v2.4.0

## Added
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

## Removed
- `ecosystem.config.js` - PM2 configuration (replaced by Docker)
- `nodemon.json` - Nodemon configuration (Docker handles development differently)

---

# Dev Update v2.3.1

## Added
- **User Ticket Restrictions**: New `/ticket user-restrict` command to manage user access to ticket types
  - Restrict specific users from creating specific ticket types
  - Interactive configurator embed when no type specified
  - Quick toggle with confirmation when type is specified
  - Restricted types are hidden from the user's ticket type selection menu
  - Guild-scoped for proper multi-server isolation

## Fixed
- Fixed bait channel system not detecting messages
- Added comprehensive DEBUG-level logging for easier troubleshooting
- Fixed bot-changelog action to handle backticks safely

## Changed
- Changed `/dev` and `/migrate` commands from owner-only to admin-only

## Improved
- Enhanced logging for bait channel system at DEBUG level
- Silent failure points now log configuration issues
- Added console warning when forum tag limit (20) reached
- Uses logger() for better visibility in production logs
- Migrated dev command strings to lang system
- Removed legacy devBulkClose files (functionality moved to `/dev bulk-close-tickets`)

# Dev Update v2.3.0

## Fixed
- Replaced all `ephemeral: true` with `flags: [MessageFlags.Ephemeral]` across entire codebase
- Added MessageFlags imports where needed
- Modernizes code to use current Discord.js v14 API

# Dev Update v2.2.9

## Fixed
- Fixed cross-server data leak in ticket/application close events

# Dev Update v2.2.8

## Added
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

## Changed
- **Forum Tag Behavior**: Tags now add to existing tags instead of replacing them
- **Dev Commands**: Moved from standalone to subcommand structure (e.g., `dev-bulk-close` → `/dev bulk-close-tickets`)
- **Status Indicators**: Updated to use 🟢/🔴 circles

## Fixed
- **Forum Tags**: Tags now properly apply on both first close and re-close scenarios
- **Forum Tag Accumulation**: Tags now merge with existing tags instead of replacing them
- **Ephemeral Deprecation**: Replaced `ephemeral: true` with `flags: [MessageFlags.Ephemeral]` in dev/migration commands
- **Autocomplete**: Fixed "Loading options failed" errors for type-remove and type-fields commands
- **Button Routing**: Fixed multi-underscore button ID parsing for field reordering
- **Delete Field**: Fixed timing issues with field deletion UI updates

# Dev Update v2.2.7
- Hot fix for archiving issues -- if the directory for temp files doesn't exist, then make it.
- Added env variable for temp directory name (for both ticket and application archiving).
- Added bulk close tickets command for dev bot.

# Dev Update v2.2.6
- Added admin permission checks to `/announcement`, `/application-positions`, and `/bot-setup` commands
- Made script for database verification.
- Added rate limiting to missing handlers (ticketSetup, applicationSetup, addRole, removeRole, getRoles, applicationPosition, announcement/setup, baitChannel/setup).
- Went over data validation and injection protection.

# Dev Update v2.2.5
- Fixed pm2 ecosystem file for server migration.

# Dev Update v2.2.4
- Fixed NinSys API errors and made sure things lined up correctly
- Organized and implemented more things for the lang system

# Dev Update v2.2.3
- Hotfix for the bot-changelog github script.

# Dev Update v2.2.2

## Added
- **Bun Runtime Support**: Switched to Bun for improved performance with Node.js fallback
- **GitHub Actions Deployment**: Auto-deploy on push to main or version tag
- **Dev Mode Rate Limit Bypass**: Rate limits automatically disabled when running dev bot

## Changed
- **Bait Channel Warnings**: Now uses in-channel replies instead of DMs (works even with DMs disabled)
- **Bait Channel Setup**: Removed setup messages from log channel (cleaner integration)
- **Documentation**: Cleaned up CHANGELOG and TODO for better readability
- Fixed duplicate shutdown messages

# Dev Update v2.2.1

## Added
- New language modules: `dataExport.json`, `errors.json`

## Changed
- Migrated all hardcoded strings to centralized lang system
- Full TypeScript autocomplete support for all language strings

# Dev Update v2.2.0

## Added
- **Multi-Server Support**: Guild-scoped queries with automatic data isolation
- **Guild Lifecycle**: Welcome messages, auto data deletion on leave, GDPR `/data-export` command
- **Rate Limiting**: Applied to all user-facing commands (tickets 3/hr, applications 2/day, global 30/min)
- **Permission System**: Centralized validation with helpful error messages
- **Health Monitoring**: HTTP endpoints (`/health`, `/health/ready`, `/health/live`)
- **Enhanced Logging**: Multi-level, category-based logging with file rotation
- **Testing Framework**: 121 passing tests across 5 test suites

## Changed
- Utils directory reorganized into `/validation`, `/monitoring`, `/database`, `/security`
- Database schema requires migration

# Dev Update v2.1.0

## Added
- Development mode indicators (yellow dot + "[DEV]" prefix)
- MIT License

### Changed
- Environment validation with safety defaults
- Updated README with multi-server features

# Dev Update v2.0.0 🎉 yippee
**MAJOR RELEASE - Complete Bot Overhaul**

## Bait Channel Anti-Bot System 
- **Smart Detection System**: 
  - 7 detection flags: new account, new member, no messages, no verification, suspicious content, link spam, mention spam
  - Suspicion scoring (0-100) with automatic classification
  - Configurable thresholds for account age, membership duration, message count
  - Verification role requirement option
- **Automated Actions**:
  - Configurable responses: ban, kick, or log-only (testing mode)
  - Grace period with countdown timer (0-60 seconds)
  - Instant action for high suspicion scores (90+)
  - Message deletion on trigger
- **Whitelist Management**:
  - Role-based and user-based whitelisting
  - Automatic admin whitelisting
  - Easy add/remove via commands
- **Comprehensive Logging**:
  - Database logging of all detections
  - Optional log channel with rich embeds
  - Detection reasons and suspicion breakdown
  - User history tracking (account age, join date, message count)
- **Statistics Dashboard**:
  - Total triggers, bans, kicks, deletions
  - Average suspicion scores
  - Recent detection history
  - Configurable time range (1-90 days)
- **User Activity Tracking**:
  - Message count per user per guild
  - First/last message timestamps
  - Join date tracking
  - Used for improved detection accuracy
- **Error Handling Integration**:
  - All handlers wrapped with comprehensive error handling
  - Safe database operations
  - Graceful degradation on failures
- **Commands**: `/baitchannel` with 6 subcommands
  - `setup` - Configure bait channel and actions
  - `detection` - Smart detection settings
  - `whitelist` - Manage whitelisted roles/users
  - `status` - View current configuration
  - `stats` - Detailed statistics
  - `toggle` - Enable/disable system

## New Utility Modules
- **Embed Builders** (`src/utils/embedBuilders.ts`): Reusable embed creators with consistent styling.
- **Interaction Collectors** (`src/utils/collectors.ts`).
- **Validators** (`src/utils/validators.ts`): Input validation helpers.
- **Permissions** (`src/utils/permissions.ts`): Permission management utilities.

## Handler Refactoring
- **Bot Setup Handler** (`src/commands/handlers/botSetup.ts`).
- **Ticket Interaction** (`src/events/ticketInteraction.ts`).
- **Application Interaction** (`src/events/applicationInteraction.ts`).

## Language System Refactoring
- **Modular Structure**: Split monolithic `lang.json` into 9 separate modules.
- **TypeScript Type Definitions** (`lang/types.ts`).
- **Centralized Export** (`lang/index.ts`).

### Comprehensive Error Handling System
  - Centralized error handler with error classification.
  - Error severity levels (LOW, MEDIUM, HIGH, CRITICAL).
  - Error categories (DATABASE, DISCORD_API, PERMISSIONS, VALIDATION, etc.).
  - User-friendly error messages with helpful embeds.
  - Automatic error logging with context.
  - Global unhandled rejection/exception handlers.
  - Safe database operation wrapper.
  - Handler wrapper for automatic error catching.
  - Error context tracking (command, guild, user, channel).
  - Stack trace logging for debugging.

### Announcement System:
  - Rich embed templates for all announcement types.
  - Preview system with Send/Cancel buttons (2-minute review window).
  - Template system with 6 pre-built templates.
  - Professional embeds with emojis and formatted fields.
  - Discord timestamp support (<t:timestamp:F>, <t:timestamp:R>).
  - Enabled previously commented update commands.
  - Automatic cross-posting for announcement channels.
  - Better error handling and validation.
  - Template parameter validation.
  - See `src/commands/handlers/announcement/templates.ts` for all templates.

### API Connector
  - Automatic retry logic with exponential backoff (max 3 retries).
  - Circuit breaker pattern to prevent cascading failures.
  - Health monitoring with 30-second interval checks.
  - Comprehensive metrics tracking (requests, success rate, response times).
  - Graceful degradation when API is unavailable.
  - Request/response logging with axios interceptors.
  - Smart error handling (don't retry 4xx errors).
  - Automatic recovery testing (half-open state).

### Bot Setup System
  - Step-by-step configuration (Welcome → Staff Role → Summary).
  - Progress indicators showing "Step X of 3" for better UX.
  - Extended timeout (3 minutes) for configuration.
  - Rich embeds with emojis and clear formatting.
  - Cancel/Skip options at each step.
  - Summary confirmation before saving.
  - Update mode for existing configurations.
  - Modular architecture for easy expansion.

## Code Cleanup
- Fixed unused error variables in catch blocks.
- Auto-fixed unused imports throughout codebase.
- Removed deprecated archiveMigration feature (no longer needed).
- Improved code organization and file structure.

## Deployment
- **PM2 Process Manager**: Complete configuration with auto-restart, graceful shutdown, and log management.
- **Multi-Server Ready**: Comprehensive verification checklist for deployment across multiple servers.
- **Email Integration Planning**: Full architecture design for future email-to-ticket system.

## Development
This version of Cogworks' development has been accelerated through the use of AI-assisted development tools, including GitHub Copilot, Claude, and other AI programming assistants. These tools have enhanced productivity while maintaining code quality and best practices. All AI-generated code and documentation has been reviewed, tested, and refined to ensure reliability and security interests.


# Dev Update v1.4.7
- Super small patch for API status logging -- making sure it doesn't get too spammy.

# Dev Update v1.4.6
- Removed API endpoint -- no longer being run by Cogworks bot.
- Added API connector logic to Nindroid Systems API.

# Dev Update v1.4.5
- Added announcement module (still a WIP).
- Added announcement for server-side maintenance (specifically for an MC server).
- Added helper function to parse time input.

# Dev Update v1.4.4
- Added API endpoint for personal homepage.

# Dev Update v1.4.3
- Lang and file organization cleanup.
- Added Global Staff Role mention when a ticket creator is attempting to make a ticket Admin Only.
- Better console logging (now has timestamps).
- Added console colors pretty ooooo.
- Small niche fixes overall.
- Offloading Cogdeck things (I don't think ima work on this for a while, so Cogdeck is to be continued).

# Dev Update v1.4.2
- Hotfix for application going over the discord message character limit.

# Dev Update v1.4.1
- Small format changes to Application prefills. 

# Dev Update v1.4.0
- New ticket section for Applications. (still kinda WIP and some things WILL be changed).

# Dev Update v1.3.8
- Migrator logic will be deprecated this point on cause I don't really have a use for it lmao.
- Started steps to get Cogworks as a verified app.
- Cleaned up Bot Setup.

# Dev Update v1.3.7
- Fixed logic in migrator to accomidate duplicates how I want 
- Started announcement module organizing.

# Dev Update v1.3.6
- Added logic for archive migration downloader AND migrator.
- MORE LARGERER lang cleanup and organization.

# Dev Update v1.3.5
- Fixed major backend issue of things not updating (your honor i'm just a silly lil guy).
- Fixed archive migration interaction replies.

# Dev Update v1.3.4
- More work on cogdeck battle manager.
- (cards are now managed within the database).
- (Cogdeck still in development and not ready for release)
- New command for archival migration.
- Cleaned up some lang shtuff.

# Dev Update v1.3.3
- Changed github action format just a small bit. 

# Dev Update v1.3.2
- (Hopefully) fixed github action to actually work.

# Dev Update v1.3.1
- Fixed small format issue with player report ticket and global staff command. 
- (Cogdeck is NOT aincluded in this update, as it is still in development)
- Fixed bugs with Cogdeck.
- Migrated the cards being a json to just be in the database cause json is being a lil meanie.

# Dev Update v1.3.0
- Card game logic big time omg my head hurts but yay object oriented
- Fixed and updated cogdeck command stuff
- Added cool lil github action to notify my dev server of updates from changelog (channel can be followed)
- (Using lint and prettier now to clean things up)

# Dev Update v1.2.4
- Added differenciation between using applicationCommands or applicationGuildCommands depending on if we have a guild id saved or not
- Configured prettier and eslint a lil more for consistency (and updated all files to follow the set format)
- Started making a lil card game
- Made a function to set the bot's profile description

# Dev Update v1.2.3
- Fixed bot-setup roleCollector/buttonCollector not technically stopping (just end up showing the timeout message)
- Cleaned up a few lang shtuff to make it nicer

# Dev Update v1.2.2
- Just fixed a lil oopsie :3

# Dev Update v1.2.1
- Ticket creator and staff can send reactions, emojis, and attachments in tickets
- Added command `/bot-setup` that allows for some initial configuration. 
- If the bot setup has not been ran, no other commands are usable.
- Added Global Staff Role which can be configured in the bot setup.
- When a player report ticket is made, if the Global Staff Role is enabled and set, then that role will be mentioned in the main message of the ticket.
- Added custom presense

# Dev Update v1.1.3
- Deprecated env variable GUILD_ID since it isn't necessary now

# Dev Update v1.1.2
- Made it so when the ticket creator presses the Admin Only button, instead of running the logic it will send a request so that a staff member can do it.
- Fixed slash commands only showing up on set discord server

# Dev Update v1.1.1
- Added logic for determining if we're using the Production bot or the Development bot
- Added more console logging
- Fixed small lang issue with the `/get-roles` command

# Dev Update v1.1.0
- First 'Beta' version! (I'm putting this on a larger server)
- I also made a dev bot so I do mess anything with the main bot.
- Fixed tickets so anyone that can view the ticket can close/admin only it (since the logic to make sure only specific roles see tickets is in place)

# Dev Update v1.0.3
- Utility function for extracting role ids from the database
- Added 'Admin Only' button next to ticket close button
- Changing a bunch of files to use the lang json
- Added 'Ticket Category' to ticket config database
- Added ticket category adding command
- Made sure logic was fixed for previous ticket category method to current
- Fixed styling with the Admin Only and Close Ticket buttons

# Dev Update v1.0.2
- Changelog finally lol
- Adding admin/staff roles v2 (add-role slash command)
- Removing admin/staff roles (remove-role slash command)
- Getting roles (get-roles slash command)
- Added role permissions to channels for ticket creation
- Added documentation so I don't get lazy later and don't do it