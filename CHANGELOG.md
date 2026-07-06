# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.14.8] - 2026-07-06

Dead-code removal — everything the audit confirmed as having zero callers,
plus two hand-rolled duplicates folded into their shared helpers. No behavior
changes.

### Removed

- `embedBuilders.ts` (all five builders unused since v3.14.1), the unused
  `withErrorHandling` wrapper, `createRoleSelectCollector`,
  `clearXPConfigCache`, `clearRaidModeManager`, `verifyGuildExists`,
  `getSystemChannelTemplates`/`hasChannelCapacity`, `getSystemInfo`,
  `cleanupExpiredIdempotencyKeys` (logCleanup already owns that sweep), and a
  backwards-compat re-export nothing imported.

### Changed

- Starboard's hand-rolled config cache now uses the shared `createTtlCache`
  (the one v3.7.0 outlier), and setup's old-message cleanup delegates to the
  verified-deletion helper instead of reimplementing it.
- Four stale `as any` casts dropped now that discord.js types the fields
  involved, and two outdated workaround comments corrected.

## [3.14.7] - 2026-07-06

Constants dedup — every magic number the audit confirmed as a drifted or
duplicated copy now reads from the single catalog in `constants.ts`.

### Fixed

- **AutoMod keyword limit corrected**: the constants catalog said 100 keywords
  per rule while the feature (correctly) enforced Discord's 1000 — the two
  copies are now one, with the right value.
- **Data-export join-event window** now matches the actual 7-day retention
  sweep instead of a hardcoded 90 days whose comment claimed a retention that
  didn't exist.
- **Event templates** get their own 25-cap constant instead of borrowing the
  announcement one.

### Changed

- Bait-channel idempotency TTL defined once (executor exports it), analytics
  retention/interval and the XP config-cache TTL read the catalog, collector
  timeouts (30s/60s/5min) use the TIMEOUTS catalog across nine handlers,
  health-monitor intervals use INTERVALS, and bait log-embed truncation uses
  the shared `truncateWithNotice` helper.

## [3.14.6] - 2026-07-06

Internal cleanup: the unification helpers introduced in v3.11–v3.13 now cover
the call sites that had been left behind. No user-facing behavior changes
beyond two small consistency wins.

### Changed

- Application workflow enable/disable, the memory-setup channel picker, and
  the AutoMod restore confirmation now use the shared toggle/select/confirm
  helpers (the confirm helper learned to work after a deferred reply).
- Remaining hand-rolled `<t:…>` timestamp conversions and error-log blocks
  migrated to the shared `toUnixSeconds`/`logHandlerError` utilities; two
  handlers dropped the deprecated `fetchReply()` roundtrip for `withResponse`.

### Fixed

- The ticket-type and announcement-template list dashboards now always surface
  an error message when a button action fails mid-collector (the old guard
  skipped feedback if the interaction had already been acknowledged), and the
  import command no longer double-logs every failure.

## [3.14.5] - 2026-07-06

Permission-guard and API-validation consistency.

### Changed

- **`/ticket-setup` and `/memory-setup` now honor webapp permissions**: both
  used the legacy admin-only guard even though their features are in the
  permission catalog — a webapp-granted tickets/memory manager couldn't run
  them. Behavior for guilds without permission overrides is unchanged
  (admin-only fallback).
- **`/dev` archive-deletion commands** (bulk-close tickets, delete archived
  tickets/applications) moved to feature-scoped `admin`-level guards, so the
  webapp permission UI governs them like every other destructive action.

### Fixed

- **Internal API validation**: the announcement send route validated its
  `params` object instead of blind-casting it (a non-object now returns 400),
  and reaction-role `mode` is checked against `normal`/`unique`/`lock` — a
  garbage mode used to be persisted verbatim and then silently never match at
  reaction time. New `optionalRecord`/`optionalEnum` helpers with tests.
- **Bait-channel pending-ban cleanup is always guild-scoped**: the delete
  criteria's guild filter was optional; it's now required (data-isolation
  invariant).

## [3.14.4] - 2026-07-06

Documentation catch-up — no code changes.

### Changed

- CLAUDE.md and README brought back in line with reality: current test runner
  (`bun test`, not Jest), TypeScript 6, per-locale language files, the full
  environment-variable list, all 15 internal API handler groups, corrected
  directory trees (`logger.ts` → `time.ts`, `featurePermission` under
  `validation/`, `utils/application/` added), and the real `baitchannel`
  subcommand-group count.

## [3.14.3] - 2026-07-05

Autocomplete that never worked, now wired.

### Fixed

- **/automod autocomplete works**: all eight rule-picker options (rule
  edit/delete, keyword add/remove, regex add/remove, exempt add/remove)
  declared autocomplete but the handler was never registered — the dropdown
  silently never responded. It now suggests the guild's AutoMod rules by name.
- **/event autocomplete works** (broken since v3.0.0): template names now
  autocomplete on `from-template`, `recurring`, and `template edit/delete`,
  and `cancel`/`remind` suggest the server's live scheduled events by name.
- **/automod template choices** are now derived from the template catalog
  instead of a hand-synced list, so new templates appear automatically.

## [3.14.2] - 2026-07-05

Archive close-path bugs from the audit deep-dive.

### Fixed

- **Forum tags accumulate again**: applying archive tags used to REPLACE a
  thread's tags, wiping anything a moderator had added by hand. Tags now merge
  with what's live on the thread, and when the 5-tag Discord cap drops one,
  it's logged instead of vanishing silently.
- **Dashboard close/archive can't strand tickets**: an unexpected error inside
  the close workflow now reverts the ticket/application status (channel
  preserved for retry) instead of leaving it marked closed with a live channel
  — the API paths now match what the Discord close button already did.
- **Double-close race fixed** in all four close paths (ticket + application,
  Discord button + dashboard API): two near-simultaneous closes could both
  pass the "already closed" guard. The status flip is now atomic (shared
  `claimClose` helper) — the loser is told it's already closed instead of both
  archiving. Reverts after a failed close are conditional too (`releaseClose`),
  so they can't clobber a status a concurrent request wrote in between, and
  approve/deny can no longer overwrite `closed` mid-archive.
- **Dropped forum tags stay retryable**: when the 5-tag cap keeps an archive
  tag off the thread, it's no longer recorded as applied — the next re-close
  tries again instead of skipping it forever.

## [3.14.1] - 2026-07-04

No interaction left hanging: errors that happen after the bot has already
replied or deferred now always reach the user instead of leaving a frozen
"thinking" state.

### Fixed

- **Global command error net** used a bare reply that failed whenever the
  crashing command had already deferred/replied — exactly the case it exists
  for. It now picks reply/edit/follow-up based on interaction state.
- **No false failure messages either**: an announcement whose bookkeeping
  fails *after* it posted no longer tells the operator "Failed to send"
  (which invited a duplicate, double-pinging re-send), and an application
  that breaks after "submitted!" now says so — instead of "please try again",
  which caused duplicate applications.
- **Field-editor buttons/menus/modals** (ticket types + application positions)
  that hit an error used to swallow it entirely; they now show the standard
  error message with a bug-report link.
