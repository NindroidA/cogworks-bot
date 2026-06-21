#!/usr/bin/env bun
/**
 * Generate `contract/cogworks-contract.json` — the single source of truth the
 * dashboard (ninsys-apps) and BFF (ninsys-api) codegen their types from.
 *
 * Everything here is derived from REAL bot code (no hand-maintenance), so the
 * contract can't silently drift from what the bot actually does:
 *   - `commands`       — the registered slash-command JSON (`c.toJSON()`)
 *   - `features`       — the FEATURES permission catalog + LEVELS
 *   - `configSchemas`  — the `applyFields` descriptor lists (bait-channel today;
 *                        more features as their PATCH handlers adopt descriptors)
 *
 * Run: `bun run build:contract`. Output is committed; `bun run check:contract`
 * (CI) regenerates and fails on any diff, so a bot change not reflected in the
 * contract breaks the build.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { version as botVersion } from '../package.json';
import { BAIT_CONFIG_FIELDS } from '../src/utils/api/handlers/baitChannelHandlers';
import { FEATURES, LEVELS } from '../src/utils/validation/featurePermission';

async function main() {
  // Pin RELEASE so the command set is deterministic (no dev-only commands).
  // commandList snapshots RELEASE at module load, so import it AFTER setting it.
  process.env.RELEASE = 'prod';
  const { commands } = await import('../src/commands/commandList');

  const commandJson = commands.map((c: unknown) => {
    const maybe = c as { toJSON?: () => unknown };
    return typeof maybe.toJSON === 'function' ? maybe.toJSON() : c;
  });

  const contract = {
    contractVersion: '1',
    botVersion,
    features: { keys: [...FEATURES], levels: [...LEVELS] },
    commands: commandJson,
    configSchemas: {
      baitChannel: { fields: BAIT_CONFIG_FIELDS },
    },
  };

  const dir = join(process.cwd(), 'contract');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cogworks-contract.json'), `${JSON.stringify(contract, null, 2)}\n`);

  console.log(
    `contract written: botVersion=${botVersion}, commands=${commandJson.length}, ` +
      `features=${FEATURES.length}, configSchemas=baitChannel(${BAIT_CONFIG_FIELDS.length} fields)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
