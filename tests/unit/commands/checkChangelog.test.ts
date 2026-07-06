/**
 * Changelog drift gate tests — pins the FAILURE branch, which is the script's
 * entire purpose. Every green CI run only ever exercised the match branch, so
 * a regex regression would have gone unnoticed until a stale release note
 * actually shipped.
 */

import { describe, expect, test } from 'bun:test';
import { checkChangelogDrift, extractTopChangelogVersion } from '../../../scripts/checkChangelog';

const CHANGELOG = `# Changelog

Some prose mentioning ## [9.9.9] inline that must NOT match (not line-start).

## [3.14.2] - 2026-07-05

Notes.

## [3.14.1] - 2026-07-04
`;

describe('extractTopChangelogVersion', () => {
  test('finds the FIRST line-start heading, ignoring inline mentions', () => {
    expect(extractTopChangelogVersion(CHANGELOG)).toBe('3.14.2');
  });

  test('returns null when no heading exists', () => {
    expect(extractTopChangelogVersion('# Changelog\n\nnothing here\n')).toBeNull();
  });
});

describe('checkChangelogDrift', () => {
  test('passes when the top entry matches package version', () => {
    expect(checkChangelogDrift(CHANGELOG, '3.14.2')).toBeNull();
  });

  test('fails with both versions named when they drift', () => {
    const failure = checkChangelogDrift(CHANGELOG, '3.14.3');
    expect(failure).toContain('3.14.3');
    expect(failure).toContain('3.14.2');
  });

  test('fails clearly when the changelog has no version heading at all', () => {
    const failure = checkChangelogDrift('# Changelog\n', '1.0.0');
    expect(failure).toContain('(none found)');
  });
});
