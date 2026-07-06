/**
 * closeNeedsArchiveWarning — pins the v3.13.2 misconfiguration warning shared
 * by the ticket and application setup views: creation configured without an
 * archive forum is exactly the state that makes the Close button fail.
 */

import { describe, expect, test } from 'bun:test';
import { closeNeedsArchiveWarning } from '../../../../src/utils/setup/configStatusEmbed';

describe('closeNeedsArchiveWarning', () => {
  test('warns when creation is configured but the archive is missing', () => {
    expect(closeNeedsArchiveWarning('chan-1', undefined)).toBe(true);
    expect(closeNeedsArchiveWarning('chan-1', null)).toBe(true);
    expect(closeNeedsArchiveWarning('chan-1', '')).toBe(true);
  });

  test('quiet when both are configured', () => {
    expect(closeNeedsArchiveWarning('chan-1', 'forum-1')).toBe(false);
  });

  test('quiet when creation itself is not configured (nothing to close)', () => {
    expect(closeNeedsArchiveWarning(undefined, undefined)).toBe(false);
    expect(closeNeedsArchiveWarning(null, 'forum-1')).toBe(false);
  });
});
