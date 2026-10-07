import { describe, expect, test } from 'bun:test';
import { IsNull } from 'typeorm';
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

  test('IsNull() matches null and missing columns, a raw null only null', async () => {
    const repo = makeFakeRepo([
      { id: 1, guildId: 'g', roleId: null },
      { id: 2, guildId: 'g' },
      { id: 3, guildId: 'g', roleId: 'r' },
    ]);
    expect((await repo.findBy({ guildId: 'g', roleId: IsNull() })).map(r => r.id)).toEqual([1, 2]);
    expect((await repo.findBy({ roleId: null })).map(r => r.id)).toEqual([1]);
    expect(await repo.update({ id: 3, roleId: IsNull() }, { roleId: 'x' })).toEqual({ affected: 0 });
    expect(await repo.delete({ id: 1, roleId: IsNull() })).toEqual({ affected: 1 });
    expect(await repo.findOne({ where: { id: 2, roleId: IsNull() }, lock: { mode: 'pessimistic_write' } })).toEqual({
      id: 2,
      guildId: 'g',
    });
    expect(repo.calls.findOne[0].lock).toEqual({ mode: 'pessimistic_write' });
  });
});
