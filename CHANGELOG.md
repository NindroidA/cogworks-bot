# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.36] - 2026-04-30

Test coverage — eighth patch of the post-v3.1.28 desloppify rescore series. Closes the largest remaining gap in `test_strategy`: the three delete event handlers (channelDelete, messageDelete, roleDelete) had zero direct coverage despite being load-bearing for v3.1.32's descriptor refactor. New tests verify the failure-attribution model (descriptor `name` field), Promise.allSettled isolation property, and per-entity mutation logic. Suite: 1134 → 1167 (+33 tests, no regressions).

### Added

- **`tests/unit/events/channelDelete.test.ts`** — 10 tests for the 13-entity descriptor sweep. Covers DM-channel early-return, full descriptor sweep regression list (every entity must be queried — removing a descriptor would fail the test), TicketConfig per-column nullification (3 variants: channelId/messageId, categoryId, no-match), Promise.allSettled sibling isolation, RulesConfig delete + cache invalidation, ReactionRoleMenu delete + cache invalidation, BaitChannelConfig manager cache flush, XPConfig array filtering.

- **`tests/unit/events/messageDelete.test.ts`** — 9 tests for the 8-entity descriptor sweep. Covers DM early-return, perf-guard for non-bot author (descriptor sweep skipped entirely), partial-message handling (null author still triggers full sweep), full descriptor sweep regression list, TicketConfig messageId clear, RulesConfig delete + cache invalidation, ReactionRoleMenu delete + invalidateMenuCache, Promise.allSettled isolation, baitChannelManager.handleMessageDelete invocation.

- **`tests/unit/events/roleDelete.test.ts`** — 14 tests for the 9-entity descriptor sweep. Covers full descriptor sweep regression list, BotConfig globalStaffRole nullification + flag disable, RulesConfig delete + cache, ReactionRoleOption (which uses `createQueryBuilder` join — fake repo extended with chainable QB stub keyed on params), AnnouncementConfig defaultRoleId nullification, StaffRole bulk remove, XPConfig ignoredRoles filter, XPRoleReward bulk remove, OnboardingConfig completionRoleId nullification, BaitChannelConfig whitelistedRoles filter + manager cache flush, Promise.allSettled isolation.

### Test pattern

All three suites share the same shape:
1. Per-entity fake-repo registry keyed on TypeORM entity class name.
2. `AppDataSource.getRepository` patched at runtime via `(AppDataSource as any).getRepository = (entity) => fakeRepos[entity?.name]`. Works because lazyRepo's Proxy resolves on first property access — no production-code changes needed.
3. `mock.module()` for cache helpers (`rulesCache`, `menuCache`, `starboardReaction`) — note Bun's `mock.module` is process-shared, so factories must include ALL real exports (not just the one being faked) to avoid undefined-export leaks across test files.
4. Fake repo supports `findOneBy` / `find` / `save` / `remove` / `count`, with a `shouldThrowOn` toggle to verify Promise.allSettled isolation. roleDelete additionally adds a chainable `createQueryBuilder` stub for the ReactionRoleOption join path.

These tests would fail if any descriptor is removed from CHANNEL_REF_CLEANERS / MESSAGE_REF_CLEANERS / ROLE_REF_CLEANERS — which is the regression they exist to catch. Deferred from this patch: integration tests, application handler tests, prototype-spy cleanup (handed off to follow-up versions).

## [3.1.35] - 2026-04-30

Incomplete migrations finalize — seventh patch of the post-v3.1.28 desloppify rescore series. 3 of 5 `incomplete_migration` findings closed (Part 4 was already done in v3.1.29); Parts 1 + 3 deliberately deferred pre-push because they're the highest-risk changes in this series (schema migration + user-visible command-shape change). No behavior change for landed parts.

### Changed