- **Announcement send**: a failure after you click Send in the preview (e.g.
  the bot can't post in the target channel) is now reported instead of
  freezing the preview. The error log also captures the actual stack again.
- **Application submit**: failures after the "submitted!" confirmation (e.g.
  the welcome message couldn't be posted) are now surfaced to the applicant.
- **/bot-setup**: errors after the dashboard is shown are now reported, and a
  system-configure flow that fails mid-way tells you instead of silently
  redrawing the dashboard. Setup-thread pin failures are logged, not ignored.
- **Context menus**: same fix as the global net — errors after a reply/defer
  no longer disappear.
- **Confirm dialogs** that time out now say "Operation timed out" like every
  other helper, instead of silently removing the buttons.
- **Reaction handlers** (reaction roles, rules, starboard) no longer silently
  swallow partial-fetch failures — they log at debug level via a shared
  `fetchPartial` helper.

## [3.14.0] - 2026-07-03

Archive transcripts got a full readability overhaul — and attachments now
survive forever.

### Added

- **Attachments are re-uploaded into the archive thread.** Pictures and videos
  render inline and stay viewable after the ticket channel is deleted — the old
  behavior linked to Discord CDN URLs, which expire. Files ride directly under
  the message they belong to, batched so no single post exceeds the upload
  budget; a batch Discord still rejects is rescued file-by-file, and only a
  file that can't upload at all falls back to its link. Anything over 10 MB
  (or a failed/stalled download — 30s timeout) links instead of uploading.
- **Transcript chrome can't be spoofed**: user lines that mimic the archive's
  author lines or day dividers are neutralized with an invisible zero-width
  space, so nobody can fabricate a staff message in the moderation archive.
  Attachment/sticker names and poll questions are escaped so they can't break
  the transcript markup.

### Changed

- **Archive forum posts are now chat-style** (ticket + application closes):
  a colored embed header card (opened / closed / duration / type / creator /
  assignee / message count), day dividers, short time-only timestamps,
  consecutive messages from one author grouped under a single name line, and
  plain message bodies — only foreign-bot embeds stay blockquoted. Transcripts
  read like the conversation they archive.
- **Author lines carry role badges**: 👤 the ticket opener, 🛡️ the assignee,
  🤖 bots — you can tell who's who at a glance.
- **Replies show context**: `↳ to staff_bob: "which rank did you buy…"`
  instead of just naming the author.
- **Re-closes** into an existing archive thread are now separated by a fresh
  header card instead of a thin line, so multiple tickets in one thread are
  easy to tell apart.

### Fixed

- Application archive headers no longer render as "🎫 Ticket: Application:
  name" — applications get their own 📋 card.
- **Silent transcript loss on re-close**: an archive row with a missing
  thread reference matched neither the create nor the append branch — the
  ticket channel was deleted while the transcript was never posted anywhere.
  Those rows now recreate the archive thread instead.
- Email-import archive threads with very long sender names no longer fail to
  create (thread names are clamped to Discord's 100-char limit); very long
  email subjects no longer break the header card (256-char embed-title clamp).

## [3.13.2] - 2026-06-26

Close-flow follow-ups + a release-notes drift guard.

### Fixed

- **Admin Only button** no longer leaves the ticket stuck on "Changing to Admin
  Only…", and no longer pings a literal "undefined" when no global staff role is
  set. A missing ticket now surfaces an error, staff-role view removal is awaited
  (it was fire-and-forget), and the acknowledgement resolves to a clear success
  or request-sent message.
- **Close flows** (ticket + application) now tell the user when the transcript
  was archived but the channel couldn't be deleted (e.g. missing Manage
  Channels), instead of sitting on "Closing…" forever.
- **Setup** now warns when a ticket/application creation channel is configured
  without an archive forum — the exact misconfiguration that makes the Close
  button fail.

### Added

- CI **changelog drift gate** (`bun run check:changelog`): fails the build when
  `package.json`'s version doesn't match the top `CHANGELOG.md` entry, so a
  version bump can never ship stale Discord release notes again.

## [3.13.1] - 2026-06-25

### Fixed

- **Ticket & application Close button no longer hangs.** After confirming a
  close, three early-return guards (no archive config / no ticket / already
  closed) returned silently, freezing the "Closing ticket…" message forever and
  never closing the ticket. They now surface feedback; an unexpected error during
  archiving reverts the status instead of stranding the ticket as `closed` with a
  live channel. Added a router-level safety net so any post-acknowledgement throw
  in any button/select/modal handler becomes a visible error rather than a
  permanent hang.

## [3.13.0] - 2026-06-21

Bot→dashboard contract unification (Phase 1 — contract backbone).

### Added

- `scripts/generateContract.ts` + committed `contract/cogworks-contract.json` —
  the single source of truth the dashboard + ninsys-api codegen their types
  from, derived from real bot code: registered command JSON, the `FEATURES`
  permission catalog, and the `applyFields` config-field descriptors
  (bait-channel today; more as handlers adopt descriptors). `bun run build:contract`.
- CI **contract drift gate** (`bun run check:contract`): regenerates and fails on
  any diff, so a bot change not reflected in the contract breaks the build. +4 tests.

### Changed

- The bait config PATCH descriptor now validates `actionType` as an `enum`
  (`ban`/`kick`/`timeout`/`log-only`) instead of a free string — closing the
  Phase 0 enum fix at the bot's API boundary and letting the contract carry the
  allowed values.

## [3.12.0] - 2026-06-21

New shared interaction primitive (unification — select-menu helper).

### Added

- `awaitSelectMenuChoice(interaction, response, { userId, customId, timeout? })`
  (`utils/interactions/selectMenuHelper.ts`) — awaits a single string-select
  choice, returning the interaction or `null` on timeout (clearing the menu with
  the standard timeout message). New `TIMEOUTS.SELECT_MENU` (30s). +3 unit tests.

### Changed

- `memory/channelPicker` migrated onto it as proof-of-fit (drops the hand-rolled
  `awaitMessageComponent` + try/catch + hardcoded `30000`). The other ~4
  await-one sites (memorySetup, botSetup/systemFlows, botReset, automod/backup)
  are the documented follow-up; stateful multi-step flows keep the event-based
  collectors in `utils/collectors.ts`.

## [3.11.3] - 2026-06-21

Internal refactor (unification #7 — toggle require-existing mode) — no behavior change.

### Changed

- `createToggleHandler` gains a `requireExisting` mode (+ an `onEnable` pre-save
  seed hook): the config row must already exist, replying a `notConfigured`
  message instead of creating it. Folded the ticket **workflow** and **smart-
  routing** enable/disable handlers onto it — routing's `resetRoundRobin` rides
  `onToggled`, workflow seeds default statuses via `onEnable`. Ticket **SLA**
  stays hand-written (its enable reads command options + formats conditional
  replies — a config-setter, not a pure toggle). +5 unit tests.

## [3.11.2] - 2026-06-21

Internal refactor (unification #5 — archive transcript spine) — no behavior change.

### Added

- `utils/ticket/transcriptPoster.ts` — `postTranscriptToThread(thread, chunks, ctx)`,
  the shared chunk-posting spine of the ticket and application close workflows
  (near-mirror archive paths). Kept out of the pure `transcriptBuilder` so that
  module stays Discord-client-free. +3 unit tests.

### Changed

- `ticket/closeWorkflow` and `application/closeWorkflow` drop their duplicate
  local `sendTranscriptChunks` and call the shared spine (a `label` keeps each
  side's log line). Left hand-written: the divergent archive bodies (ticket tags
  / custom types / email fields vs application) — parametrizing those would be lossy.

## [3.11.1] - 2026-06-21

Internal tidiness (unification Phase A4 — time primitives) — no behavior change.

### Added

- `utils/time.ts` — `sleep(ms)`, `toUnixSeconds(date)`, `nowUnixSeconds()`. +6 unit tests.

### Changed

- Migrated the repeated `Math.floor(date.getTime() / 1000)` unix-seconds
  conversion (12 sites) and the inline `new Promise(r => setTimeout(r, ms))`
  sleep (7 sites — including the local `delay`/`sleep` helpers in `mee6Importer`
  and `apiConnector`) onto the shared primitives. Duration *formatting* is
  intentionally left with its callers (different units/granularity).

## [3.11.0] - 2026-06-20

Internal refactor (unification #7 — toggle handler) — no behavior change.

### Added

- `createToggleHandler({ repo, field, messages, canEnable?, onToggled? })`
  (`utils/interactions/toggleHandler.ts`) — binds the enable/disable spine
  (find-or-create → idempotent check → flip flag → save → side effect → reply)
  to a guild-config flag. Its `onToggled` hook is where the Phase-B cache
  `invalidate*` calls plug in. +7 unit tests.

### Changed

- Migrated the xp, event, and onboarding enable/disable handlers onto it
  (6 handlers, ~40 fewer lines). onboarding keeps its "needs steps" pre-enable
  guard via `canEnable`; xp keeps its `invalidateXPConfigCache` via `onToggled`.
  Left hand-written (not a thin fit): ticket workflow/sla/routing (option reads,
  workflow prechecks, round-robin reset), bait toggle/dmnotify/escalation
  (boolean-param or dispatcher-prefetched config, embed reply), and insights
  (its plain-reply already-enabled path differs from the standard error style).

## [3.10.0] - 2026-06-20

Internal refactor (unification Phase D — builder factories) — no behavior change.

### Added

- `commands/builders/factories.ts` — `createTextChannelOption`,
  `createForumChannelOption`, and `createActionOption` collapse the repeated
  channel-option and `action`-choice scaffolding shared across command builders.
  +7 unit tests.

### Changed

- Migrated 24 channel options (15 GuildText, 9 GuildForum) and 4 `action`
  options onto the factories across 10 builders (starboard, ticketSetup,
  applicationSetup, memorySetup, memory, baitChannel, xpSetup, reactionRole,
  rulesSetup, event). Generated command JSON is byte-identical
  (`commands.map(c => c.toJSON())` verified pre/post), so every registered
  command shape is unchanged.

## [3.9.0] - 2026-06-20

Internal refactor (unification Phase C complete) — no behavior change.

### Added

- `upsertGuildEntity(repo, guildId, opts?)` — find-or-create + apply + save for
  guild-scoped config entities, completing the API config-CRUD helper trio
  (`applyFields`, `getAndValidateEntity`, `upsertGuildEntity`). +4 unit tests,
  live-DB round-trip verified. Migrated 8 clean find-or-create sites
  (bot-setup ticket/application/staff/announcement config saves, rules setup,
  starboard setup) onto it.

## [3.8.0] - 2026-06-20

Internal refactor (unification Phase C, part 1) — no behavior change.

### Added

- `applyFields(entity, body, descriptors)` — descriptor-driven application of
  optional config PATCH fields (bool / int with range / string / nullableString
  / enum), returning the changed-field list for audit. Proven on the
  baitChannel 24-field config PATCH, which collapses ~75 lines of hand-rolled
  field handling to a declarative descriptor list (+7 unit tests).
- `getAndValidateEntity(url, segment, repo, guildId, opts?)` — fetch-or-404 for
  internal-API id routes; migrated 6 sites (ticket close/assign, application
  approve/deny/archive, reaction-role rebuild), preserving each route's
  not-found message and validation order.

## [3.7.0] - 2026-06-20

Internal refactor (unification Phase B complete) — cache unification, no
behavior change.

### Changed

- All six hand-rolled guild-config caches now run on the shared `createTtlCache`
  primitive: feature-permissions, guild locale, reaction-role menus (with the
  derived emoji index folded into one cache entry so it can't go stale),
  XP config, rules config (guild-scoped invalidation), and the bait-channel
  config + keyword caches. Behavior preserved (TTLs, don't-cache-misses,
  per-guild/per-message invalidation); the hot-path caches were verified against
  a live MySQL. Net effect: cache invalidation is now consistent and far harder
  to get wrong when adding new cached config.

## [3.6.3] - 2026-06-20

Internal refactor (unification Phase B kickoff) — no behavior change.

### Added

- `createTtlCache<K,V>` — a generic in-memory TTL cache primitive (get / set /
  getOrLoad / invalidate / invalidateWhere / clear / size) that several
  subsystems will share instead of hand-rolling their own `Map` + TTL logic.
  Migrated the feature-permission cache onto it as the first consumer
  (behavior preserved, including the don't-cache-on-DB-error fallback).

## [3.6.2] - 2026-06-20

Internal refactor (unification A3, cont.) — standardized error replies.

### Changed

- Migrated the remaining command/event handlers onto `replyEphemeralError`
  (~357 sites across ~80 files, −867 net lines). Ephemeral error messages are
  now consistently prefixed with the ❌ emoji and route reply/editReply/followUp
  automatically. Bare-string error replies that previously showed no emoji now
  show ❌ (intentional normalization); success/info replies are unchanged.

## [3.6.1] - 2026-06-20

Internal refactor (no behavior change) — first step of the codebase
unification effort.

### Changed

- Added a `replyEphemeralError(interaction, message, opts?)` helper that
  standardizes ephemeral error replies (auto-routing reply / editReply /
  followUp by interaction state). Migrated the memory command handlers onto it
  (64 sites, −112 lines, identical output). More features will follow
  incrementally.

## [3.6.0] - 2026-06-20

### Added

- **Interactive announcement template manager.** `/announcement template list`
  now opens a browsable view — pick a template from the menu to preview, edit
  (pre-filled modal), or delete it, all in one place, mirroring the
  `/ticket type list` experience. Default templates are protected from deletion.
- **Templates are editable from the dashboard too** (via the v3.4.0 update
  endpoint), so the template system is fully manageable from both Discord and
  the web app.

## [3.5.1] - 2026-06-20

Post-upgrade cleanups (no behavior change).

### Fixed

- **Removed redundant `@Index(['guildId'])`** from config entities that already
  mark `guildId` unique — this was causing `migration:generate` to emit a no-op
  index drop/re-add under TypeORM 1.0. `migration:generate` now reports no
  changes.
- **Memory `update-tags` now accumulates forum tags** instead of replacing them
  — manually-added thread tags are preserved when re-tagging.
- **Archive cleanup uses the verified thread-delete helper** so failures are
  logged rather than silently swallowed.

### Changed

- Removed dead legacy announcement language strings left over after the
  template consolidation (all locales).

## [3.5.0] - 2026-06-20

Dependency modernization — major runtime and tooling upgrades, validated
against a live MySQL and a real gateway connection.

### Changed

- **Dependencies updated:** discord.js 14.26.4, TypeScript 6.0, TypeORM 1.0,
  Bun 1.3.14 (Docker + CI), mysql2 3.22.5, Biome 2.5.0, dotenv 17. The
  `@discordjs/ws` Bun-compatibility patch carries forward unchanged (still
  resolves to 1.2.3).

### Fixed

- **TypeORM 1.0 migration:** converted string-form `relations`/`select` find
  options to the object form, and gave string-union entity columns (ticket and
  application status, bait action type, event entity type) explicit column
  types — TypeORM 1.0 validates these strictly. No data migration: the columns
  already stored strings.
- Quieted dotenv 17's new startup injection log; applied Biome 2.5.0's
  optional-chaining cleanups.

## [3.4.0] - 2026-06-20

Announcement module overhaul (timezone picker, template consolidation,
dashboard editing) plus reliability fixes — including the changelog post itself
no longer cutting bullets off.

### Fixed

- **Changelog posts no longer truncate.** The deploy workflow dropped wrapped
  continuation lines, cutting each bullet to its first line; bullets now reflow
  in full.
- **Scheduled-announcement times are correct.** The time input was parsed as
  UTC while the label said "Central Time". You now pick the timezone
  (DST-aware); display stays per-viewer via Discord timestamps.
- **`{channel}` placeholder renders on the modal send path** (was showing the
  literal `{channel}`).
- **SLA breach alerts no longer silently lost.** A breach was marked "notified"
  before sending, so with no breach channel set nothing was delivered or
  retried; it now marks notified only after a successful send.
- **Reaction-role API validates options** (rejects bad role IDs / empty emoji
  and cleans up the message on a failed reaction instead of orphaning it).

### Added

- **Timezone picker on `/announcement send`** (UTC, US, and major international
  zones; DST-aware).
- **Internal API `POST /announcements/templates/update`** so the dashboard can
  edit templates (Discord `/announcement template edit` already existed).

### Changed

- **Legacy announcement subcommands consolidated into templates** — send
  maintenance/back-online/update via `/announcement send`.
- **Removed the redundant embed footer timestamp** (Discord already shows the
  sent time; scheduled times render per-viewer).

## [3.3.0] - 2026-06-19

Critical stability fixes (a production crash loop and silently-empty ticket
submissions) plus per-guild module-gated command visibility.

### Fixed

- **Bot no longer crash-loops on a Bun gateway hiccup.** `@discordjs/ws`'s
  `onError` ran `"code" in error`; under Bun a non-object WebSocket error made
  the `in` operator throw a `TypeError`, which surfaced as an uncaught exception
  and tripped the fail-fast shutdown → Docker restart → repeat. The dependency
  is now patched (`bun patch`) to guard the check, a narrow `uncaughtException`
  safety net logs-and-recovers for that exact signature instead of shutting
  down, and `client` `error`/`shardError` listeners were added for gateway
  hygiene.
- **Ticket submissions no longer post empty.** The assembled answers were sent
  as a single message; when they exceeded Discord's 2000-char limit the send
  threw *after* the channel + welcome message were created, so the ticket
  opened with no answers (looking like a blank submission) and the real error
  was masked by a second `reply()`. Answers are now chunked (every message
  `<= 2000` chars, nothing dropped) and the catch uses `followUp` when the
  interaction was already replied to.

### Added

- **Per-guild module-gated command visibility.** A module's slash and
  context-menu commands are now hidden in guilds where the module is disabled
  (e.g. `/rank` no longer appears when XP is off). Commands register per-guild
  filtered by each guild's enabled modules, and re-register (debounced) when a
  module is toggled via slash setup, the `/bot-setup` dashboard, or the webapp.
  Gated modules: tickets, applications, announcements, memory, xp, baitchannel
  — each kept with an always-visible re-enable path so an admin is never
  stranded.

### Changed

- Re-running bait-channel setup via `/bot-setup` now re-enables a previously
  disabled bait config, so the gated `/baitchannel` command is always
  recoverable from within Discord.

## [3.2.2] - 2026-06-03

Internal consolidation (no behavior change beyond one latent-bug fix).

### Added

- `writeAuditAction(guildId, body, action, details?)` — folds the repeated
  `triggeredBy`-extraction + `writeAuditLog` call in the dashboard API handlers
  (16 uniform sites migrated; non-uniform sites left as-is).
- `extractModalField(fields, customId)` in `utils/interactions` — the shared,
  field-type-tolerant modal reader (handles both text-input `.value` and select
  `.values[]`), promoted from a botSetup-local helper and exported from the barrel.

### Fixed

- Modal select-field reads (announcement role/channel selects) that used the
  inline `fields.getField(id)?.value` pattern silently returned `undefined` for
  select components; migrated to `extractModalField`, which reads `.values[]`.

## [3.2.1] - 2026-06-03

Archive carbon-copy fidelity + close-workflow robustness. Archived ticket and
application transcripts are now an exact copy of the conversation — the prior
builder silently truncated any message over 500 characters.

### Fixed

- **Transcripts no longer truncate (data loss).** `transcriptBuilder` removed
  the 500-char per-message truncation; a message larger than a single Discord
  post is now SPLIT across chunks on line boundaries (with code-fence balancing),
  and every emitted chunk is guaranteed `<= 2000` chars. Fixes both ticket and
  application archives (shared builder).
- **Archive failure no longer deletes the conversation.** When a forum post
  fails, the source channel is now PRESERVED instead of deleted, and the close
  is reverted (ticket/application status restored) so it can be retried — the
  previous behavior deleted the only remaining copy of the conversation.
- **Re-close into a deleted archive thread recovers.** Re-closing when the
  archive thread was deleted (Discord `10003`) now recreates the thread and
  repoints the archive record instead of silently failing; non-`10003` errors
  still surface (and preserve the channel).
- **Ticket assignment is now persisted.** `POST /tickets/:id/assign` writes
  `assignedTo` + `assignedAt` — previously it only set a channel permission
  overwrite, so the dashboard and close transcript showed the ticket unassigned.

### Added

- Transcripts now capture **stickers, polls** (question + per-answer vote
  counts), and **embed media** (image/thumbnail/footer/author/linked title) —
  sticker-only and poll-only messages are no longer dropped.
- Per-chunk failure logging on transcript posts (a partial-archive failure is
  now attributable to its chunk index).

## [3.2.0] - 2026-05-17

Major refinement of the bait channel (honeypot) subsystem. Closes ~22
edge-case gaps audited against the prior implementation, replaces the
`member.ban()` / `member.kick()` path with REST-based + idempotent
execution, and ships industry-standard moderation patterns
(`auditLogEntryCreate` attribution, REST ban-by-id, HMAC-signed
appeal links, cross-channel content-burst detection, sticky raid-mode
lockdown).

### BREAKING

- **New env var `APPEAL_HMAC_SECRET`** — required only when any guild
  has `BaitChannelConfig.enableAppealLink=true`. Generate via
  `node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))'`.
  Bot still starts without it; signed appeal URLs are silently
  omitted from DMs (static `appealInfo` text still shows).

### Added

- **REST ban executor** (`utils/baitChannel/banExecutor.ts`): every
  moderation action (ban / softban / kick / timeout / log-only) goes
  through `executeBanAction(opts, idempotencyRepo)`. Three guarantees
  the old path couldn't provide:
  - Leave-tolerant: `guild.bans.create(userId)` works after the user
    has left and `GuildMember` partial is gone.
  - Idempotent: `(guildId, userId, action, dayBucket)` UNIQUE row
    prevents double-execution across mod-vs-bot race + retry queue.
  - Audit-reason-aware: structured `cogworks:bait score=N ch=#X
    flags=[…] msgId=…` reason in Discord audit log.
- **RetryQueue** (`utils/baitChannel/retryQueue.ts`): re-uses
  `pending_actions` table. Backoff 5s → 30s → 5min → dead-letter (3
  attempts). Tick interval 15s. Also sweeps orphaned grace-period rows
  after bot restart.
- **`auditLogEntryCreate` listener** (`events/auditLogEntryCreate.ts`):
  real-time attribution via Discord's audit-log gateway event. Bot-self
  confirms BaitChannelLog rows with `discordAuditLogId` +
  `actionConfirmedAt`; mod-supersedes-us cancels pending actions and
  writes idempotency keys. Required new intent
  `GatewayIntentBits.GuildModeration`.
- **Leave-tolerant lifecycle**: `guildMemberRemove` drains pending
  bait actions for the leaving user via REST executor. `timeout` rows
  demote to `softban` when the member is gone.
- **Raid Mode** (`utils/baitChannel/raidModeManager.ts`): sticky
  guild-wide lockdown when N bait actions stack within M seconds.
  Channel-level `@everyone SendMessages: false` on non-staff channels,
  mod-alert embed with up to 10 offender mentions + alert role ping.
  4h auto-release cap + manual `/baitchannel raid release`.
- **New slash subcommand group `/baitchannel raid`**: `status`,
  `enter [reason]`, `release`. Admin-only for destructive subcommands.
- **Cross-channel content-burst detector**
  (`utils/baitChannel/contentBurstDetector.ts`): catches same content
  posted in N distinct channels within M seconds. +30 score boost +
  `crossChannelBurst` flag in detection flags JSON. Normalizes mentions
  / case / whitespace before hashing.
- **HMAC-signed appeal tokens** (`utils/baitChannel/appealToken.ts`):
  pre-ban DMs can embed a one-shot signed appeal link. Webapp consumer
  in v3.2.1 verifies the token and auto-opens a `banAppeal` ticket.
- **DM proof-of-delivery**: `sendDmNotification` returns `DmResult` with
  `failureReason` (closed / no_shared_guild / timeout / unknown). 5s
  timeout race prevents the action path from hanging on doomed DMs.
- **Log channel fallback**: when the configured log channel is gone or
  unreachable, owner-DM fallback ensures the action doesn't go
  silently unrecorded. `BaitChannelLog.logDeliveryFailed` flagged.
- **Retention**: daily cleanup tick now sweeps `idempotency_keys`
  (expiresAt) and dead-lettered `pending_actions` (30d after deadAt).
  Per-guild `BaitChannelConfig.logRetentionDays` (default 90, 30-365).
- **Internal API endpoints**:
  - `GET/PATCH /bait-channel/config` (closes the config CRUD gap).
  - `GET /bait-channel/raid-mode/status`, `POST /raid-mode/{enter,release}`.
  - `GET /bait-channel/pending-actions?status=…`, `POST .../cancel`.
  - `GET /bait-channel/logs?days=&action=&userId=&overridden=`.
  - New `optionalBoolean` API helper.

### Schema

- Migration `1774000011000-BaitChannelV3Schema`:
  - Rename `pending_bans` → `pending_actions` + new columns
    (`action`, `attempts`, `lastError`, `deadAt`).
  - New table `idempotency_keys` (UNIQUE(guildId, userId, action,
    dayBucket), TTL via expiresAt).
  - `bait_channel_logs` + 8 new columns: `discordAuditLogId`,
    `executorId`, `actionConfirmedAt`, `unbannedAt`, `unbannedBy`,
    `dmSent`, `dmFailureReason`, `logDeliveryFailed`.
  - `bait_channel_configs` + 10 new columns: raid mode (5),
    cross-channel burst (2), appeal link (2), `logRetentionDays`.

### Tests

- +32 unit tests (1171 → 1203) across 4 new files: auditReason,
  appealToken, contentBurstDetector, banExecutor.

### Internal

- `BaitChannelManager.executeAction` switch block (~140 LOC of
  `member.X()` branches) collapsed into a single `executeBanAction`
  call + result-mapping block. Telemetry / per-action log lines
  preserved.
- `BaitChannelLog.actionTaken` gains new values: `'superseded'`,
  `'queued'`, `'superseded-by-mod'`, `'raid-mode-entered'`,
  `'raid-mode-released'`. Existing values unchanged.
- Schema entity rename `PendingBan` → `PendingAction` across 6
  importers (manager, index, dataExport, devSuiteScaffold,
  guildQueries, tests).
## [3.1.42] - 2026-05-31

### Fixed

- **Ticket/application archives could pull the wrong user's thread.** Ticket
  archives are grouped per user — by `createdBy` for normal tickets, by
  `emailSender` for email-import tickets. But an email-import ticket's
  `createdBy` is the importing admin, not the player, so a normal ticket the
  admin opened could match (and append into) an email-import archive that shared
  their `createdBy`. `findExistingArchive` now scopes each lookup to its own
  namespace via the `isEmailTicket` discriminator, so email-import and normal
  archives can never cross-contaminate. (`src/utils/ticket/closeWorkflow.ts`)
- **Archived transcripts no longer ping anyone.** Every forum post in the ticket
  and application archive paths now sends with `allowedMentions: { parse: [] }`,
  and message content is captured via `cleanContent` (mentions render as
  readable `@name`/`#name` text, not raw `<@id>` mention syntax). Historical
  transcript content can never notify users/roles or fire `@everyone`/`@here`.
  (`closeWorkflow.ts` × 2, `fetchAllMessages.ts`)

## [3.1.41] - 2026-05-05

Two prod-bug fixes from 2026-05-04/05 incident logs.

### Fixed
- **Bait channel**: `logAction` no longer crashes with `TypeError: null is not an object (evaluating 'member.id')` when called after a successful ban/kick or after the user deleted their own message during a parallel grace period. Discord.js drops `message.member` to null in those cases; the helper now takes a `GuildMember` ref from the caller (already in scope at every call site) instead of re-deriving from a stale `message.member`. Also defensively coalesces `member.joinedTimestamp ?? Date.now()`.
- **Bait channel**: `MESSAGE_REFERENCE_UNKNOWN_MESSAGE` from `message.reply()` (when the user deletes their bait message before the warning reply lands) is now logged at debug instead of MEDIUM-severity error. That's the user complying with the warning — no need to spam the error webhook.
- **Ticket creation**: 18+ verification (and the 4 other builtin types) now show the modal built from the seeded `CustomTicketType` row's `customFields` instead of the hardcoded builtin modal. The submit handler already preferred the custom row via `resolveTicketType()`, but the show path short-circuited on `isBuiltinTicketType()` — producing tickets with just a heading and the user's input silently dropped (prod 2026-05-05, ticket #112 — the user's date of birth in 18+ verify never made it into the ticket message).
- **Ticket creation**: silent `catch {}` around `fields.getTextInputValue(field.id)` upgraded to `enhancedLogger.warn` with field id + ticket type, so any future field-id mismatch is loud, not invisible.

## [3.1.40] - 2026-05-01

Unify ticket-type management UX.

### Added
- Activate/Deactivate button in the post-`/ticket type add` confirmation, alongside the existing Enable Staff Ping toggle.

### Changed
- `/ticket type edit type:foo` jumps to the detail view (same as picking the type from `/ticket type list`'s dropdown) instead of opening the modal directly. Click Edit there to open the modal.

### Removed
- Close button on the `/ticket type list` interactive view — the 5-min collector timeout and Discord's Dismiss already handle this.

## [3.1.39] - 2026-05-01

### Fixed
- `showAndAwaitModal` could resolve on a different modal — opening one modal, dismissing it, then submitting another caused the original handler to fire on the wrong submission. Now filtered by customId. Process-wide fix; affects every caller.
- `/ticket type list` detail view no longer says "updated successfully" when just viewing.
- `❓` placeholder for emoji-less types in the list summary replaced with no prefix.
- Activate/Deactivate button emojis swapped from `🔴`/`🟢` (matched the button color and were hard to read) to `🚫`/`✅`.

### Added
- Hint text in the list summary moved from grey footer to embed description.

## [3.1.38] - 2026-04-30

### Changed
- `/ticket type list` is now an interactive view. Pick a type from a dropdown to see its details; Activate/Deactivate, Set as Default, and Edit buttons are right there. Replaces the static fields-per-type embed.

## [3.1.37] - 2026-04-30

### Fixed
- Language button on `/bot-setup` crashed with `BASE_TYPE_BAD_LENGTH` (modal description was 105 chars; Discord's cap is 100).
- "Post as Announcement" and "Close Application" message-context-menu commands had no router handler; removed.
- "Capture to Memory" and "Manage Restrictions" context menus now error gracefully when the system isn't configured for the guild.

### Changed
- `/ticket type edit` modal now uses Discord's new modal format with a Ping-Staff-on-Create checkbox, replacing the post-submit toggle button on that path. (`/ticket type add` kept its post-submit toggle; see 3.1.40 for the consolidation.)

## [3.1.36] - 2026-04-30

### Added
- Test coverage for the `channelDelete` / `messageDelete` / `roleDelete` event handlers introduced in 3.1.32. (+33 tests; 1134 → 1167.)

## [3.1.35] - 2026-04-30

### Changed
- `legacy*` ticket type identifiers renamed to `builtin*` across the codebase. Code-internal rename only — stored type IDs are unchanged, no migration required.
- Jest dropped; Bun is now the only test runner. Test files migrated from `@jest/globals` to `bun:test`.

## [3.1.34] - 2026-04-30

Internal refactor pass. No behavior change.

- `messageCleanup` (offboarding) split into 5 phase helpers.
- Default ticket-type seeds hoisted out of `ensureDefaultTicketTypes` into a module-top constant.
- Announcement `previewAndSend` now uses `awaitConfirmation` instead of a hand-rolled button collector.
- `sendOnboardingFlow` split into 4 phases.

## [3.1.33] - 2026-04-29

Internal refactor pass. No behavior change.

- Autocomplete dispatch: switch statement → `AUTOCOMPLETE_ROUTES` lookup table.
- New `createFieldHandlers<T>(config)` factory shared by `typeFields` and `applicationFields`.
- `detectSystemStates` extracted to `utils/setup/systemStates.ts` — slash-command setup dashboard and webapp setup API now share one implementation.
- Top-level interaction router collapsed from inline prefix-matching to a dispatch loop over `FEATURE_DISPATCHERS`.

## [3.1.32] - 2026-04-29

Internal refactor pass. No behavior change.

- Delete event handlers (`channelDelete`, `messageDelete`, `roleDelete`) refactored to descriptor arrays. Failure attribution now comes from each cleaner's `name` field instead of a parallel array.
- New `logHandlerError(scope, error, ctx)` wrapper for the post-`deferReply` log shape; 13 memory handler catch blocks swept onto it.

## [3.1.31] - 2026-04-29

Internal refactor pass. No behavior change.

- `getXPConfig` moved from `commands/handlers/xp/setup.ts` to a new `utils/xp/configCache.ts`. Removes the events → commands/handlers cross-module coupling.
- `RoutingRule` and `RoutingStrategy` types moved from `utils/ticket/smartRouter` to a new `entities/ticket/routingTypes.ts`. The entity (data shape) no longer depends on the runtime helper. Old import paths still resolve via re-export.
- Layering rule documented in CLAUDE.md.

## [3.1.30] - 2026-04-29

Internal refactor pass. No behavior change.

- New `ReactionRoleMode` type alias (`'normal' | 'unique' | 'lock'`) in `entities/reactionRole/ReactionRoleMenu.ts`. Replaces the inline literal at 4 sites.
- New `RawModal` interface in `utils/modalComponents.ts` for typing `rawModal()` returns.
- `guildWebhook.ts` no longer snapshots `process.env.API_URL` at module load — uses lazy getters.
- Long-standing `Function`-type biome warning in `lazyRepo.ts` eliminated; the linter is now warning-free.

## [3.1.29] - 2026-04-29

### Fixed
- `pingToggleButton` (the staff-ping toggle on the ticket-type confirmation embed) now requires `tickets:manage` permission. Non-admins who could see the button could previously click it; this was always intended to be admin-only.

### Changed
- `application` command tree migrated from `guardAdmin` to feature-scoped `guardFeatureAccess('applications', ...)`. Includes new `'applications'` entry in the FEATURES catalog.
- New `guardOwner()` wrapper mirroring `guardAdmin`'s shape; replaces the boilerplate around `requireBotOwner` at 13 status/dev call sites.
- Four context menus (`captureToMemory`, `manageRestrictions`, `openTicketForUser`, `viewBaitScore`) now use feature-scoped guards.
- Raw `requireAdmin` swept onto `guardAdmin()` at 8 remaining sites in migrate / dev.

## [3.1.28] - 2026-04-27

Feature-permission migration: tickets — twelfth (final) feature commit. **Migration complete.** All 28 guard call sites across 13 ticket handler files migrated.

### Changed

- **`ticket/settings.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/emailImport.ts`** (2 sites — `emailImportHandler`, `emailImportModalHandler`) → `guardFeatureRateLimit('tickets', 'manage', ...)`. Rate-limit preserved.
- **`ticket/routing.ts`** (6 sites — `routingEnableHandler`, `routingDisableHandler`, `routingRuleAddHandler`, `routingRuleRemoveHandler`, `routingStrategyHandler`, `routingStatsHandler`) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/typeAdd.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/sla.ts`** (4 sites — `slaEnableHandler`, `slaDisableHandler`, `slaPerTypeHandler`, `slaStatsHandler`) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/typeEdit.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/typeDefault.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/typeList.ts`** (1 site) → `guardFeatureAccess('tickets', 'use')` — read-only.
- **`ticket/typeToggle.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/typeFields.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/typeRemove.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/userRestrict.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/workflowSettings.ts`** (1 site) → `guardFeatureAccess('tickets', 'manage')`.
- **`ticket/workflow.ts`** (6 sites — status/assign/unassign/info/workflow-add-status/workflow-remove-status handlers) → `guardFeatureAccess('tickets', 'manage')`.

### Notes

- 27 of 28 sites use `'manage'`; only `typeList` (read-only) uses `'use'`.
- Per-ticket close is mutating but per-item — `'manage'` fits. Bulk operations like `/bot-reset` stay on `guardAdmin` (meta-feature, not in the catalog per the handoff).
- Tests 1133 → 1133. Build + biome clean.
- **Migration complete** — 12 of 12 features done, 80+ guard call sites total. Webapp permission UI is now load-bearing across the entire feature surface. Desloppify rerun is the natural next step to confirm `authorization_consistency` recovers from the 77.5 baseline.

## [3.1.27] - 2026-04-27

Feature-permission migration: baitchannel — eleventh feature commit. Both guard call sites in `src/commands/handlers/baitChannel/` migrated.

### Changed

- **`baitChannel/index.ts`** — `baitChannelHandler` (5 subcommand groups: setup, detection, escalation, dm, stats) → `guardFeatureRateLimit(interaction, 'baitchannel', 'manage', ...)`. Picked `'manage'` because the dispatcher routes to mostly-mutating subcommands (setup/detection config/escalation/dm). The stats group is technically read-only but bait stats reveal moderation activity that admins should triage.
- **`baitChannel/settings.ts`** — `settingsHandler` → `guardFeatureRateLimit(interaction, 'baitchannel', 'manage', ...)`. Has its own stricter rate limit (BOT_SETUP) on top of the dispatcher.

### Notes

- All other baitChannel handler files (detection/dmNotify/escalation/keywords/override/setup/stats/status/summary/testMode/toggle/whitelist) don't have direct guards — they're reached via the index.ts dispatcher and inherit its check.
- Tests 1133 → 1133. Build + biome clean.
- 1 feature remains: tickets (largest — 5 subcommand groups + interaction handlers).

## [3.1.26] - 2026-04-27

Feature-permission migration: analytics — tenth feature commit. Both guard call sites in `src/commands/handlers/insights/` migrated. Two-tier check: dispatcher at `'use'`, setup leaf at `'manage'`.

### Changed

- **`insights/index.ts`** — `insightsHandler` (dispatcher routing to overview/growth/channels/hours/setup) → `guardFeatureAccess(interaction, 'analytics', 'use')`. Read-only subcommands pass through; the setup subcommand has its own stricter guard. Comment added explaining the design.
- **`insights/setup.ts`** — `insightsSetupHandler` → `guardFeatureAccess(interaction, 'analytics', 'manage')`. Mutating config (enable/disable/channel/frequency/status).

### Notes

- This is the first feature in the migration to use a two-tier check (dispatcher use, leaf manage). Hierarchical levels mean `'manage'` users automatically pass the `'use'` dispatcher check, then the leaf check escalates correctly.
- Tests 1133 → 1133. Build + biome clean.
- 2 features remain: baitchannel, tickets.

## [3.1.25] - 2026-04-27

Feature-permission migration: announcements — ninth feature commit. All 3 guard call sites across `templates.ts`, `handler.ts`, and `setup.ts` migrated.

### Changed

- **`announcement/templates.ts`** — `templateHandler` (template CRUD dispatcher: create/edit/delete/list/preview/reset) → `guardFeatureAccess(interaction, 'announcements', 'manage')`.
- **`announcement/handler.ts`** — `announcementHandler` (`/announcement send` + legacy maintenance/back-online subcommands) → `guardFeatureRateLimit(interaction, 'announcements', 'manage', ...)`.
- **`announcement/setup.ts`** — `announcementSetupHandler` → `guardFeatureRateLimit(interaction, 'announcements', 'manage', ...)`.

### Notes

- All `'manage'` — announcements are mutation-heavy and don't have a meaningful read-only surface (the dispatcher routes to send/setup/template CRUD).
- Tests 1133 → 1133. Build + biome clean.
- 3 features remain: analytics, baitchannel, tickets.

## [3.1.24] - 2026-04-27

Feature-permission migration: reactionroles — eighth feature commit. All 7 guard call sites across 7 reaction-role handler files migrated.

### Changed

- **`src/commands/handlers/reactionRole/{add,create,edit,remove,validate}.ts`** — 5 handlers swap `guardAdminRateLimit` for `guardFeatureRateLimit(interaction, 'reactionroles', 'manage', ...)`. Rate-limit configurations preserved per handler.
- **`src/commands/handlers/reactionRole/delete.ts`** — `reactionRoleDeleteHandler` swaps `guardAdmin` for `guardFeatureAccess(interaction, 'reactionroles', 'manage')`. Per-menu delete is normal CRUD, not GDPR-scoped.
- **`src/commands/handlers/reactionRole/list.ts`** — `reactionRoleListHandler` swaps `guardAdmin` for `guardFeatureAccess(interaction, 'reactionroles', 'use')` — read-only.

### Notes

- 6 handlers use `'manage'`, 1 (`list`) uses `'use'`. `validate` is technically read-only but kept at `'manage'` because it surfaces config issues admins should triage.
- Tests 1133 → 1133. Build + biome clean.
- 4 features remain: announcements, analytics, baitchannel, tickets.

## [3.1.23] - 2026-04-27

Feature-permission migration: events — seventh feature commit. All 7 guard call sites across 4 event handler files migrated.

### Changed

- **`src/commands/handlers/event/template.ts`** — `eventTemplateHandler` (template create/edit/delete/list dispatcher) → `guardFeatureAccess(interaction, 'events', 'manage')`.
- **`src/commands/handlers/event/remind.ts`** — `handleRemind` → `guardFeatureAccess(interaction, 'events', 'manage')`.
- **`src/commands/handlers/event/setup.ts`** — `eventSetupHandler` (enable/disable/reminder-channel/summary-channel/default-reminder) → `guardFeatureRateLimit(interaction, 'events', 'manage', ...)`. Preserves existing rate-limit.
- **`src/commands/handlers/event/create.ts`** — 4 sites (`handleEventCreate`, `handleFromTemplate`, `handleEventCancel`, `handleRecurring`) → `guardFeatureAccess(interaction, 'events', 'manage')`.

### Notes

- All 7 sites use `'manage'` — events are mutation-heavy (create/cancel/template-CRUD/setup/remind), and per-event cancel is per-item (not GDPR-scoped) so `'manage'` fits.
- Tests 1133 → 1133. Build + biome clean.
- 5 features remain: reactionroles, announcements, analytics, baitchannel, tickets.

## [3.1.22] - 2026-04-27

Feature-permission migration: automod — sixth feature commit. Single dispatcher-level guard in `src/commands/handlers/automod/index.ts` migrated.

### Changed

- **`automodHandler`** (subcommand groups: rule, template, backup, keyword, regex, exempt) → `guardFeatureRateLimit(interaction, 'automod', 'manage', ...)`. All groups are mutating operations on automod config; `'manage'` is the right level.

### Notes

- Tests 1133 → 1133. Build + biome clean.
- 6 features remain: events, reactionroles, announcements, analytics, baitchannel, tickets.

## [3.1.21] - 2026-04-27

Feature-permission migration: onboarding — fifth feature commit. Single dispatcher-level guard in `src/commands/handlers/onboarding/index.ts` migrated.

### Changed

- **`onboardingHandler`** (10 subcommands: enable/disable/welcome-message/completion-role/step-add/step-remove/step-list/stats/preview/resend) → `guardFeatureRateLimit(interaction, 'onboarding', 'manage', ...)`. Picked `'manage'` because most subcommands mutate config; the read-only ones (step-list/stats/preview) inherit the same level. Per-subcommand granularity (use vs manage) explicitly noted in a comment as out of scope for this migration commit.

### Notes

- Tests 1133 → 1133. Build + biome clean (only pre-existing `Function` warning in `lazyRepo.ts:29`).
- 7 features remain: automod, events, reactionroles, announcements, analytics, baitchannel, tickets.

## [3.1.20] - 2026-04-27

Feature-permission migration: rules — fourth feature commit. All 3 guard call sites in `src/commands/handlers/rulesSetup.ts` migrated.

### Changed

- **`handleSetup`** (`/rules-setup setup`) → `guardFeatureRateLimit(interaction, 'rules', 'manage', ...)` (preserves the existing rate-limit on rules config setup).
- **`handleView`** (`/rules-setup view`) → `guardFeatureAccess(interaction, 'rules', 'use')` — read-only.
- **`handleRemove`** (`/rules-setup remove`) → `guardFeatureAccess(interaction, 'rules', 'manage')` — config delete is normal CRUD (re-creatable), not GDPR-scoped.

### Notes

- Tests 1133 → 1133. Build + biome clean (only pre-existing `Function` warning in `lazyRepo.ts:29`).
- 8 features remain in the migration queue: onboarding, automod, events, reactionroles, announcements, analytics, baitchannel, tickets.

## [3.1.19] - 2026-04-27

Feature-permission migration: xp — third feature commit. Both guard call sites in `src/commands/handlers/xp/index.ts` migrated from `guardAdmin` to `guardFeatureAccess`.

### Changed

- **`xpSetupCommandHandler`** (`/xp-setup` → setup subcommands) → `guardFeatureAccess(interaction, 'xp', 'manage')`.
- **`xpAdminCommandHandler`** (`/xp` → set / reset / reset-all subcommands) → `guardFeatureAccess(interaction, 'xp', 'admin')`. Picked `'admin'` because the `reset-all` subcommand is GDPR-scoped (wipes all guild XP). Per-subcommand granularity (e.g. `set` at manage, `reset-all` at admin) would require moving the guard into each subcommand handler — explicitly noted in the JSDoc as out of scope for this migration commit.

### Notes

- `rankCommandHandler` and `leaderboardCommandHandler` had no guard (any user can run); left as-is.
- Tests 1133 → 1133. Build + biome clean (only pre-existing `Function` warning in `lazyRepo.ts:29`).
- 9 features remain in the migration queue: rules, onboarding, automod, events, reactionroles, announcements, analytics, baitchannel, tickets.

## [3.1.18] - 2026-04-27

Feature-permission migration: starboard — second feature commit of the v3.1.x feature-permission-migration handoff. All 5 starboard guard call sites now use `guardFeatureAccess(interaction, 'starboard', 'manage')`.

### Changed

- **`src/commands/handlers/starboard/ignore.ts`** — `starboardIgnoreHandler` and `starboardUnignoreHandler` swap `guardAdmin` for `guardFeatureAccess`.
- **`src/commands/handlers/starboard/setup.ts`** — `starboardSetupHandler`, `starboardConfigHandler`, and `starboardToggleHandler` swap `guardAdmin` for `guardFeatureAccess`.

### Notes

- All 5 sites use `'manage'` level — channel ignore-list mutations + per-guild config mutations are normal CRUD.
- `random.ts` and `stats.ts` (read-only commands) had no guard; left as-is.
- Tests 1133 → 1133. Build + biome clean (only pre-existing `Function` warning in `lazyRepo.ts:29`).
- 10 features remain in the migration queue: xp, rules, onboarding, automod, events, reactionroles, announcements, analytics, baitchannel, tickets.

## [3.1.17] - 2026-04-27

Feature-permission migration begins — first commit of the v3.1.x feature-permission-migration handoff. Adds the `guardFeatureRateLimit` helper (Option B from the handoff — combined feature-permission + rate limit guard) and migrates all 9 `/memory` handlers to use it. Webapp permission UI for the `memory` feature is now load-bearing instead of ignored at runtime.

### Added

- **`guardFeatureRateLimit(interaction, feature, level, options)`** in `src/utils/interactions/guardHelper.ts` — drop-in replacement for `guardAdminRateLimit` once a handler has been migrated. Same return shape, same `GuardOptions` (action, limit, scope, skipAdmin). Uses `hasFeatureAccess` internally so unconfigured guilds still fall back to admin-only (preserves legacy behavior).
- Barrel export added to `src/utils/interactions/index.ts` for `guardFeatureAccess` (was missing) and the new `guardFeatureRateLimit`.

### Changed

- **9 memory handlers** migrated from `guardAdminRateLimit` to `guardFeatureRateLimit(interaction, 'memory', 'manage', ...)`: `add.ts`, `capture.ts`, `delete.ts`, `update.ts`, `updateTags.ts`, `updateStatus.ts`, `manageTags.ts`, `tags.ts`. Rate-limit configuration (action key, RateLimits constant, scope) preserved per handler. Level chosen as `'manage'` for all memory operations — they're per-item mutations and the handoff reserves `'admin'` for genuinely destructive or GDPR-scoped operations like `/bot-reset` (single-item delete is normal CRUD).

### Notes

- Tests 1133 → 1133 (no test changes; existing `featurePermission.test.ts` covers the unconfigured-guild fallback).
- Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- 11 features remain in the migration queue: starboard, xp, rules, onboarding, automod, events, reactionroles, announcements, analytics, baitchannel, tickets. Each gets its own commit per the handoff.

## [3.1.16] - 2026-04-26

Fake-timer migration — Commit 6 of the v3.1.9 test-orchestration handoff. Replaces 6 real wall-clock `setTimeout(60)` waits in window-expiry tests with Bun's `setSystemTime()` time-jumps. Suite runtime drops ~50% (1467ms → 745ms on the developer machine) and eliminates the flake risk from real-timer races on slow CI.

### Changed

- **`tests/unit/utils/rateLimiter.test.ts`** — 4 sites migrated. Each `await new Promise(r => setTimeout(r, 60))` becomes `setSystemTime(new Date(Date.now() + 60))`. Each describe block's `afterEach` now (a) calls `setSystemTime()` to reset the fake clock and (b) clears the `rateLimiter.limits` Map directly. The clear is necessary because entries created while time was advanced have `resetTime` values that become "in the future" once the system time is reset, leaking active state into the next test's baseline. Without the clear the previously-flaky-but-passing `expired entries not counted as active` test reproducibly fails (saw `expected 18, received 16` — 2 leftover entries from prior tests).
- **`tests/unit/utils/baitChannel/joinVelocityTracker.test.ts`** — 1 site migrated (`window expiry` test). Test no longer needs to be `async`.
- **`tests/unit/utils/healthMonitor.test.ts`** — 1 site migrated (`should increase uptime over time`). Imports `setSystemTime` from `bun:test` directly (the rest of the file uses `@jest/globals` for compat — both can coexist).

### Notes

- Test count unchanged: 1133. Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- `setSystemTime()` reset semantics in Bun: passing no argument resets to the original system time. Tests that advance time MUST reset in `afterEach` or fakery bleeds across tests.
- v3.1.9 test-orchestration handoff status: Commits 1, 4, 5, 6 done. Remaining: integration tests (3) and the deferred dispatcher rewrite (2).

## [3.1.15] - 2026-04-26

BaitChannelManager behavioral coverage — Commit 4 of the v3.1.9 test-orchestration handoff. Adds 23 tests against the previously-zero-coverage 1652-LOC monster. Targets the pure logic and caching paths the handoff prioritized; the heavier message-pipeline methods (`analyzeSuspicion`, `executeAction`, `initiateGracePeriod`) stay deferred since they touch Discord APIs + cross-module state in ways that need integration-test infrastructure.

### Added

- **`tests/unit/utils/baitChannel/baitChannelManager.test.ts`** (23 tests, no source changes):
  - **`determineAction`** (6 tests) — `enableEscalation: false` always returns `config.actionType`; `enableEscalation: true` walks the timeout (50) / kick (75) / ban (90) thresholds with default and custom values, including boundary checks at each threshold.
  - **`checkWhitelist`** (6 tests) — server owner (highest precedence), `whitelistedUsers` list, `whitelistedRoles` match (with role name in the reason string), administrator default-whitelist, `disableAdminWhitelist` test-mode override, and the "none of the above" fall-through.
  - **`getConfig` caching** (5 tests) — cache miss → fetch + cache, cache hit → skips DB, null DB result is intentionally NOT cached (so subsequent calls re-query), DB error returns null without throwing, `clearConfigCache(guildId)` invalidates only the named guild.
  - **`getKeywords` caching** (5 tests) — same shape as getConfig, plus the no-`keywordRepo` path returns `[]` without throwing.
  - **`setJoinVelocityTracker`** (1 test) — assignment behavior.

### Notes

- BaitChannelManager's constructor is fully DI'd (`client + 5 repos`), so tests instantiate the class directly with fake repos. No `AppDataSource.getRepository` patch needed (unlike the API-handler and closeWorkflow test files).
- Private methods accessed via `(manager as any).method(...)` cast — the alternative would be exposing a `__testing` object on the SUT, which is scope creep this commit avoids.
- Test count: 1110 → 1133 (+23).
- Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- v3.1.9 test-orchestration handoff status: Commits 1, 4, 5 done. Remaining: integration tests (3), fake-timer migration (6), and the deferred dispatcher rewrite (2).

## [3.1.14] - 2026-04-26

API handler behavioral coverage — Commit 5 of the v3.1.9 test-orchestration-layer handoff (Commit 2 deferred — see notes). Adds 33 behavioral tests across the four high-value API handlers the handoff named: ticketHandlers, applicationHandlers, setupHandlers, analyticsHandlers. Reuses the AppDataSource.getRepository runtime patch pattern that v3.1.13 established for closeWorkflow.

### Added

- **`tests/unit/utils/api/ticketHandlers.test.ts`** (6 tests) — POST /tickets/:id/close: happy path with audit log, 404 not-found, 409 already-closed, 404 missing archive config, channel-not-text-based path returns archived: false without calling archiveAndCloseTicket, propagation of archived: false from the workflow.
- **`tests/unit/utils/api/applicationHandlers.test.ts`** (11 tests) — POST /applications/:id/{approve,deny,archive}: happy paths, triggeredBy → approvedBy/deniedBy fallback, 404/409 error paths, channel-not-text-based skips message send but still flips status + writes audit, archive propagates the honest archived flag.
- **`tests/unit/utils/api/setupHandlers.test.ts`** (8 tests) — POST /setup/toggle: disable/enable on existing state, the all-systems-enabled → null collapse, no-op when toggling something not in the set, auto-creates SetupState with detected DB defaults when none exists, body-validation rejection. POST /setup/systems: replaces selectedSystems on existing state, creates state when none exists, omitted enabledSystems → null.
- **`tests/unit/utils/api/analyticsHandlersOverview.test.ts`** (8 tests) — GET /analytics/overview: aggregates current window + computes pctChange vs previous window, aggregates topChannels across days and caps at 5, empty current window returns zeroes (no 404), zero-previous + non-zero-current returns the em-dash sentinel, ?days= override + clamp at MAX_RANGE_DAYS, 400 on bad ?days values. Companion to the existing analyticsHandlers.test.ts which covers the pure helpers.

### Changed

- **Test-only mocking pattern repeated from v3.1.13** — every API handler test patches `AppDataSource.getRepository` in `beforeAll` to return a per-entity fake repo, then dynamically imports the SUT. Bun's per-file `mock.module` is reserved for non-repo deps (closeWorkflow helpers, auditHelper). One new wrinkle in setupHandlers: the fake `create`/`save` methods clone their inputs because the SUT mutates `state.selectedSystems` after the initial create+save and saves again (sharing the same object reference). Without cloning, captured snapshots would bleed the final value into earlier ones.

### Notes

- Test count: 1077 → 1110 (+33).
- Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- **Commit 2 of the test-orchestration handoff is deferred** — replacing the over-mocked `ticketInteraction.test.ts` and `applicationInteraction.test.ts` requires either SUT changes (the dispatcher's `BUTTON_ROUTES` table captures handler function references at module-load, which Bun's per-file `mock.module` can't retroactively replace in the multi-file suite) or per-handler test files for each extracted module. Both are larger scopes than fit one session and don't have the closeWorkflow workaround equivalent (no Proxy/runtime indirection layer for the dispatcher).
- Remaining v3.1.9 test-orchestration commits: integration tests in `tests/integration/` (Commit 3), BaitChannelManager behavioral coverage (Commit 4), rate-limiter/velocity/health fake-timer migration (Commit 6), and the deferred Commit 2.

## [3.1.13] - 2026-04-26

Behavioral closeWorkflow tests — Commit 1 of the v3.1.9 test-orchestration-layer handoff. Replaces the 62-line existence-only `closeWorkflow.test.ts` (which only verified that `archiveAndCloseTicket` was a function and that the `ArchiveTicketResult` interface had the right shape) with 11 behavioral tests that actually exercise the function end-to-end against faked Discord client + channel + forum + repo. Targets the four failure modes the handoff called out plus the happy paths and re-close branches.

### Added

- **`tests/unit/utils/ticket/closeWorkflow.test.ts`** — 11 behavioral tests on `archiveAndCloseTicket`:
  - Happy paths: custom ticket type (calls `resolveTicketType` + ensures forum tag + saves new archive), legacy type (uses `legacyTypeInfo` + skips `resolveTicketType`), email ticket (uses `emailSender` + `emailSenderName` + `emailSubject` and looks up existing archive by `emailSender` not `createdBy`).
  - Re-close into existing archive thread: appends separator + new chunks instead of creating a new thread; new tag accumulates and saves the existing archive row; duplicate tag does not trigger a save.
  - Failure modes: transcript fetch failure short-circuits before any forum write or channel delete (returns `{success: false, archived: false, transcriptFailed: true}`); forum post failure still closes the ticket (`{success: true, archived: false}` — exercises the v3.1.9 contract-fidelity fix); channel-already-gone (Discord 10003) counts as success; channel delete hard failure logs but workflow still returns `success: true` (documents current behavior — escalating to `success: false` would be a separate behavior-change patch).
  - Edge case: orphaned `customTypeId` (resolveTicketType returns null) falls back to default title with no tag ensured; `customTypeId` resolved as legacy returns null and skips both `ensureForumTag` and `legacyTypeInfo`.

### Changed

- **Mocking strategy documented** — runtime patch of `AppDataSource.getRepository` in `beforeAll` (after dynamic import of `src/typeorm`) instead of `mock.module('lazyRepo', ...)`. The latter races against suite-wide module loading: when the test file is run alone the mock works, but the full `bun test` suite has other files that transitively load `lazyRepo` first, and Bun's per-file `mock.module()` cannot retroactively replace the captured proxy. Patching `getRepository` works because the `lazyRepo` Proxy delegates to it on first property access — the patch is in place by the time the SUT touches `archivedTicketRepo`. Other dependencies (`verifiedDelete`, `fetchAllMessages`, `forumTagManager`, `legacyTypes`) still use `mock.module()` because they don't capture state at module-load time.

### Notes

- Test count: 1071 → 1077 (replaced 5 fake-coverage tests with 11 behavioral; net +6).
- Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- This is the first of an estimated six commits planned in the test-orchestration-layer handoff. Remaining: replace over-mocked `ticketInteraction.test.ts` and `applicationInteraction.test.ts`, populate `tests/integration/` with three cross-module flow tests, BaitChannelManager behavioral coverage (1652 LOC currently zero tests), four high-value API handler tests, fake-timer migration for rate-limiter / velocity / health tests. The desloppify rerun lands after the permission migration and these remaining test commits.

## [3.1.12] - 2026-04-26

botReset collector collapse — landed the second of two commits deferred from v3.1.10. The 3-deep nested collector state machine in `src/commands/handlers/botReset.ts` (stage 1 collector spawning stage 2 collector spawning stage 3 collector spawning the actual reset work) now reads as a flat sequential script: stage 1 → stage 2 → stage 3 → execute. All three deferred commits originally planned out of v3.1.10 (Commits 1–6 shipped in v3.1.10, Commit 7 in v3.1.11, Commit 8 in this patch) are now complete.

### Changed

- **Flat sequential `botResetHandler`** — replaces the nested `collector.on('collect', ...)` callback pyramid with three sequential `await awaitButtonChoice(...)` calls. Each stage builds its own embed + button row inline, awaits the user's click, and either branches (cancel / timeout) or falls through to the next stage. After the third confirmation the handler calls `executeReset(...)` and the function ends.
- **New tiny inline helpers in botReset.ts** — `awaitButtonChoice(reply, userId, timeout)` is a one-liner around `Message.awaitMessageComponent({ filter, componentType: ComponentType.Button, time })` that returns the `ButtonInteraction` (un-acknowledged so the caller can `update()` it) or `null` on timeout. `notifyTimedOut(interaction)` does the editReply with the "Reset timed out." copy in a try/catch. Both are file-private — no new exports, no new files under `utils/`.
- **`executeReset(client, interaction, guildId, saveData)` extracted** — the ~130-line body that was previously buried 3 levels deep inside the third collector now lives as its own helper at the bottom of the file. Same six steps (compile + DM archive if `saveData`, cleanup messages, clear caches, purge DB, unregister guild commands, post summary embed). All side-effect ordering is preserved: archive DM lands before purge, command unregistration runs after final confirmation, the `globalCommandsCleaned` audit signal is unchanged.

### Notes

- The original handoff suggested chaining `awaitConfirmation()` calls from `src/utils/interactions/confirmHelper.ts`. That helper does not fit here for two reasons: it calls `interaction.reply(...)` internally (so chaining would throw on the second call against an already-replied interaction), and it only supports a binary confirm / cancel pair (Stage 2 of `/bot-reset` is a 3-way prompt: Save Data First / No, Delete Everything / Cancel). The inline `awaitButtonChoice` helper achieves the same flatness without changing the public `confirmHelper` API or forcing Stage 2 into a binary shape.
- File LOC: `botReset.ts` 370 → 349 (net 21 removed). The handoff predicted "~150 LOC reorganization" rather than removal — most of the savings came from collapsing the nested `collector.on('end', ...)` timeout handlers (one per stage) into a single `notifyTimedOut` and a uniform null-return contract on `awaitButtonChoice`.
- All confirmation copy, button labels, button styles (Danger / Primary / Secondary), button order, and stage-3 timeout (30s vs 60s for stages 1 and 2) preserved exactly. The DM-failure path still shows the "DM Failed" embed and proceeds with the reset, and the archive-too-large path still aborts with the existing copy pointing the operator at `/data-export`.
- Tests 1071 → 1071. Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- End-to-end dev-bot verification (3 confirmations through to a real guild reset, plus the cancel-at-each-stage and timeout-at-each-stage and DMs-blocked paths) is still the recommended pre-ship check per the original handoff, since unit tests cannot exercise interactive Discord flows.

## [3.1.11] - 2026-04-26

Simple-system descriptor — landed the first of two commits deferred from v3.1.10. The four bespoke configure flows in `src/commands/handlers/botSetup/systemFlows.ts` (`configureAnnouncement`, `configureBaitChannel`, `configureMemory`, `configureRules`) now route through one shared `runSimpleSystemFlow` driver + per-system `SimpleSystemConfig` descriptors, mirroring the `ForumSystemConfig` / `configureForumSystem` pattern that ticket and application have used since v3.0.0. The remaining deferred commit (botReset collector collapse) is unaffected by this change and stays handed off.

### Changed

- **`SimpleSystemConfig<TData, K>` descriptor + `runSimpleSystemFlow` driver** — new shared shape under `botSetup/systemFlows.ts`. Each descriptor carries `systemKey` (SetupState key), `channelType` (channelDefaults key — note `'bait'` vs `'baitchannel'`), `systemLabel`, `loadingMessage`, `fromAutoCreate(created, guild) -> TData | null`, `buildModal()`, `fromModal(submit) -> {kind: 'complete' | 'partial' | 'insufficient', data?}`, `apply(guildId, data, ctx)`, `toPartialData(data)`, and optional `finalState` (defaults to `'complete'`; rules uses `'partial'`). The driver folds the auto-create vs manual branches, calls `apply` only on the complete path, and skips state writes on the insufficient path.
- **Four simple-system descriptors** — `announcementConfig`, `baitConfig`, `memoryConfig`, `rulesConfig`. `runSystemFlow` now does a `SIMPLE_SYSTEM_CONFIGS[systemId]` lookup before falling through to the existing `staffRole` / `ticket` / `application` / `reactionRole` switch.
- **Behavior preserved across the refactor** — bait-channel warning send and default-keyword seed run on both auto-create and manual paths (the v3.0.5 fix); memory default forum tags and welcome thread also run on both paths; `baitChannelManager.clearConfigCache(guildId)` still invalidates after bait save; rules is still a two-stage system (`finalState: 'partial'`, `apply` is a deliberate no-op so the channel is recorded but the message + role wiring is left for `/rules-setup`); the announcement manual path still saves an empty partial when both fields are absent so resume-later state stays visible. Auto-create defaults for bait stay at `actionType: 'log-only'` + `testMode: true`; manual leaves `testMode` at the column default. `getModalFieldValue` and `saveSetupState` helpers unchanged.

### Deferred

- **botReset collector collapse (planned Commit 8 of v3.1.10)** — was always optional in the v3.1.10 parent handoff and contingent on this commit landing cleanly. Stays handed off in the same v3.1.10 deferred-handoff file. Verification plan in that file is still good as written.

### Notes

- File LOC: `systemFlows.ts` 1051 → 968 (net 83 removed; +299 / -381 churn). The handoff predicted 150 to 200 net removal but kept all helpers and added `SimpleSystemConfig` plus `runSimpleSystemFlow` plus four typed descriptor objects, which puts the net closer to 80.
- Test count: 1071 → 1071. Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`.
- No new dependencies, no migrations, no changes to external API surface, no changes to user-facing dashboard copy or modal field IDs.

## [3.1.10] - 2026-04-24

Design-coherence dispatcher split — landed Commits 1–6 of the eight planned in `.plans/2026-04-24/handoffs/v3.1.9-design-coherence-dispatcher-split.md`. The interaction-dispatch layer that had been ranked 78.5 in the post-v3.1.8 blind review now mirrors the route-table pattern that the command-dispatch layer (`TICKET_GROUP_ROUTES`, `COMMAND_ROUTES`) uses cleanly. Commits 7 (SimpleSystemConfig descriptor) and 8 (botReset collector collapse) deferred — see `.plans/2026-04-24/handoffs/v3.1.10-deferred-simple-system-and-botreset.md`.

### Changed

- **Ticket interaction route table** — `src/events/ticketInteraction.ts` shrinks from 708 → 7 LOC. Branch bodies extracted into dedicated handlers across `src/events/ticket/{create,typeAdmin,adminOnly,close}.ts`; dispatcher at `src/events/ticket/interactionRoutes.ts` keys on `customId` (exact and prefix) per interaction type. Drops the dead `if (!guildId)` re-check at the old ticket_type_ping_toggle site. Three already-extracted modal handlers (typeAdd, typeEdit, emailImport) routed via tiny adapters so all route values share `(client, interaction)` signature.
- **Application interaction route table** — same pattern for `src/events/applicationInteraction.ts` (467 → 7 LOC). Branches extracted into `src/events/application/apply.ts` + extensions to `src/events/application/close.ts`; dispatcher at `src/events/application/interactionRoutes.ts`.
- **Dashboard button table** — `collectDashboardInteractions` if-ladder collapsed to a `DASHBOARD_ROUTES` table with two extracted closures: `refreshDashboard()` (used by manage-systems, language, and reset-cancel) and `closeDashboard()` (used by finish-later and reset-confirm).
- **Shared `archiveAndCloseApplication()` helper** — extracted from the duplicated archive flow in `events/application/close.ts` and `api/handlers/applicationHandlers.ts` into `src/utils/application/closeWorkflow.ts`. Models on the existing `archiveAndCloseTicket()`. Both call sites collapse to a single helper call. The API handler now returns `{success, archived}` instead of bare `{success: true}` — strictly more informative without breaking the dashboard contract.
- **Data export entity descriptor** — replace 42 hand-coded Promise.all entries (entity declared three times — destructure, output map, key list) with one `EXPORT_ENTITIES` descriptor + `fetchAllExportData()` loop. BotStatus singleton, JoinEvent retention window, and ReactionRoleMenu relations all handled by inline `buildFindOptions` overrides. `archiveCompiler.ts` gets the same treatment for its 6-entity offboarding archive. `archiveExporter.ts` left as-is — its `system: 'tickets'|'applications'|'all'` switch reads better as conditionals than a descriptor + filter.
- **Bait whitelist mirrored branches** — collapsed parallel role/user add/remove blocks into one loop driven by a small `WhitelistTarget` list keyed on `field: 'whitelistedRoles' | 'whitelistedUsers'`. The "specify both role and user in one call" semantic is preserved (both targets pushed and processed).

### Deferred

- **SimpleSystemConfig descriptor (planned Commit 7)** — the four bespoke configure flows (`configureAnnouncement`, `configureBaitChannel`, `configureMemory`, `configureRules`) share a clean outer shell but each has meaningfully different inner side effects (warning send + keyword seed; tag seed + welcome thread; template seed; partial-only state). Forcing them into one descriptor would either need lots of optional callbacks or hide real per-system logic. Handed off in `.plans/2026-04-24/handoffs/v3.1.10-deferred-simple-system-and-botreset.md` with a concrete descriptor design.
- **botReset collector collapse (planned Commit 8)** — was always optional in the parent handoff and contingent on Commit 7 landing cleanly. Handed off in the same file.

## [3.1.9]

Bundled cleanup patch addressing six of the eight findings from the post-v3.1.8 desloppify blind rescore (strict 82.5 → 80.7). Two large patches (`design-coherence-dispatcher-split`, `test-orchestration-layer`) and the full feature-permission migration (12 features × multiple handlers) are handed off as dedicated sessions under `.plans/2026-04-24/handoffs/`.

### Changed
- **Docs sync** — `ARCHITECTURE.md` ticket close-workflow Mermaid diagram rewritten to match the v3.1.8 markdown-in-thread transcript flow: no more `.txt`/`.zip`, steps now reflect `fetchMessagesAsTranscript` → `resolveTicketType` (unified legacy + custom) → `buildTranscript` → post header + chunks → `verifiedChannelDelete`. `CLAUDE.md` entity list added `GuildPermission.ts` (shipped in v3.1.3, was missing) and removed the phantom `CustomTicketField` (the entity is `CustomTicketType`; `CustomInputField` is an interface under `shared/`). `CLAUDE.md` `utils/` tree expanded from the 11 documented subdirs to the actual 23 plus 15 top-level utility files
- **`ensureForumTag` truthful return type** — `Promise<string>` → `Promise<string | null>`. Three internal `return ''` failure-sentinel sites now return `null`. Both call sites (`migrate.ts` line 98, `closeWorkflow.ts` line 148) already used falsy checks so no behavior change, but the TS signature now matches the runtime
- **`archiveAndCloseTicket` truthful archived flag** — was returning `{ success: true, archived: true }` even when the inner forum-post `try/catch` swallowed a failure and logged a misleading "archived successfully". Now tracks failure in a local `archived` variable, logs a clear "Ticket closing despite archive failure" warning when the catch fires, and returns the real flag. Callers (`events/ticket/close.ts`, `api/handlers/ticketHandlers.ts`) updated to log the failure case — ticket still closes; only the archive post is missing
- **`writeAuditLog` honesty** — was silently no-op when `triggeredBy` was undefined; now emits a loud warning so operators can tell the difference between "audit row written" and "audit row silently skipped". DB write failures (previously fully swallowed) now log via `enhancedLogger.error`
- **3 mutating internal-API endpoints now write audit logs** — `setup/systems`, `setup/toggle`, `config/refresh`. Sibling mutating endpoints already audited; these were the inconsistent ones flagged by the rescore
- **Modal helper accepts both shapes** — `showAndAwaitModal` widened from `ModalBuilder` to `ModalBuilder | RawModalObject`, removing the `modal as any` cast at all 14 call sites (botSetup, baitChannel, ticket, application, announcement, contextMenus). The internal cast is documented as a discord.js v14.25.1 modal-v2 typing gap
- **Lazy initialization for 3 module-scope timers/env reads** — (1) `rateLimiter` cleanup `setInterval` deferred behind new `startCleanup()`/`stopCleanup()`, wired from `src/index.ts` `clientReady` next to the v3.1.7 `start*()` calls. (2) `ReactionCooldown` cleanup interval moved from constructor to first `isOnCooldown()` call. Constructing the class no longer spawns a background timer. (3) `restClient.ts` `CLIENT_ID` const replaced with `getClientId()` lazy getter mirroring `getRest()`. Two import sites migrated (`commands/handlers/botReset.ts`, `events/guildCreate.ts`)
- **Smaller silent-catch fixes** — `messageCleanup.ts` Phase-2 outer catch now logs the error instead of dropping it. `applicationHandlers.ts` archive try/catch now logs both the transcript-fetch failure path and the forum-post failure path (was zero log paths)

### Removed
- **`announcementRoleRename` legacy migration shim** — file deleted along with its registration in `src/index.ts`. The shim targeted the `minecraftRoleId` column dropped by TypeORM migration `1774000007000` in v3.0.17; every run since was a no-op
- **`emLANGF` SCREAMING_CASE emoji-prefixed formatter** — dropped from `src/utils/emojis.ts`. Zero call sites outside its own docstring; sibling `LANGF` was renamed to `formatLang` in v3.1.6
- **`/xp-setup import-mee6` subcommand stub** — carried a Plan 14 TODO and always replied with a placeholder. The real MEE6 import already ships as `/import mee6 xp` (via `commands/handlers/import/mee6.ts` + `utils/import/importManager.ts`). Removed the subcommand from `xpSetup` builder, the case branch and `handleImportMee6` function from `xp/setup.ts`, and the `importPlaceholder` string from all 5 locale files (en, es, fr, de, pt-BR)
- **`src/utils/logger.ts` + `tests/unit/utils/logger.test.ts`** — the `logger()` and `getTimestamp()` exports had zero production consumers (everything routes through `enhancedLogger`). Removed from the `utils/index.ts` barrel too. The 9 tests in `logger.test.ts` were exercising dead code

### Notes
- Test count: 1080 → 1071 (dropped 9 tests that covered the deleted `logger.ts`). Build clean. Biome clean except for the pre-existing `Function` type warning in `lazyRepo.ts:29`. Public/scorecard.png regenerated at strict 80.7 to honestly reflect the post-blind-review state
- Patches deferred to dedicated sessions: `design-coherence-dispatcher-split` (620 LOC `handleTicketInteraction` split + 460 LOC `handleApplicationInteraction` split + 4 other coherence findings), `test-orchestration-layer` (BaitChannelManager 1652 LOC has zero tests, 166 untested handlers, empty `tests/integration/`), full feature-permission migration (12 features × multiple handlers from `guardAdmin` → `guardFeatureAccess`). Handoff docs at `.plans/2026-04-24/handoffs/`
- Full rescore plan + per-dimension comparison: `.plans/2026-04-24/01-desloppify-rescore-post-v3.1.8.md`

## [3.1.8]

### Added
- **Markdown-in-thread ticket transcripts** — ticket (and application) archives now post their transcript directly into the forum thread as Discord-native markdown, instead of uploading a `.txt` file plus a `.zip` of images. Readable inline, no download, with clickable attachment links and image previews
  - New pure module `src/utils/ticket/transcriptBuilder.ts` exports `buildTranscript()`, `formatMessage()`, `formatHeader()`, `chunkByMessageBoundary()`, `truncateLongMessage()`, `formatDurationShort()`. No Discord client dependency — driven by a `TranscriptMessage[]` + `TicketMetadata` shape so it is fully testable without the gateway
  - Header format: `# 🎫 Ticket: <title>` with created-by / opened / closed / duration / type / assigned-to / message-count / attachment-count fields, using `<t:unix:f>` timestamps so each viewer sees their local timezone
  - Per-message format: bold author + Discord timestamp, body as a `>` blockquote, replies annotated with `↩️ *replying to X*`, attachments as `> 📎 [name](url)`, embeds rendered as a sub-blockquote of title/description/fields
  - Chunking: never splits mid-message; each follow-up message stays under Discord's 2000-char hard limit (1900 soft limit). A single oversized message is truncated at 500 chars with `… (truncated)`
  - Filtering: Discord system messages (joins/pins/boosts) and Cogworks' own component-only UI messages (ticket buttons, close dialogs, etc.) are excluded from the archive
  - Edge cases handled: empty ticket renders `*(No messages)*`, bot-only ticket renders `*(No human messages)*`, unavailable attachment URL renders `📎 ~~name~~ (unavailable)`
- `src/utils/fetchAllMessages.ts` replaced — new `fetchMessagesAsTranscript(channel, botClientId)` returns a `TranscriptMessage[]`. Takes the bot's client ID so it can flag component-only bot messages for filtering. No file I/O
- 28 new tests in `tests/unit/utils/ticket/transcriptBuilder.test.ts` covering header / message formatting / reply / attachment / code-block / embed / chunking / filtering / ordering paths. Total: 1052 → 1080

### Changed
- `src/utils/ticket/closeWorkflow.ts` — `archiveAndCloseTicket()` now posts transcript chunks as follow-up messages in the forum thread instead of uploading files. Forum tag accumulation behavior unchanged. Same `ArchiveTicketResult` shape so callers don't need to change
- `src/events/application/close.ts` and `src/utils/api/handlers/applicationHandlers.ts` — both application archive paths migrated to the same transcript flow in this patch (not deferred)

### Removed
- The `.txt` transcript + `.zip` attachment bundle upload flow
- `fs.promises.mkdir`/`writeFile`/`unlink` calls for transcript temp files (no temp directory needed anymore)
- `jszip` dependency (dropped from `package.json` — the transcript was its only use)
- `process.env.TEMP_STORAGE_PATH` — no longer read by any path

## [3.1.7]

### Changed
- **Init coupling cleanup**
  - `src/utils/restClient.ts` — the shared Discord REST client is now constructed lazily via `getRest()` instead of eagerly at module scope. Tests and tooling that transitively import this module no longer fail when `BOT_TOKEN` is unset. All three importers (`src/index.ts`, `src/events/guildCreate.ts`, `src/commands/handlers/botReset.ts`) updated to call `getRest()` at use time. The `rest` const export has been removed
  - `src/commands/handlers/shared/fieldManagerCore.ts` and `src/commands/handlers/application/applicationFields.ts` — module-scope `setInterval(...)` calls for cleanup loops moved behind explicit `startFieldDraftCleanup()` / `startFieldSessionCleanup()` functions, called from `src/index.ts`'s `clientReady` handler next to the other startup wiring. Same cadence and behavior at runtime; importing the modules no longer spawns background timers
- **JSDoc cleanup** across 4 files — removed module-level header blocks that just restated what exports already communicate, and trivial `/** Initialize X */` single-purpose JSDoc on methods whose names are self-describing. Kept `@example` blocks on public multi-call-site APIs (`createButtonCollector`, `createRoleSelectCollector`) and `why`-carrying comments. Net ~100 lines of descriptive-only JSDoc removed from `src/utils/monitoring/enhancedLogger.ts`, `src/utils/errorHandler.ts`, `src/utils/collectors.ts`, `src/utils/validation/permissionValidator.ts`

## [3.1.6]

### Changed
- **Cross-module architecture cleanup**
  - `invalidateRulesCache` is now imported directly from `src/utils/rules/rulesCache` by all 6 call sites. The stale passthrough re-export from `src/events/rulesReaction.ts` has been removed so the utils → events direction violation is gone
  - `ReactionRoleMenu.options` keeps its `require()` cycle-breaker, but now with an explanatory comment documenting which cycle it breaks and the 30-test failure that results from a naïve static import
- **Convention cleanup (elegance)**
  - `BaitChannelManager` collapsed a double-whitelist lookup (`isWhitelisted()` then `getWhitelistReason()`) into a single `checkWhitelist()` call, and deleted the two passthrough wrapper methods that are no longer used
  - `findStatus` passthroughs in `src/commands/handlers/ticket/workflow.ts` and `src/commands/handlers/application/workflow.ts` were inlined — callers now use `findStatusById` from `utils/workflow/workflowHelpers` directly
  - `logCommandAudit` in `src/commands/commands.ts` was refactored from an `if (commandName === 'ticket') else if (...) ...` ladder into an `AUDIT_RULES` lookup table keyed by command name, making it harder to forget an audit entry when a new command is added to the dispatcher
  - `ticketInteraction.ts` replaced a dynamic `await import('../commands/handlers/ticket/typeAdd')` with a static import of `buildTypeConfirmationEmbed` — no cycle risk since the target module has no events-layer imports
  - 5 legacy-ticket helper files (`ageVerify`, `banAppeal`, `playerReport`, `bugReport`, `other`) and their two wrappers in `ticketInteraction.ts` dropped their `async` keyword — none of them awaited anything, and call sites already used the return value directly
- **Naming**
  - `LANGF` → `formatLang` — 173 call sites across 34 files renamed via bulk rewrite. `LANGF` is no longer exported; only `formatLang` is reachable from the barrel at `src/utils/index.ts`
  - `welc` local in `ticketInteraction.ts` and `applicationInteraction.ts` renamed to `welcome`

### Deferred
- **Autocomplete / modal handler extract to `utils/`** (A.2, A.3) — the 12 autocomplete handlers and 3 modal handlers depend on domain-specific entity lookups (CustomTicketType, ApplicationConfig, etc.). Moving them to `utils/autocomplete/` wholesale would relocate command-layer coupling rather than remove it; a partial migration would create inconsistency. Tracked for a follow-up that addresses the routing infrastructure holistically
- **Events-layer export pattern normalization** (B) — the three export styles (object-literal default, named `export const` arrows, default functions) are each wired to different dispatch paths in `src/index.ts` and `src/events/interactionRouter.ts`. Normalizing would require touching the dispatch call sites in lockstep with the handler shapes; the existing mix is consistent within each dispatch path
- **`routing.ts` duplicated constants** (C.2) — no duplication found: `MAX_ROUTING_RULES` and `VALID_STRATEGIES` are already at module scope

## [3.1.5]

### Fixed
- **Error masking in `guildQueries` helpers** — `findOneByGuild`, `findManyByGuild`, `countByGuild`, `deleteByGuild`, and `verifyGuildExists` previously swallowed database errors and returned `null` / `[]` / `0` / `false`, leaving callers unable to distinguish "no row exists" from "the database is down." They now propagate errors to the caller, matching the underlying TypeORM methods. Callers that need graceful degradation should wrap the call in `safeDbOperation()` from `src/utils/errorHandler.ts`

### Changed
- Helper JSDoc updated to document the v3.1.5 error contract: a `null` / `[]` / `0` return value means "no row matches," not "the query failed"
- `deleteAllGuildData` now wraps each per-table `deleteByGuild` call in `safeDbOperation` internally, preserving its prior best-effort behavior (one table failing does not abort the GDPR purge of the rest)

### Added
- `tests/unit/utils/database/guildQueries.test.ts` — 15 tests covering happy path, not-found, DB-error propagation, and where-clause merging for all four query helpers. Total: 1037 → 1052

## [3.1.4]

### Changed
- **Legacy ticket type cleanup** — consolidated five separate copies of the legacy ticket-type constants (typeIds, display names, emojis, ping-column mapping) into a single canonical source in `src/utils/ticket/legacyTypes.ts`. Behaviour is unchanged; the five hardcoded types (`18_verify`, `ban_appeal`, `player_report`, `bug_report`, `other`) continue to use their legacy Discord modal builders
  - New unified `resolveTicketType(guildId, typeId)` helper returns a `ResolvedTicketType` shape that covers both legacy and custom types with a single call — replaces bespoke branching in `events/ticketInteraction.ts` and `utils/ticket/closeWorkflow.ts`
  - New helpers: `LEGACY_TYPES` (canonical descriptor array), `legacyTypeInfo(typeId)` (pure display-info lookup), `resolveLegacyPingColumn(typeId)` (pure `TicketConfig` column mapping)
  - `src/events/ticketInteraction.ts` modal-submission branch reduced from ~60 lines of legacy/custom branching to a single `resolveTicketType()` call plus a minimal description-builder switch; local `LEGACY_PING_COLUMNS`/`LegacyType` table removed
  - Deduped legacy descriptor tables in `src/commands/handlers/ticket/settings.ts`, `src/commands/handlers/ticket/typeToggle.ts`, and `src/commands/handlers/migrate.ts` — all four sites now import from the canonical module
  - Canonicalised `player_report` emoji to 📢 across the codebase (previously 🚨 in `typeToggle.ts`, diverging from every other site)

### Removed
- **Public exports from `src/utils/ticket/legacyTypes.ts`**: `LEGACY_TYPE_NAMES` and `LEGACY_TYPE_INFO` (absorbed into the new `legacyTypeInfo()` helper and the canonical `LEGACY_TYPES` descriptor array)

### Tests
- Rewrote `tests/unit/utils/ticket/legacyTypes.test.ts` around the new public API; +3 tests (1034 → 1037)

## [3.1.3]

### Added
- **Feature-based permission system** — new `guild_permissions` table lets server admins grant Discord roles specific permission levels for individual bot features, layered non-breakingly on top of the existing admin-only behavior
  - New entity `GuildPermission(guildId, feature, roleId, level)` with unique index on `(guildId, feature, roleId)` so POST upserts are idempotent
  - Levels: `use` < `manage` < `admin`. Higher levels satisfy lower requirements; `none` is represented by row absence
  - Features: `tickets`, `announcements`, `baitchannel`, `memory`, `xp`, `starboard`, `events`, `reactionroles`, `onboarding`, `automod`, `rules`, `analytics` (12 total; catalog exposed via API response so the webapp dropdown stays in sync)
  - Migration `1774000010000-AddGuildPermissions`
- **`hasFeatureAccess(interaction, feature, requiredLevel)`** in [src/utils/validation/featurePermission.ts](src/utils/validation/featurePermission.ts) — the core checker
  - Discord `Administrator` permission always grants access (cannot lock yourself out)
  - Guilds with zero permission rows fall back to legacy admin-only behavior (fully backwards compatible)
  - 60-second in-memory cache keyed by `guildId`, invalidated on writes via `invalidateFeaturePermissionsCache(guildId)`
  - Pure `resolveMemberLevel()` helper is exported + unit-tested separately from Discord/DB
  - Returns a typed `FeatureAccessResult` with a `reason` discriminator (`discord-admin` / `no-config-fallback` / `role-grant` / `no-matching-role` / `insufficient-level` / `no-guild`) for diagnostics
- **`guardFeatureAccess(interaction, feature, level)`** in [src/utils/interactions/guardHelper.ts](src/utils/interactions/guardHelper.ts) — mirrors the `guardAdmin` shape so handlers can migrate feature-by-feature
- **Three new REST endpoints** in [src/utils/api/handlers/permissionHandlers.ts](src/utils/api/handlers/permissionHandlers.ts):
  - `GET /internal/guilds/:guildId/permissions` — returns `{ permissions, features, levels }`; each permission includes `roleName` resolved from the guild cache (or `null` if the role was deleted)
  - `POST /internal/guilds/:guildId/permissions` — upsert by `(guildId, feature, roleId)`; validates feature + level against the same catalog; writes an audit log entry (`permission.upsert`) with optional `triggeredBy`
  - `DELETE /internal/guilds/:guildId/permissions/:id` — idempotent (returns `{ success: true }` even if the row was already gone); writes an audit log entry (`permission.delete`)

### Tests
- Added [tests/unit/utils/validation/featurePermission.test.ts](tests/unit/utils/validation/featurePermission.test.ts) (+14 tests) covering the FEATURES/LEVELS catalog, `isFeature`/`isLevel` type guards, `levelMeets` full rank matrix, and `resolveMemberLevel` edge cases (no match, single match, multi-role highest-wins, invalid level strings, empty inputs)
- Suite: 1020 → 1034 pass, zero regressions; biome clean; build clean

### Notes
- **Backwards compatible**: no handlers were migrated off `guardAdmin`/`guardAdminRateLimit` yet. Unconfigured guilds behave identically to pre-v3.1.3. The first incremental migration (spec calls for tickets to go first) can land in a follow-up patch once the webapp UI is live and real permission rows exist to test against
- **Discord slash commands deferred**: the `/bot-setup permissions view/set/remove/reset` subcommands outlined in the patch spec are not implemented yet — the webapp UI is the primary configuration surface. Slash commands can land as v3.1.3.1 if needed
- **Audit trail**: both write endpoints call `writeAuditLog` so permission changes appear alongside other admin actions in `/internal/guilds/:guildId/audit-log`

## [3.1.2]

### Added
- **Analytics REST API**: Five guild-scoped read-only endpoints that back the web dashboard's analytics views
  - `GET /internal/guilds/:guildId/analytics/overview[?days=N]` — current-period totals (messages, activeMembers, joins, leaves, voiceMinutes), top 5 channels aggregated from daily snapshots, and `comparedToPrevious` % deltas vs. the immediately-prior window
  - `GET /internal/guilds/:guildId/analytics/growth?days=30` — daily joins/leaves/totalMembers for line charts
  - `GET /internal/guilds/:guildId/analytics/channels?days=7` — per-channel message totals (aggregated from each day's top-channels JSON); `uniqueUsers` returns 0 until per-channel unique-user tracking is added
  - `GET /internal/guilds/:guildId/analytics/hours?days=7` — 24-slot UTC activity heatmap powered by the new `hourlyCounts` column
  - `GET /internal/guilds/:guildId/analytics/snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD` — raw snapshot rows for custom date ranges
  - All endpoints return empty collections (not 404s) for guilds with no data
  - All ranges clamped to 365 days; `days` must be a positive integer; `from`/`to` must be YYYY-MM-DD; `from <= to`
- **`hourlyCounts` column** on `AnalyticsSnapshot` (nullable `simple-json` 24-slot array) with migration `1774000009000-AddAnalyticsHourlyCounts` — powers the hours heatmap so we no longer have to fake a distribution from `peakHourUtc` alone
- **Activity tracker now persists the 24-hour histogram** alongside peak-hour when flushing snapshots; mid-day re-flushes merge rather than replace

### Tests
- Added `tests/unit/utils/api/analyticsHandlers.test.ts` (+18 tests) covering `pctChange` formatting (increase/decrease/zero/em-dash), `formatIsoDate`, `parseDaysWindow` (fallback, clamp, zero/negative/non-numeric rejection, window boundaries), and `parseFromToWindow` (valid/missing/malformed dates, reversed ranges, MAX_RANGE_DAYS enforcement)
- Suite: 1002 → 1020 pass, zero regressions; biome clean; build clean

### Notes
- Contract note: `uniqueUsers` per channel is stubbed at 0 and will be populated in a future patch after a per-channel unique-user storage schema lands
- Pre-existing snapshot rows have `hourlyCounts = NULL` — the hours endpoint correctly skips them rather than synthesizing data

### Follow-ups from webapp/API agent review
- **Snapshots endpoint field naming normalized**: response now returns `messages`/`joins`/`leaves` (was `messageCount`/`joinCount`/`leaveCount`) so it matches `overview`/`growth`/`channels`/`hours` and the webapp's existing `analytics.ts` types. `voiceMinutes` and `activeMembers` unchanged. No production consumers yet, so no back-compat shim.
- **Activity tracker is now actually fed**: `activityTracker.recordMessage/recordMemberJoin/recordMemberLeave/recordVoiceMinutes` are now wired into the event pipeline
  - `messageCreate` → `recordMessage()` (in-memory, no DB hop; pre-existing dev-guild exclusion respected)
  - `guildMemberAdd` → `recordMemberJoin()` (fed before bait flow so missing configs don't drop the count)
  - New `guildMemberRemove` handler → `recordMemberLeave()` (covers both voluntary leaves and kicks/bans)
  - New `voiceAnalytics` handler (separate from `xpVoiceHandler`) tracks per-user voice sessions in memory and records minutes on disconnect, capped at 24h; runs for every guild regardless of XP config
  - New helper `activityTracker.recordVoiceMinutes(guildId, minutes)` for bulk session recording

## [3.1.1]

### Added
- **External Error Reporting**: Errors now forward to a Discord webhook in addition to stdout/file logs, with built-in deduplication, rate limiting, and bot-metadata enrichment
  - New singleton `errorReporter` in `src/utils/monitoring/errorReporter.ts` — fire-and-forget `report()` that never throws and never blocks the caller
  - **Deduplication**: identical errors within a 60s window (configurable) PATCH the original webhook message to increment an `Occurrences` field instead of spawning a new alert
  - **Rate limiting**: sliding-minute cap (default 10/min) on NEW reports; dedupe edits do not consume budget, so a crash loop produces a single alert that counts up
  - **Severity gate**: default `minSeverity=MEDIUM`; embeds are color-coded (gray / yellow / orange / red) by severity
  - **Metadata enrichment**: bot version from `package.json`, uptime, and guild count are attached to every embed footer
  - **Fingerprint**: category + error name + first stack-trace frame — groups "same error from same code path" while separating unrelated errors that share a message
  - Wired into `logError()` in `errorHandler.ts`, so `handleInteractionError`, `uncaughtException`, `unhandledRejection`, and `safeDbOperation` all forward automatically
  - Non-Error rejection reasons are coerced so `unhandledRejection('some string')` still reaches the reporter
- **Environment variables**
  - `ERROR_WEBHOOK_URL` — Discord webhook URL; reporter is disabled when unset
  - `ERROR_REPORTING_ENABLED` — master toggle (defaults: enabled in prod, disabled in dev)
- **Tests**: Added `tests/unit/utils/monitoring/errorReporter.test.ts` (+14 tests) covering enablement gate, severity gate, POST with `?wait=true`, PATCH dedupe behavior, Occurrences field, distinct fingerprints, rate-limiting budget, dedupe edits not consuming rate budget, and fault tolerance (fetch rejection + non-2xx responses)

### Notes
- Tests: 1002 pass (988 previous + 14 new), zero regressions
- No webhook configured = default behavior unchanged — errors continue to go to stdout/file logs exactly as before
- Circular-import between `errorHandler` and `errorReporter` resolved via `import type` + string-literal enum values as Record keys

## [3.1.0]

### Added
- **i18n Foundation**: Bot can now reply in a per-guild locale, laying the groundwork for community-contributed translations
  - Reorganized `src/lang/` into per-locale subdirectories (`en/`, `es/`, `pt-BR/`, `fr/`, `de/`) — English remains the reference; other locales are scaffolded with English copies ready for translation
  - New loader in `src/lang/index.ts` assembles a `Language` object per locale and overlays it on English via a recursive Proxy — partial translations transparently fall back to English for missing keys
  - Static JSON imports ensure all 5 locales ship inside `dist/` for containerized production deploys
  - New public API: `getGuildLang(guildId)`, `getGuildLocale(guildId)`, `getLangForLocale(locale)`, `isSupportedLocale()`, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `invalidateGuildLocaleCache()` — re-exported from `src/utils/index.ts`
  - Existing `lang.x.y` synchronous access pattern is unchanged — zero breaking changes for the 200+ existing call sites
- **Per-Guild Locale Storage**: `BotConfig.locale` column (`varchar(10)`, default `'en'`) persists each guild's chosen language
  - Migration `1774000008000-AddBotConfigLocale` adds the column safely — the app layer guards against unknown values, so rollout order doesn't matter
- **Language Selector in `/bot-setup`**: New "Language" button (🌐) on the dashboard opens a radio-group modal with all supported locales
  - Persists the choice to `BotConfig.locale`, invalidates the in-memory locale cache, and refreshes the dashboard so the change is visible immediately
- **Translation Contributor Guide**: New `src/lang/TRANSLATING.md` walks contributors through the layout, formatting tokens (`{placeholders}`, `<@{mentions}>`, markdown), tone guidance, and quality checklist
- **Tests**: Added `tests/unit/utils/lang.test.ts` (+9 tests) covering `SUPPORTED_LOCALES`, `isSupportedLocale`, `getLangForLocale` caching + shape, and the Proxy fallback path

### Changed
- Threaded `getGuildLang(guildId)` through the top-level command dispatcher (`src/commands/commands.ts`) for the `botConfig.notFound` reply — demonstrates the localization pattern for future handler migrations
- Updated 15 direct `lang/*.json` imports in `commands/builders/` and `commands/handlers/{xp,onboarding,event}/` to point at the new `lang/en/` directory
- `src/utils/index.ts` barrel now re-exports the full i18n API alongside the legacy `lang` export

### Notes
- Tests: 988 pass (979 previous + 9 new), zero regressions
- Default behavior is identical to 3.0.18: every guild starts on `en` and every non-EN locale currently contains English strings, so replies look the same until translators contribute

## [3.0.18]

### Fixed
- **Maintenance mode no longer destroys persistent UI**: Button clicks during maintenance now reply ephemerally instead of using `update()` which was replacing ticket creation buttons and other persistent messages with the maintenance embed

## [3.0.17]

### Changed
- **Quick Fixes (Pre-3.1 Cleanup)**
  - Fixed CLAUDE.md entity listing (PendingBan location, SavedRole -> StaffRole)
  - Removed `@discordjs/rest` from direct dependencies (unused, transitive dep of discord.js)
  - Removed 11 dead exports from permissionValidator.ts (hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole, isGuildOwner, isRoleAbove, requireOwner, requireGuild, ValidationPermissionSets, PermissionNames, hasAdminPermission made private)
  - Dropped deprecated `minecraftRoleId` column from AnnouncementConfig (migration copies remaining data to defaultRoleId first)

## [3.0.16]

### Changed
- **Desloppify Rescore (Post-Cleanup)**: Fresh 20-dimension subjective review after v3.0.9-v3.0.15 patches
  - Strict score: 82.5/100 (target was 90+, gap driven by test coverage and mechanical issues)
  - Biggest dimension improvements: Test strategy +28.5% (33.5->62.0%), AI debt +16.5% (62.0->78.5%), Error consistency +8.5%, Init coupling +8.0%, API coherence +8.0%, Design coherence +7.0%
  - 12 of 20 subjective dimensions now above 84%
  - Scorecard regenerated at `public/scorecard.png`
  - 39 new review items identified for future work

## [3.0.15]

### Changed
- **Stale Migration & Naming Cleanup**
  - Dropped deprecated `deleteMessageDays` column from `bait_channel_configs` (superseded by `deleteMessageHours` in v3.0.3)
  - Renamed `SavedRole` entity to `StaffRole` to match its `staff_roles` table name (11 files updated)
  - Renamed `savedRoleRepo` variable to `staffRoleRepo` across 6 handler files

## [3.0.14]

### Added
- **Test Coverage Push (Session 2)**: +162 new tests (864 -> 1026), 1994 assertions across 33 files
  - Expanded `errorHandler.test.ts` with 64 behavioral tests for `classifyError` — covers all 7 error categories, priority ordering, case insensitivity, non-Error inputs
  - Expanded `urlAnalyzer.test.ts` with 42 new tests — additional shortener domains, phishing lookalikes, legitimate domain whitelisting, embedded URLs, mixed content
  - Expanded `usernameAnalyzer.test.ts` with 29 new tests — Unicode/emoji/Cyrillic, boundary conditions, bot patterns, combined weak signals
  - Fixed `internalApiServer.test.ts` to import `extractId`/`requireId` from production code (was reimplementing locally), migrated from jest to bun:test

## [3.0.13]

### Changed
- **Design Coherence**: Structural cleanup
  - Removed `botSetup.ts` passthrough wrapper (18 LOC) - commands.ts now imports directly from `botSetup/index`
  - Moved `PendingBan.ts` to `entities/bait/` alongside other bait entities (5 import sites updated)

## [3.0.12]

### Changed
- **Type Safety Hardening**: Removed unnecessary type casts and vestigial abstractions
  - Deleted vestigial `RoutingConfig` interface, `getRoutingFields()`, and `setRoutingFields()` from routing.ts - replaced 12 call sites with direct `config.X` property access (columns already exist on TicketConfig entity)
  - Widened `showAndAwaitModal` to accept `MessageComponentInteraction` and `ContextMenuCommandInteraction` - removes 3 unnecessary `interaction as any` casts
  - Removed 3 `null as unknown as string` / `null as unknown as Date` casts on already-nullable entity properties
  - `as any` count: 39 -> 34 (remaining are justified discord.js raw modal API casts)

## [3.0.11]

### Changed
- **API Surface Consistency**: Unified validation patterns and handler signatures
  - `validateHexColor` and `validateSafeUrl` now return `{ valid, error? }` instead of inverted `string | null` - matches `ValidationResult` convention from validators.ts
  - All `register*Handlers` functions now accept `(client, routes)` for consistent signatures (setupHandlers, commandHandlers, maintenanceHandlers updated)
  - Updated 6 call sites and 20+ test assertions for the new return shape

## [3.0.10]

### Changed
- **AI Generated Debt Cleanup**: Eliminated copy-pasted boilerplate across handlers
  - Created `guardAdmin()` helper (admin check without rate limiting) — replaces 57 occurrences of 5-line `requireAdmin` boilerplate across 33 files
  - Removed 25 redundant `if (!interaction.guild)` null checks across 17 files — central dispatcher already validates guildId
  - Only remaining guild check: automod autocomplete handler (different dispatch path, intentionally kept)

## [3.0.9]

### Changed
- **GitHub Actions Node 24 Migration**: Bumped all actions to Node 24 compatible versions
  - `actions/checkout` v4 → v5 (all 4 instances)
  - `docker/setup-buildx-action` v3 → v4
  - `appleboy/scp-action` v0.1.7 → v0.1.9
  - `appleboy/ssh-action` v1.0.3 → v1.2.2
  - Removed `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env workaround from both workflows

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
