/**
 * Ticket workflow status mapping (v3.16.12).
 *
 * Panel tickets are stored as 'opened' and the column default is 'created', so
 * an untouched ticket never literally says 'open'. `/ticket manage status` and
 * `info` map those back to the workflow's 'open'.
 */

import { describe, expect, test } from 'bun:test';
import { toWorkflowStatusId } from '../../../../src/utils/ticket/autoClose';

describe('toWorkflowStatusId', () => {
  test("maps every stored 'open' alias to the workflow's 'open'", () => {
    expect(toWorkflowStatusId('opened')).toBe('open');
    expect(toWorkflowStatusId('created')).toBe('open');
    expect(toWorkflowStatusId('open')).toBe('open');
    expect(toWorkflowStatusId('resolved')).toBe('resolved');
  });
});
