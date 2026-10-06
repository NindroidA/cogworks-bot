/**
 * restClient RELEASE handling (NindroidA/cogworks-bot#41, finding #139).
 *
 * index.ts picks the dev bot for any casing / padding of `dev`; restClient
 * compared strictly, so `RELEASE=Dev` logged in as the dev bot but registered
 * commands with the prod token against the prod application id.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { getClientId, isDevRelease } from '../../../src/utils/restClient';

const saved = { RELEASE: process.env.RELEASE, CLIENT_ID: process.env.CLIENT_ID, DEV: process.env.DEV_CLIENT_ID };

afterEach(() => {
  for (const [key, value] of [
    ['RELEASE', saved.RELEASE],
    ['CLIENT_ID', saved.CLIENT_ID],
    ['DEV_CLIENT_ID', saved.DEV],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('isDevRelease / getClientId', () => {
  test.each(['dev', 'Dev', 'DEV', ' dev '])('RELEASE=%p uses the dev application', release => {
    process.env.RELEASE = release;
    process.env.CLIENT_ID = 'prod-app';
    process.env.DEV_CLIENT_ID = 'dev-app';
    expect(isDevRelease()).toBe(true);
    expect(getClientId()).toBe('dev-app');
  });

  test.each(['prod', 'PROD', ''])('RELEASE=%p uses the prod application', release => {
    process.env.RELEASE = release;
    process.env.CLIENT_ID = 'prod-app';
    process.env.DEV_CLIENT_ID = 'dev-app';
    expect(isDevRelease()).toBe(false);
    expect(getClientId()).toBe('prod-app');
  });

  test('unset RELEASE means prod', () => {
    delete process.env.RELEASE;
    expect(isDevRelease()).toBe(false);
  });
});