- **Renamed `legacy*` ticket type identifiers to `builtin*` across the codebase** (Part 2 / Option B).
  - `src/utils/ticket/legacyTypes.ts` → `src/utils/ticket/builtinTypes.ts`
  - `LEGACY_TICKET_TYPE_IDS` → `BUILTIN_TICKET_TYPE_IDS`, `LEGACY_TYPES` → `BUILTIN_TYPES`, `LegacyTicketTypeId` → `BuiltinTicketTypeId`, `LegacyTypeDescriptor` → `BuiltinTypeDescriptor`
  - `legacyTypeInfo()` → `builtinTypeInfo()`, `isLegacyTicketType()` → `isBuiltinTicketType()`, `resolveLegacyPingColumn()` → `resolveBuiltinPingColumn()`
  - `ResolvedTicketType.isLegacy` → `isBuiltin`
  - `ticketTypeAutocompleteWithLegacy` → `ticketTypeAutocompleteWithBuiltin` (autocomplete dispatcher updated)
  - `legacyTicketTypeButton` (event handler) → `builtinTicketTypeButton`; private helpers `buildLegacyTicketModal` / `buildLegacyTicketDescription` similarly renamed
  - User-visible "(Legacy)" suffix in admin autocomplete → "(Builtin)"
  - Test file renamed: `tests/unit/utils/ticket/legacyTypes.test.ts` → `builtinTypes.test.ts`. The "legacy" concept is closed — these types are part of the supported product surface, not a leftover.

- **Test infra: Jest dropped, Bun is the runner** (Part 5).
  - 4 devDependencies removed from `package.json`: `jest`, `ts-jest`, `@jest/globals`, `@types/jest`. `bun install` regenerated the lockfile.
  - Deleted `jest.config.js`. `tests/setup.ts` left untouched (just `import 'reflect-metadata'`).
  - All 10 test files migrated from `import { ... } from '@jest/globals'` → `from 'bun:test'`. `jest.fn()` / `jest.spyOn()` continue to work via Bun's compatibility shim.

- **`tests/unit/utils/ticket/closeWorkflow.test.ts`** — the `mock.module()` factory for `builtinTypes` now ALSO exposes the real `BUILTIN_TICKET_TYPE_IDS` / `BUILTIN_TYPES` / `isBuiltinTicketType` / `resolveBuiltinPingColumn` exports + sets a real-impl default for `fakeBuiltinTypeInfo`. Reason: Bun's `mock.module()` is process-shared once installed, so a partial mock factory causes `builtinTypes.test.ts` to read `undefined` for the unmocked exports when both suites run in the same process. The `beforeEach` block restores the real-impl default after each `mockReset` so per-test `mockReturnValue` overrides keep working.

### Docs

- **CLAUDE.md** — Testing section rewritten: "Runner: bun test (no separate config)", noted the `from 'bun:test'` import requirement, documented that `jest.mock()` is not supported (use `mock.module()`).
- **CLAUDE.md** — directory map line updated: `legacyTypes, transcriptBuilder` → `builtinTypes, routingTypes, transcriptBuilder` (also captures the v3.1.31 routingTypes addition).

### Skipped (deferred pre-push)

- **Part 1 — Bait dual-column collapse.** Dropping `BaitChannelConfig.channelId` requires a real DB migration with back-fill. Schema-altering migrations are the highest-risk class of change to push without isolated dev-test validation, and the v3.1.x series is entering its push gate. Defer to its own version.
- **Part 3 — Announcement legacy subcommands.** Removing `/announcement maintenance`, `/announcement back-online`, etc. is a user-visible command-shape change AND the patch's own constraint warns "the webapp may have hard-coded subcommand paths". Defer to its own version after a webapp audit.
- **Part 4 — `applications` in FEATURES catalog.** Already added in v3.1.29 Part 1; nothing to do here.

### Notes

