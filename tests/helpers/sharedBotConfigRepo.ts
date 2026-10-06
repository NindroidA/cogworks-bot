/**
 * One BotConfig repository stub shared by every suite that drives the real
 * command dispatcher.
 *
 * `src/commands/commands.ts` holds `lazyRepo(BotConfig)` at module scope, and
 * lazyRepo caches whatever `AppDataSource.getRepository` returned the first
 * time. If each suite patched getRepository with its own fake, the suite that
 * ran first would win and the others' fakes would never be consulted. Every
 * suite therefore returns this same object and swaps its behaviour with
 * `setBotConfigFindOneBy` in its own beforeAll.
 */
type FindOneBy = (where: { guildId: string }) => Promise<unknown>;

let impl: FindOneBy = async () => null;

export const sharedBotConfigRepo = {
  findOneBy: (where: { guildId: string }) => impl(where),
  findOne: async () => null,
  find: async () => [],
  create: (row: unknown) => row,
  save: async (row: unknown) => row,
};

export function setBotConfigFindOneBy(fn: FindOneBy): void {
  impl = fn;
}
