import { describe, expect, test } from 'bun:test';
import { CsvImporter } from '../../../../src/utils/import/csvImporter';

/**
 * CsvImporter Unit Tests
 *
 * Tests the CSV parsing and validation logic. The import() method calls
 * enhancedLogger at the end, so we test via the class instance directly.
 * The logger call is non-critical and won't break the return value.
 */

function createImporter(csv: string): CsvImporter {
  const importer = new CsvImporter();
  importer.csvContent = csv;
  return importer;
}

// ===========================================================================
// Basic properties
// ===========================================================================
describe('CsvImporter properties', () => {
  test('has correct name', () => {
    expect(new CsvImporter().name).toBe('csv');
  });

  test('has correct displayName', () => {
    expect(new CsvImporter().displayName).toBe('CSV');
  });

  test('supports xp data type', () => {
    expect(new CsvImporter().supportedData).toContain('xp');
  });
});

// ===========================================================================
// Valid CSV parsing
// ===========================================================================
describe('valid CSV parsing', () => {
  test('parses CSV with header row', async () => {
    const csv = `userId,xp,level,messages
123456789012345678,1000,3,50
234567890123456789,2000,5,100`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('parses CSV without header row', async () => {
    const csv = `123456789012345678,1000,3,50
234567890123456789,2000,5,100`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
  });

  test('stores parsed records in lastImportRecords', async () => {
    const csv = `userId,xp,level,messages
123456789012345678,1000,3,50`;
    const importer = createImporter(csv);
    await importer.import('guild1', 'xp');
    expect(importer.lastImportRecords).toHaveLength(1);
    expect(importer.lastImportRecords[0].userId).toBe('123456789012345678');
    expect(importer.lastImportRecords[0].xp).toBe(1000);
    expect(importer.lastImportRecords[0].level).toBe(3);
    expect(importer.lastImportRecords[0].messageCount).toBe(50);
  });

  test('handles zero XP and level', async () => {
    const csv = `123456789012345678,0,0,0`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
  });

  test('skips empty lines', async () => {
    const csv = `123456789012345678,1000,3,50

234567890123456789,2000,5,100
`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
  });

  test('trims whitespace from columns', async () => {
    const csv = `123456789012345678 , 1000 , 3 , 50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
  });

  test('handles case-insensitive header', async () => {
    const csv = `USERID,XP,LEVEL,MESSAGES
123456789012345678,1000,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
  });

  test('includes durationMs in result', async () => {
    const csv = `123456789012345678,1000,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// Invalid snowflake IDs
// ===========================================================================
describe('invalid snowflake IDs', () => {
  test('rejects non-numeric user ID', async () => {
    const csv = `notanumber,1000,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid user ID');
  });

  test('rejects too-short snowflake', async () => {
    const csv = `1234567890123456,1000,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid user ID');
  });

  test('rejects too-long snowflake', async () => {
    const csv = `123456789012345678901,1000,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
  });

  test('rejects snowflake with letters', async () => {
    const csv = `12345678901234567a,1000,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
  });
});

// ===========================================================================
// Invalid numeric values
// ===========================================================================
describe('invalid numeric values', () => {
  test('rejects non-numeric XP', async () => {
    const csv = `123456789012345678,abc,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid XP value');
  });

  test('rejects negative XP', async () => {
    const csv = `123456789012345678,-100,3,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid XP value');
  });

  test('rejects non-numeric level', async () => {
    const csv = `123456789012345678,1000,abc,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid level value');
  });

  test('rejects negative level', async () => {
    const csv = `123456789012345678,1000,-1,50`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid level value');
  });

  test('rejects non-numeric messages', async () => {
    const csv = `123456789012345678,1000,3,abc`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid messages value');
  });

  test('rejects negative messages', async () => {
    const csv = `123456789012345678,1000,3,-10`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Invalid messages value');
  });
});

// ===========================================================================
// Empty / header-only input
// ===========================================================================
describe('empty and edge case input', () => {
  test('returns failure for empty content', async () => {
    const importer = createImporter('');
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('empty');
  });

  test('returns failure for whitespace-only content', async () => {
    const importer = createImporter('   \n  \n  ');
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(false);
  });

  test('returns success with 0 imported for header-only CSV', async () => {
    const csv = `userId,xp,level,messages`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    // 0 imported and 0 failed = success true (no rows to fail)
    expect(result.success).toBe(true);
    expect(result.imported).toBe(0);
  });

  test('returns failure for unset csvContent', async () => {
    const importer = new CsvImporter();
    const result = await importer.import('guild1', 'xp');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('empty');
  });
});

// ===========================================================================
// Unsupported data type
// ===========================================================================
describe('unsupported data type', () => {
  test('rejects non-xp data type', async () => {
    const importer = createImporter('123456789012345678,1000,3,50');
    const result = await importer.import('guild1', 'roles');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Unsupported data type');
  });
});

// ===========================================================================
// Row errors
// ===========================================================================
describe('row-level errors', () => {
  test('reports too few columns', async () => {
    const csv = `123456789012345678,1000,3`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Expected 4 columns');
  });

  test('handles duplicate user IDs', async () => {
    const csv = `123456789012345678,1000,3,50
123456789012345678,2000,5,100`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toContain('Duplicate user ID');
  });

  test('continues processing after errors', async () => {
    const csv = `notasnowflake,1000,3,50
123456789012345678,2000,5,100
234567890123456789,abc,3,50
345678901234567890,3000,7,200`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.imported).toBe(2);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
  });

  test('extra columns are tolerated (only first 4 used)', async () => {
    const csv = `123456789012345678,1000,3,50,extra,columns`;
    const importer = createImporter(csv);
    const result = await importer.import('guild1', 'xp');
    expect(result.imported).toBe(1);
  });
});

// ===========================================================================
// Progress callback
// ===========================================================================
describe('progress callback', () => {
  test('calls onProgress for large imports', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => {
      const id = (100000000000000000n + BigInt(i)).toString();
      return `${id},${i * 10},1,${i}`;
    });
    const csv = `userId,xp,level,messages\n${lines.join('\n')}`;
    const importer = createImporter(csv);

    let progressCalled = false;
    await importer.import('guild1', 'xp', {
      onProgress: () => {
        progressCalled = true;
      },
    });
    expect(progressCalled).toBe(true);
  });
});