- 1134 tests passing; build + biome clean.
- The `legacyTypes` finding closing is symbolic but real — the *concept* of "legacy" in the ticket-type subsystem is gone. Future contributors won't need to learn what makes a type "legacy"; they're builtin types now.
- Targets `incomplete_migration` 78.0 → 84+ on next desloppify rescore (3 of 5 closed; Parts 1 + 3 deferred).

## [3.1.34] - 2026-04-30

Design coherence pass 2 — sixth patch of the post-v3.1.28 desloppify rescore series. 4 of 5 `design_coherence` findings closed; the 5th (memory tags collector pattern) is deferred per coordination notes — same code shape as the memory CRUD chorus that v3.1.32 partially addressed; left as a follow-up sweep. No behavior change.

### Changed

- **`src/utils/offboarding/messageCleanup.ts`** — split the 350-line monolith into a 5-helper composition. `cleanupGuildMessages` is now a 6-line orchestrator chaining `collectTrackedMessages` (DB-only fetch), `deleteTrackedMessages`, `deleteForumThreads` (with `deleteForumEntries` helper), and `searchAndDeleteUntrackedMessages` (with `deleteViaSearchApi` + `deleteViaChannelScan` fallbacks). Each phase has a single concern and is independently testable.
- **`src/utils/database/ensureDefaultTicketTypes.ts`** — hoisted the 200-line `defaultTypes` literal out of the function body to a module-top `DEFAULT_TICKET_TYPE_SEEDS` constant typed as `DefaultTicketTypeSeed[]`. Function body shrinks from ~230 lines to a 6-line loop. Adding a new default type is now a clearly-scoped diff at the top of the file.
- **`src/commands/handlers/announcement/handler.ts`** — `previewAndSend` no longer hand-rolls its own button collector. Routes through `awaitConfirmation` from `utils/interactions/confirmHelper`. Function shrinks from ~100 lines to ~50; cancel/timeout handling now lives in the helper. `idPrefix: 'announcement'` keeps the customId namespace stable.
- **`src/utils/interactions/confirmHelper.ts`** — `awaitConfirmation`'s `interaction` parameter widened to also accept `ModalSubmitInteraction` (the announcement `previewAndSend` is called from both a slash-command path and a modal-submit path; both need to confirm-via-button next).
- **`src/utils/onboarding/onboardingEngine.ts`** — `sendOnboardingFlow` split into 4 phases: `loadOnboardingState` (config + completion record + DM channel), `sendWelcomeMessage` (opening embed), `runOnboardingSteps` (sequential per-step send + wait + persist), `finalizeOnboarding` (completion role + closing embed). Public `sendOnboardingFlow` is now an 11-line orchestrator. Preserves the original ordering — `OnboardingCompletion` row is created before any DM is attempted, so the start is recorded even if DMs are closed (intentional per the patch).

### Skipped

- **Part 5 — memory tags collector pattern** — patch's coordination notes flag this as overlapping with the memory CRUD chorus already addressed in v3.1.32 (`logHandlerError` sweep). The collector body is structurally similar but a separate concern. Left as an open follow-up.

### Notes

- 1134 tests passing; build + biome clean.
- All four changes preserve the public API of their respective entry points — pure internal restructuring.
- Targets `design_coherence` 84.5 → 88+ on next desloppify rescore.

## [3.1.33] - 2026-04-29

Mid-level elegance pass — fifth patch of the post-v3.1.28 desloppify rescore series. 4 of 5 `mid_level_elegance` findings closed; the fifth (AUDIT_RULES vs BUTTON_ROUTES "duplication") is a fresh-eyes false positive — the two tables operate on different key spaces (slash-command names vs customIds). No behavior change.

### Added

