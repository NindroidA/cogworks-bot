import { describe, expect, test } from 'bun:test';
import { makeFakeRepo, writeCallCount } from './fakeRepo';

describe('makeFakeRepo', () => {
  test('shouldThrowOn set after creation makes that method reject', async () => {
    const repo = makeFakeRepo([{ id: 1, guildId: 'g' }]);
    repo.shouldThrowOn = 'findOneBy';
    await expect(repo.findOneBy({ guildId: 'g' })).rejects.toThrow('boom-findOneBy');
    expect(repo.findOneByCalls).toEqual([{ guildId: 'g' }]);
    expect(await repo.find({ where: { guildId: 'g' } })).toEqual([{ id: 1, guildId: 'g' }]);
  });

  test('counts every write method, reads count as zero', async () => {
    const repo = makeFakeRepo([{ id: 1, guildId: 'g', v: 1 }]);
    await repo.find({ where: { guildId: 'g' } });
    await repo.count({ where: { guildId: 'g' } });
    expect(writeCallCount(repo)).toBe(0);

    await repo.update({ id: 1 }, { v: 2 });
    expect(repo.rows.get('1').v).toBe(2);
    await repo.insert({ id: 2, guildId: 'g' });
    await repo.save({ id: 3, guildId: 'g' });
    await repo.delete({ id: 2 });
    await repo.remove({ id: 3 });
    expect(writeCallCount(repo)).toBe(5);
    expect([...repo.rows.keys()]).toEqual(['1']);
  });
});
