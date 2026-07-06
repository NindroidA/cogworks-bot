#!/usr/bin/env bun
/**
 * Changelog drift gate.
 *
 * The deploy workflow's Discord release message posts the TOP `## [x.y.z]`
 * entry of CHANGELOG.md. `release.sh` bumps package.json but does NOT touch the
 * changelog, so a forgotten entry silently ships stale release notes (the bot
 * announced the previous version's notes for v3.13.1). This guard fails CI when
 * package.json's version doesn't match the top CHANGELOG entry, making that
 * impossible: a version bump must come with its changelog entry.
 *
 * Run: `bun run check:changelog` (wired into CI before tests).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { version } from '../package.json';

/** Mirror deploy.yml's extraction: the first `## [x.y.z]` heading, or null. */
export function extractTopChangelogVersion(changelog: string): string | null {
  return changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1] ?? null;
}

/**
 * Pure gate: null = pass; a string = the failure message (the script prints it
 * and exits 1). Exported so the failure branch — the script's entire purpose —
 * is actually testable instead of only ever exercising the match branch in CI.
 */
export function checkChangelogDrift(changelog: string, pkgVersion: string): string | null {
  const top = extractTopChangelogVersion(changelog);
  if (top !== pkgVersion) {
    return `✗ CHANGELOG drift: package.json is ${pkgVersion} but the top CHANGELOG.md entry is ${top ?? '(none found)'}.`;
  }
  return null;
}

function main() {
  const changelog = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  const failure = checkChangelogDrift(changelog, version);

  if (failure) {
    console.error(failure);
    console.error(`  Add a "## [${version}] - <date>" section to the top of CHANGELOG.md before releasing,`);
    console.error('  otherwise the deploy will announce the wrong version to Discord.');
    process.exit(1);
  }

  console.log(`✓ CHANGELOG top entry matches package.json version (${version}).`);
}

// Only run the gate when executed directly — importing the module for tests
// must not exit the process. (argv check instead of import.meta.main: the
// project tsconfig targets a module mode where import.meta is unavailable.)
// endsWith, not includes: under `bun test` argv[1] is the test file path
// (checkChangelog.test.ts), which a substring match would wrongly trigger on.
if (process.argv[1]?.endsWith('/checkChangelog.ts')) {
  main();
}
