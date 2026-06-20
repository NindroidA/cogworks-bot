/**
 * applyTemplateEditSubmit unit tests — the shared edit-apply logic used by both
 * `/announcement template edit` and the interactive `/announcement template
 * list` editor.
 *
 * Uses the AppDataSource.getRepository runtime-patch pattern (not mock.module,
 * which is process-shared and flaky) so the lazyRepo-backed templateRepo.save
 * resolves to a stable fake.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { AnnouncementTemplate } from '../../../src/typeorm/entities/announcement/AnnouncementTemplate';
import { AppDataSource } from '../../../src/typeorm';

const saveMock = jest.fn(async (x: unknown) => x);

let originalGetRepository: ((e: unknown) => unknown) | undefined;
let applyTemplateEditSubmit: typeof import('../../../src/commands/handlers/announcement/templates').applyTemplateEditSubmit;

beforeAll(async () => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = () => ({ save: saveMock });
  // Import AFTER the patch so the module-scope lazyRepo resolves to the fake on first use.
  ({ applyTemplateEditSubmit } = await import('../../../src/commands/handlers/announcement/templates'));
});

afterAll(() => {
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => saveMock.mockClear());

function template(overrides: Partial<AnnouncementTemplate> = {}): AnnouncementTemplate {
  return {
    id: 1,
    guildId: 'g1',
    name: 'maintenance',
    displayName: 'Old Name',
    description: null,
    title: 'Old Title',
    body: 'Old body',
    color: '#000000',
    fields: [],
    footerText: null,
    showTimestamp: false,
    mentionRole: false,
    isDefault: false,
    createdBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as AnnouncementTemplate;
}

function fakeFields(values: Record<string, string>) {
  return { getTextInputValue: (id: string) => values[id] ?? '' };
}

describe('applyTemplateEditSubmit', () => {
  test('applies sanitized fields, uppercases color, saves, returns the template', async () => {
    const t = template();
    const result = await applyTemplateEditSubmit(
      t,
      fakeFields({ display_name: 'New Name', title: 'New Title', body: 'New body', color: '#abcdef' }),
    );

    expect('template' in result).toBe(true);
    expect(t.displayName).toBe('New Name');
    expect(t.title).toBe('New Title');
    expect(t.body).toBe('New body');
    expect(t.color).toBe('#ABCDEF'); // uppercased
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  test('rejects an invalid color WITHOUT saving or mutating', async () => {
    const t = template();
    const result = await applyTemplateEditSubmit(
      t,
      fakeFields({ display_name: 'New Name', title: 'New Title', body: 'New body', color: 'not-a-color' }),
    );

    expect('error' in result).toBe(true);
    expect(t.displayName).toBe('Old Name'); // unchanged
    expect(t.color).toBe('#000000');
    expect(saveMock).not.toHaveBeenCalled();
  });

  test('empty color input falls back to the template current color (no error)', async () => {
    const t = template({ color: '#123456' });
    const result = await applyTemplateEditSubmit(
      t,
      fakeFields({ display_name: 'X', title: 'Y', body: 'Z', color: '' }),
    );

    expect('template' in result).toBe(true);
    expect(t.color).toBe('#123456');
    expect(saveMock).toHaveBeenCalledTimes(1);
  });
});