- **`src/utils/setup/systemStates.ts`** — single source of truth for the per-system DB-state inspection. The slash-command setup dashboard and the webapp setup API now both call into it. Adding a new system requires updating one function plus the `SystemStates` interface.
- **`createFieldHandlers<T>(config)`** factory in `src/commands/handlers/shared/fieldManagerCore.ts` — binds a `FieldManagerConfig` to its core helpers and returns a 5-method handler bundle (`showFieldManager`, `handleAddFieldModal`, `handleFieldButton`, `handleFieldSelectMenu`, `handlePreviewModal`). Replaces the wrapper-function chorus that `applicationFields.ts` and `typeFields.ts` both repeat.

### Changed

- **`commands/handlers/botSetup/setupDashboard.ts` + `utils/api/handlers/setupHandlers.ts`** — both `detectSystemStates` implementations replaced with import from the new util. `setupDashboard` re-exports for back-compat (so `botSetup/index.ts` and other callers don't need a churn pass). Net **-65 lines**.
- **`events/autocomplete.ts`** — switch-statement dispatch (~115 LOC) replaced with `AUTOCOMPLETE_ROUTES` lookup table keyed by `command/group/subcommand` plus a `COMMAND_AUTOCOMPLETE_ROUTES` fallback for commands whose entire surface uses one autocomplete handler (`reactionrole`, `announcement`). Same shape as v3.1.10's button-route tables. Net ~-40 lines and adding a new autocomplete-using subcommand is now one row instead of a switch case.
- **`commands/handlers/ticket/typeFields.ts`** — 4 wrapper functions (`handleAddFieldModal` / `handleFieldButton` / `handleFieldSelectMenu` / `handlePreviewModal`) collapsed into a `createFieldHandlers(config)` call + destructure-and-export. Net **-30 lines**.
- **`commands/handlers/application/applicationFields.ts`** — same pattern. The wrapper chorus was thicker here because each function also did `String(positionId)` conversion — now the dispatcher passes strings directly.
- **`events/applicationFieldsInteraction.ts`** — drops `parseInt` calls that were paired with the wrapper-side `String(...)` re-conversion. Match groups (already strings) are passed straight through.
- **`events/typeFieldsInteraction.ts` + `events/applicationFieldsInteraction.ts`** — both now return `Promise<boolean>` (true when matched + handled, false otherwise) so the top-level router can iterate without duplicating prefix knowledge. Each dispatcher early-outs on prefix mismatch.
- **`events/applicationInteraction.ts` + `events/ticketInteraction.ts`** — propagate the boolean return from their underlying `dispatchXxxInteraction` (which already returned `Promise<boolean>` from v3.1.10).
- **`events/interactionRouter.ts`** — collapsed from 85 lines of inline prefix-matching to a 25-line dispatch loop. The top-level no longer encodes per-feature prefix knowledge — each feature dispatcher decides for itself whether to claim the interaction. Adding a new feature dispatcher is a one-line addition to `FEATURE_DISPATCHERS`.

### Skipped

- **AUDIT_RULES vs BUTTON_ROUTES "duplication"** — patch's premise was wrong. `AUDIT_RULES` keys are slash-command names (`ticket`, `memory`, `role`, `application`); `BUTTON_ROUTES` keys are interaction customIds (`close_ticket`, `confirm_close_ticket`...). Different key spaces; not parallel.

### Notes

- 1134 tests passing; build + biome clean.
- `createFieldHandlers` is the kind of mechanical factory that pays for itself the second time it's used. Future field-bearing entities (e.g. announcement templates with custom fields) get the wrapper-free experience for free.
- Targets `mid_level_elegance` 78.5 → 86+ on next desloppify rescore.

## [3.1.32] - 2026-04-29

AI debt cleanup pass 3 — fourth patch of the post-v3.1.28 desloppify rescore series. Closes 3 of 4 `ai_generated_debt` findings (the 4th — `guard_helpers_duplicated_rate_limit_tail` — was already done in v3.1.29). Plus absorbs the deferred `entityNames descriptor` finding from v3.1.31's cross-module-arch coordination notes. No behavior change.

### Added

- **`logHandlerError(scope, error, ctx)`** at `src/utils/monitoring/enhancedLogger.ts` — one-line wrapper around `enhancedLogger.error` for the post-`deferReply` cleanup pattern. Replaces the 4-line `enhancedLogger.error(...) + error instanceof Error ? error : undefined + LogCategory.COMMAND_EXECUTION + { guildId }` shape that was repeated identically across 13 memory handler catch blocks.

### Changed

- **`channelDelete.ts`** — 13 inline IIFE blocks collapsed into a `CHANNEL_REF_CLEANERS` descriptor array. The parallel `entityNames` array (used for failure attribution by index) is gone — the descriptor's `name` field IS the attribution. Same `Promise.allSettled` semantics; one cleaner failing still doesn't abort siblings. **Net -25 lines** plus the load-bearing index coupling is gone.
- **`messageDelete.ts`** — 8 IIFE blocks collapsed into `MESSAGE_REF_CLEANERS` descriptor. The 10-second `withTimeout` wrapper is preserved as a tiny module-level helper that the dispatcher applies to each cleaner.
- **`roleDelete.ts`** — 9 IIFE blocks collapsed into `ROLE_REF_CLEANERS` descriptor.
- **All 13 memory handler catch blocks** swept onto `logHandlerError`. Files touched: `add.ts`, `capture.ts`, `delete.ts`, `manageTags.ts` (4 sites), `tags.ts` (3 sites), `update.ts`, `updateStatus.ts`, `updateTags.ts`. `enhancedLogger` + `LogCategory` imports dropped from files that no longer use them directly. **Net ~50 lines deleted.**

### Docs

- **CLAUDE.md** — Error Handling section now distinguishes `handleInteractionError` (pre-reply: log + reply with error embed) from `logHandlerError` (post-`deferReply`: log only, caller controls `editReply` body). Both helpers shown side-by-side.

### Notes

- 1134 tests passing; build + biome clean.
- Audit other features for the same chorus — application/ticket/baitchannel/announcement handlers may have similar shape. Out of scope for this commit; can land in a follow-up sweep.
- Restating-comment sweep (Part 3 of the patch) deferred — explicit "don't bundle with other parts" instruction in the patch and the diff would be all noise-level.
- Targets `ai_generated_debt` 80.5 → 88+ on next desloppify rescore. Also closes the `cross_module_architecture::delete_event_handlers_iife_boilerplate` finding deferred from v3.1.31.

## [3.1.31] - 2026-04-29

Cross-module architecture pass — third patch of the post-v3.1.28 desloppify rescore series. Closes both `cross_module_architecture` findings: (1) events depending on commands/handlers for non-dispatch reasons, and (2) the `TicketConfig` entity importing a column type from a runtime utility. No behavior change.

### Added

- **`src/utils/xp/configCache.ts`** — new module owning `getXPConfig`, `invalidateXPConfigCache`, `clearXPConfigCache`, plus the cache map and 5-minute TTL constant. The slash-command setup handler and the message/voice event handlers all read through this single util.
- **`src/typeorm/entities/ticket/routingTypes.ts`** — new entity-side types module owning `RoutingRule` and `RoutingStrategy`. The entity (data shape) no longer depends on the runtime helper; the helper imports these types from the entity side.

### Changed

- **`xpMessageHandler.ts` + `xpVoiceHandler.ts`** — `getXPConfig` import path flipped from `../commands/handlers/xp/setup` → `../utils/xp/configCache`. Closes the genuine cross-module smell (events shouldn't depend on slash-command code for shared workflow utilities).
- **`commands/handlers/xp/setup.ts`** — dropped the local cache map + getter/invalidator pair; now imports `invalidateXPConfigCache` from the new util. **Net -28 lines** in setup.ts.
- **`commands/handlers/xp/index.ts`** — dropped the `clearXPConfigCache` / `getXPConfig` / `invalidateXPConfigCache` re-export block (those were existence proofs of the cross-module smell). Replaced with a one-line comment pointing readers to `utils/xp/configCache`.
- **`commands/handlers/xp/leaderboard.ts` + `rank.ts`** — `getXPConfig` import path flipped to the new util.
- **`utils/ticket/smartRouter.ts`** — `RoutingRule` and `RoutingStrategy` no longer defined here; imported from `entities/ticket/routingTypes` and re-exported for back-compat with existing util-side importers (so consumers don't need a churn pass). Stale "requires the following columns on TicketConfig" docblock note replaced with a pointer to the new types module.
- **`typeorm/entities/ticket/TicketConfig.ts`** — `RoutingStrategy` import flipped from `../../../utils/ticket/smartRouter` → `./routingTypes`. The inline `routingRules: Array<{ ... }>` shape that duplicated `RoutingRule` is now `RoutingRule[]`.

### Docs

- **CLAUDE.md** — new **Layering rule** section under Architecture. ASCII diagram of the dependency arrows, explicit description of the dispatch exception (autocomplete + interaction-route dispatchers genuinely DO import handler functions from `commands/handlers/*` — that's the whole point of those files), and a note on the entity ← utility direction with `routingTypes.ts` as the canonical example.

### Notes

- After this patch, `grep "from '../commands/handlers" src/events/` still returns 13 hits — all in dispatcher files. That's intentional; the layering rule documents the exception. The genuinely-fixable smells (xp config cache + TicketConfig type import) are closed.
- 1134 tests passing; build + biome clean.
- Targets `cross_module_architecture` 76 → 88+ on next desloppify rescore.

## [3.1.30] - 2026-04-29

Init-coupling pass 2 + cosmetic cleanup bundle — second patch of the post-v3.1.28 desloppify rescore series. Closes 11 small findings across `initialization_coupling`, `abstraction_fitness`, `type_safety`, `naming_quality`, `logic_clarity`. Drops the persistent `lazyRepo` biome warning that survived v3.1.10 → v3.1.29. No behavior change.

### Added

- **`ReactionRoleMode` type alias** in `src/typeorm/entities/reactionRole/ReactionRoleMenu.ts` and re-exported from `entities/reactionRole/index.ts`. Replaces the inline `'normal' | 'unique' | 'lock'` literal at 4 sites (entity column type, `reactionRoleHandlers.ts`, `reactionRole/edit.ts`, `reactionRole/create.ts`).
- **`RawModal` interface** in `src/utils/modalComponents.ts` — explicit return type for `rawModal()`. Previously `rawModal` returned an inferred shape; new callers can now `import { type RawModal }` if they need to type a variable.

### Changed

- **`guildWebhook.ts`** — replaced module-scope `const API_URL = process.env.API_URL` with private `getApiUrl()` / `isDev()` getters. Mirrors the v3.1.7 `getRest()` deferral pattern. Importing the module no longer snapshots env at load time.
- **`commandList.ts`** — `IS_DEV` env snapshot kept as-is with a justification comment. Commands are registered once at startup; runtime `RELEASE` mutation is not supported, so deferring would just shift the snapshot point.
- **`lazyRepo.ts:29`** — `(value as Function).bind(cached)` → `(value as (...args: unknown[]) => unknown).bind(cached)`. **Drops the persistent biome `Function` type warning** noted across v3.1.10 → v3.1.29 memory entries. `bun run check` now reports zero warnings.
- **`devTest.ts:466-489`** (`handleRoutingSimulate`) — removed the `routingConfig = config as typeof config & { smartRoutingEnabled?, routingRules?, routingStrategy? }` intersection cast and the cascading `as 'least-load' | 'round-robin' | 'random'` literal cast. `TicketConfig` already declares all three columns (with `routingStrategy: RoutingStrategy`), so direct property access is type-safe.
- **`errorHandler.ts`** — `handleInteractionError`'s `Interaction` union widened to include `MessageContextMenuCommandInteraction`, `UserContextMenuCommandInteraction`, and `StringSelectMenuInteraction`. The 4 context-menu handlers (captureToMemory, manageRestrictions, openTicketForUser, viewBaitScore) dropped their `interaction as any` casts.
- **`SetupState.systemStates`** — kept non-nullable but added a contract comment documenting that the DB column is nullable while every read path normalizes via `... || DEFAULT_SYSTEM_STATES`. Originally tried `SystemStates | null` but the spread inference cascade would have touched 18+ sites for ~2pt of type safety.
- **`emojis.ts`** — removed the `em` namespace (28 lines, zero importers) and 11 dead emoji type aliases (`EmojiCategory`, `StatusEmoji`, `ActionEmoji`, `TimeEmoji`, `ModerationEmoji`, `FeatureEmoji`, `ContentEmoji`, `StatsEmoji`, `SystemEmoji`, `DecorativeEmoji`, `TicketTypeEmoji`). Module JSDoc updated to drop the `em.success(...)` example.
- **Async without `await` sweep** — dropped `async` from three pure-sync functions: `buildApplicationMessage` (in `applicationPosition.ts`), `awaitButtonChoice` (in `botReset.ts`), `fetchTextChannelIds` (in `dev/devSuiteWorkflows.ts`). Call sites still use `await x` which is a no-op on non-Promises; left unchanged to minimize churn.

### Removed

- **`src/typeorm/entities/bait/index.ts`** — orphan re-export barrel with zero importers (verified — every `bait/*` consumer imports from the entity file directly). Also closed the `convention_outlier::entity_barrel_split` finding.

### Skipped

- **A.3 `enhancedLogger` sync FS** — finding stale, no `writeFileSync`/`readFileSync` calls in the file.
- **A.4 `ReactionRoleMenu` `require()` comment** — comment was already present from v3.1.6.
- **C.3 `messageGuard.ts` rename** — file has 4 peer exports (`safeChannelFetch`, `safeMessageFetch`, etc.) with no clear primary export. Renaming has higher cost than the linter signal warrants.
- **C.4 `skipAdmin` → `skipPermissionCheck` rename** — already landed in v3.1.29 Part 6.

### Notes

- 1134 tests passing; build clean; `bun run check` now reports **zero warnings** (the persistent `Function` warning is gone).
- Targets `initialization_coupling` 87.5 → 90+, `abstraction_fitness` 89 → 92+, `type_safety` 86 → 90+, `naming_quality` 89 → 92+, `logic_clarity` 87.5 → 90+ on next desloppify rescore.

## [3.1.29] - 2026-04-29

Authorization consistency pass 2 — closes the seven high-confidence auth gaps surfaced by the post-v3.1.28 desloppify rescore. Largest single regression in the rescore (`authorization_consistency` 88.0 → 78.5); this patch lands all eight scoped parts.

### Added

- **`'applications'` feature key** added to `FEATURES` catalog in `src/utils/validation/featurePermission.ts`. Flows through `permissionHandlers` automatically — webapp permissions UI now offers `applications` as a first-class scope. Test count for FEATURES catalog expectation updated to match.
- **`guardOwner()`** wrapper at `src/utils/interactions/guardHelper.ts`. Mirrors `guardAdmin`'s shape: replies ephemerally on failure, returns `{ allowed }`. Replaces the 6-line `requireBotOwner + reply + return` boilerplate at all 13 call sites (status/dev). Exported from the `interactions` barrel.
- **Regression test** for `pingToggleButton` denial when the user is not a Discord admin and no permission rows exist (1133 → 1134 tests).

### Changed

- **`application` command tree** migrated to feature-scoped guards. 13 sites across 5 files: `applicationEdit`, `applicationFields`, `applicationPosition`, `applicationSetup` (rate-limit preserved via `guardFeatureRateLimit`), `workflow.ts` (4 `workflow-*` admin commands + 3 previously-unguarded mutating handlers `applicationStatusHandler`/`applicationNoteHandler`/`applicationClaimHandler` now require `'applications', 'manage'`; read-only `applicationInfoHandler` requires `'use'`; applicant self-check `applicationCheckHandler` remains unguarded).
- **`pingToggleButton`** at `src/events/ticket/typeAdmin.ts` now gates with `guardFeatureAccess('tickets', 'manage')`. The button mutates `TicketConfig.pingStaff*` columns — same write surface as the slash command form. Without this check a non-admin who could see the message could re-click the button at any time.
- **Context menus** (`src/commands/handlers/contextMenus/`): `captureToMemory` → `'memory', 'use'`; `manageRestrictions` → `'tickets', 'manage'` (mutates `UserTicketRestriction`); `openTicketForUser` → `'tickets', 'use'` (read-only display); `viewBaitScore` → `'baitchannel', 'use'`.
- **`guardHelper.ts`** internal cleanup — extracted private `applyRateLimit()` shared by `guardAdminRateLimit` and `guardFeatureRateLimit` (both now ~5 lines: do the auth check, delegate to `applyRateLimit`). Renamed `GuardOptions.skipAdmin` → `GuardOptions.skipPermissionCheck` (the old name was a misnomer for the feature-rate-limit variant). Updated single caller in `ticket/emailImport.ts`.
- **Owner sweep** — replaced the `requireBotOwner(interaction.user.id) + reply + return` ladder with `guardOwner(interaction)` at all 13 sites: `status/{view,set,clear,history,subscribe (3)}`, `dev/{devSuite,devTest,devSuiteScaffold (4)}`. Net ~85 lines deleted.
- **Raw `requireAdmin` sweep** — 8 call sites in `migrate.ts` (2), `dev/applicationDev.ts` (2), `dev/ticketDev.ts` (3), `import/index.ts` (1) collapsed onto `guardAdmin(interaction)`.
- **`devSuiteTests.ts` static-analysis** — the `permissions-audit` heuristic that scans handler source for permission-check strings now recognises both legacy `require*` validators and the modern `guard*` wrappers (`guardAdmin`, `guardOwner`, `guardFeatureAccess`, `guardFeatureRateLimit`). Without this update the audit would have flagged every newly-migrated handler as "no permission check".
- **Per-ticket close buttons** at `src/events/ticket/close.ts` left intentionally unguarded with an explanatory in-code comment — Discord channel ACLs (applicant + staff role + Discord admins) are the gate, and applicant-self-close is intentional UX.
- **Test mock** for `ticketInteraction.test.ts` extended: `baseInteractionProps` now includes `isRepliable: true`, a truthy `guild`, and a `member.permissions.has` stub returning true (Discord-admin path). Tests exercising the non-admin path override `member` explicitly.

### Docs

- **`CLAUDE.md`** Permission Validation section rewritten to lead with the `guard*` wrappers, document the four levels (`use`/`manage`/`admin`/owner), and call out the meta-feature exceptions (`/bot-setup`, `/bot-reset`, `/data-export`, `/status`).
- **`CLAUDE.md`** Common Pitfalls — added "use feature-scoped guards when the action is in the FEATURES catalog" and "use `guardAdmin`/`guardOwner` wrappers, not raw `require*` + hand-rolled reply".

### Notes

- All migrations preserve admin-only fallback for unconfigured guilds via `hasFeatureAccess`. No behavior change for guilds that have not visited the webapp permissions UI.
- `pingToggleButton` (Part 3) is the one user-visible behaviour change: a non-admin who could previously click the button can no longer mutate the staff-ping config. This was always the intended behaviour — the button was an end-run that the dispatcher split (v3.1.10) didn't re-cover.
- 1133 → 1134 tests passing; build + biome clean.
- Targets `authorization_consistency` 78.5 → 88+ on the next desloppify rescore.

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
