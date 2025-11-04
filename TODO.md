# TODO

## Multi-Server Deployment

### Database Migration
- [x] Run migration pre-check: `npx ts-node scripts/testMigration.ts`
- [x] Execute migration: `npx ts-node src/utils/databaseMigration.ts`
- [x] Verify all tickets/applications have guildId
- [x] Delete migration script after success
- [ ] Performance testing with indexes

### Testing
- [ ] Test guild join/leave flow
- [ ] Verify data isolation between guilds
- [x] Test concurrent operations (2+ guilds)
- [ ] Multi-guild testing with 10+ servers (prolly not gonna do lol)
- [ ] Performance benchmarking

## Infrastructure

### GitHub Actions
- [x] Deployment workflow created
- [ ] Configure secrets (SERVER_HOST, SERVER_USER, SERVER_SSH_KEY)
- [ ] Test deployment to staging

### Monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Implement uptime monitoring
- [ ] Create bot statistics dashboard
- [ ] Set up alerts for critical errors

## Code Quality
- [ ] Review and test all command error messages
- [ ] Audit console.log statements (use enhancedLogger)
- [ ] Create emoji usage style guide
- [ ] Security audit (input validation, XSS, permissions)

## Discord Verification
- [ ] Create support server
- [ ] Update bot description
- [x] Add privacy/ToS URLs to bot settings
- [ ] Configure OAuth2 scopes properly

## Future Features
`private/docs/later/todo.md`:
- Custom ticket types system
- Command logging & analytics
- Email-to-ticket integration
- Performance optimizations
- GitHub Wiki for documentation and guides
- GitHub Wiki for documentation and guides

---

## Completed Tasks
[x] do the logic of getting each saved role (if any) and add them to the perms of ticket channels
[x] make command for ticket 'admin only' (removes everyone from being able to see the ticket except for ticket creator and admins)
[x] fix styling with admin only button and cancel button
[x] make sure staff and admins can also close the ticket (or make tickets admin only)
[x] make sure the bot knows when it's suppose to be in Development or Production mode
[x] Handle a better way to allow ticket creators to use the Admin Only button
[x] make more replies for bapples (like our shtuff)
[x] fix slash commands only showing up on one server
[x] deprecate the env variable GUILD_ID
[x] make sure the ticket creator can send images into tickets
[x] make a config option for a global staff role
[x] when a player report ticket is made, @ the global staff role
[x] actually get the custom status working lol
[x] do some type shite for slash commands where we yoink the guilds that have done the bot setup command (from bot config) and use guild commands, otherwise stick to application commands
[x] fix up the whole command registering (in an event like adding a new bot config)
[x] start announcement module

### Overhaul List

#### Phase 1: Foundation

##### 1. Code Cleanup & Organization
- [x] Remove unused imports throughout codebase
- [x] Fix all ESLint warnings
- [x] Remove duplicate eslint-disable comments
- [x] Ensure consistent code formatting
- [x] Standardize function/variable naming
- [x] Modernize ESLint to v9+ flat config
- [x] Remove deprecated archiveMigration feature
- [x] Update to TypeScript strict mode

##### 2. Create Utility Functions
- [x] Create `src/utils/embedBuilders.ts` for reusable embed creators
- [x] Create `src/utils/collectors.ts` for interaction collector patterns
- [x] Create `src/utils/validators.ts` for input validation helpers
- [x] Create `src/utils/permissions.ts` for permission checking
- [x] Add usage guide (`docs/utility_usage_examples.md`)
- [x] Refactor ticket handlers to use new utilities
- [x] Refactor application handlers to use new utilities
- [x] Refactor bot setup to use new utilities

##### 3. Refactor lang.json System
- [x] Restructure lang.json (split into 9 modules by feature)
- [x] Create TypeScript type definitions (`lang/types.ts`)
- [x] Split into multiple files (`general`, `ticket`, `application`, etc.)
- [x] Add type-safe access via `Language` interface`
- [x] Maintain backward compatibility with existing code
- [x] Update exports in `utils/index.ts`

#### Phase 2: Feature Improvements

##### 1. Redesign Bot Setup System
- [x] Create multi-step wizard interface
- [x] Add progress indicators
- [x] Implement step navigation (next/back)
- [x] Add confirmation before saving
- [x] Use embed builders for professional look
- [x] Extend timeout for configuration (3 minutes)
- [x] Add option to skip/cancel setup
- [x] Create modular step handlers
- [x] Document new system

##### 2. Enhance API Connector
- [x] Add retry logic with exponential backoff
- [x] Implement circuit breaker pattern
- [x] Add request/response logging
- [x] Add health monitoring
- [x] Better error messages
- [x] Add metrics tracking
- [x] Implement graceful degradation

##### 3. Update Announcement System
- [x] Clean up announcement module
- [x] Create template system (6 pre-built templates)
- [x] Use embed builders for visuals
- [x] Add preview before sending (Send/Cancel buttons)
- [x] Enable update commands (update-scheduled, update-complete)
- [x] Add rich embeds with emojis and fields
- [x] Discord timestamp support
- [x] Template parameter validation

#### Phase 3: Reliability

##### 1. Comprehensive Error Handling
- [x] Create centralized error handler
- [x] Add error classification (categories & severity)
- [x] Implement error logging with context
- [x] User-friendly error messages with embeds
- [x] Global unhandled rejection handlers
- [x] Safe database operation wrapper
- [x] Handler error wrapper function
- [x] Apply to handlers (ticketReply example)
- [x] Error context tracking

#### Phase 4: Priority Features

##### 1. Integrate Bait Channel System
- [x] Move entities from `imports/` to `src/typeorm/entities/`
- [x] Move utils from `imports/` to `src/utils/`
- [x] Move commands from `imports/` to `src/commands/`
- [x] Register bait channel commands
- [x] Create ban log channel functionality
- [x] Add message monitoring events
- [x] Database migrations
- [x] Apply error handling throughout

### Documentation & Verification

- [x] Professional Privacy Policy (Discord verification ready)
- [x] Comprehensive Terms of Service (16 sections)
- [x] Complete Commands Documentation (styled sections)
- [x] Utils Directory Cleanup (headers, JSDoc, organization)
- [x] Minimal System Docs (moved to private/docs/)
- [x] Documentation Structure Reorganization

### v2.2.2 Stuff
- [x] Bun runtime integration with Node.js fallback
- [x] GitHub Actions deployment workflow
- [x] Bait channel warning improvements (DM → reply)
- [x] Rate limit bypass for dev mode
- [x] Deploy to production
- [x] Test with 2-3 guilds for validation