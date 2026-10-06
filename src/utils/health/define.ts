import type { CheckContext, HealthEntityName } from './context';
import type { HealthCheck, HealthFinding, HealthSeverity, HealthSystem, RepairClass } from './types';

/** Where a finding points: the entity plus optional row, column, Discord id and lang params. */
export type FindingTarget = Pick<HealthFinding, 'entity'> &
  Partial<Pick<HealthFinding, 'rowId' | 'field' | 'refId' | 'params'>>;

/** Builds one finding of the check: `emit('missing', ...)` yields the code `<check id>.missing`. */
export type Emit<N extends string> = (
  name: N,
  severity: HealthSeverity,
  repair: RepairClass,
  at: FindingTarget,
) => HealthFinding;

interface CheckMeta<N extends string> {
  id: string;
  system: HealthSystem;
  entities: HealthEntityName[];
  /** Every finding the check can emit. Typed, so `emit` only accepts these, and each needs a lang string. */
  names: readonly N[];
  isConfigured?: (ctx: CheckContext) => boolean;
}

export function defineCheck<N extends string>(
  meta: CheckMeta<N>,
  run: (ctx: CheckContext, emit: Emit<N>) => HealthFinding[] | Promise<HealthFinding[]>,
): HealthCheck {
  const { id, system, entities, names, isConfigured } = meta;
  const emit: Emit<N> = (name, severity, repair, at) => ({
    code: `${id}.${name}`,
    system,
    severity,
    repair,
    params: {},
    ...at,
  });
  return { id, system, entities, codes: names.map(name => `${id}.${name}`), run: ctx => run(ctx, emit), isConfigured };
}
