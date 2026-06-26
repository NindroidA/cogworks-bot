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

function main() {
  const changelog = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
  // Mirror deploy.yml's extraction: first `## [x.y.z]` heading.
  const match = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  const top = match?.[1];

  if (top !== version) {
    console.error(
      `✗ CHANGELOG drift: package.json is ${version} but the top CHANGELOG.md entry is ${top ?? '(none found)'}.`,
    );
    console.error(`  Add a "## [${version}] - <date>" section to the top of CHANGELOG.md before releasing,`);
    console.error('  otherwise the deploy will announce the wrong version to Discord.');
    process.exit(1);
  }

  console.log(`✓ CHANGELOG top entry matches package.json version (${version}).`);
}

main();
