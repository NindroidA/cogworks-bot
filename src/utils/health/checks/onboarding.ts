/**
 * Onboarding health check (design inventory §3.7): the completion role and the
 * DM steps. `steps` is a JSON column the dashboard writes, so its shape isn't trusted.
 */
import type { OnboardingStepDef } from '../../onboarding/types';
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import type { HealthCheck, HealthFinding } from '../types';
import { assignableRoleFindings, botLacks, roleNames } from './featureRefs';

const STEP_TYPES = new Set(['message', 'role-select', 'channel-suggest', 'rules-accept', 'custom-question']);
/** Discord caps custom ids at 100; role-select steps build the longest (`onboarding_confirmrole_<id>`). */
const idTooLong = (step: Partial<OnboardingStepDef>, id: string) =>
  (step.type === 'role-select' ? 'onboarding_confirmrole_' : 'onboarding_continue_').length + id.length > 100;
/** The roleDelete cleaner nulls a deleted completion role; a deleted step role is lossless to drop. */
const DELETED_ROLE = { severity: 'degraded', repair: 'auto' } as const;

const config = defineCheck(
  {
    id: 'onboarding.config',
    system: 'onboarding',
    entities: ['OnboardingConfig'],
    names: [
      'no_steps',
      'welcome_too_long',
      'no_manage_roles',
      ...roleNames('completion_role'),
      'step_duplicate_id',
      'step_unknown_type',
      'step_id_too_long',
      'step_too_many_options',
      'step_duplicate_role',
      ...roleNames('step_role'),
    ],
    isConfigured: ctx => rowsOf(ctx, 'OnboardingConfig')[0]?.enabled === true,
  },
  (ctx, emit) => {
    const row = rowsOf(ctx, 'OnboardingConfig')[0];
    if (!row?.enabled) return [];
    const at = (field: string, params = {}): FindingTarget => ({
      entity: 'OnboardingConfig',
      rowId: row.id,
      field,
      params,
    });
    const out: HealthFinding[] = [];
    const steps: unknown = row.steps;
    const list = Array.isArray(steps) ? (steps as Partial<OnboardingStepDef>[]) : [];
    // With no steps the engine skips the whole flow, completion role included.
    if (list.length === 0) out.push(emit('no_steps', 'block', 'manual', at('steps')));
    // /onboarding allows 2000 characters; past 4096 (the embed limit) the welcome DM fails and the flow stops.
    const welcomeLength = String(row.welcomeMessage ?? '').length;
    if (welcomeLength > 2000)
      out.push(emit('welcome_too_long', welcomeLength > 4096 ? 'block' : 'cosmetic', 'manual', at('welcomeMessage')));
    const completion = row.completionRoleId;
    if (completion)
      out.push(
        ...assignableRoleFindings(ctx, emit, 'completion_role', completion, at('completionRoleId'), DELETED_ROLE),
      );

    let grantsRoles = Boolean(completion);
    const seenIds = new Set<string>();
    list.forEach((step, index) => {
      const stepId = String(step?.id ?? '');
      const stepAt = at('steps', { stepId, step: index + 1 });
      // A step that can't be sent stops the flow when it's required and is skipped otherwise.
      const unsendable = step?.required ? 'block' : 'degraded';
      // Completed ids are skipped, so a second step with the same id never shows.
      if (seenIds.has(stepId)) out.push(emit('step_duplicate_id', 'degraded', 'manual', stepAt));
      seenIds.add(stepId);
      const type = String(step?.type);
      if (!STEP_TYPES.has(type))
        out.push(emit('step_unknown_type', unsendable, 'manual', at('steps', { ...stepAt.params, type })));
      if (idTooLong(step ?? {}, stepId)) out.push(emit('step_id_too_long', unsendable, 'manual', stepAt));
      if (type !== 'role-select' || !Array.isArray(step.options)) return;

      // Select menus take at most 25 options with unique values (the role ids).
      if (step.options.length > 25) out.push(emit('step_too_many_options', unsendable, 'manual', stepAt));
      const roleIds = step.options.map(option => String(option?.roleId ?? ''));
      if (new Set(roleIds).size < roleIds.length) out.push(emit('step_duplicate_role', unsendable, 'manual', stepAt));
      grantsRoles ||= roleIds.length > 0;
      // roleDelete doesn't clean step options: a deleted role stays listed and does nothing when picked.
      for (const roleId of new Set(roleIds))
        out.push(...assignableRoleFindings(ctx, emit, 'step_role', roleId, stepAt, DELETED_ROLE));
    });

    // Role grants fail silently (debug log only) without ManageRoles.
    if (grantsRoles && botLacks(ctx, 'ManageRoles'))
      out.push(emit('no_manage_roles', 'degraded', 'manual', at('steps')));
    return out;
  },
);

export const ONBOARDING_CHECKS: readonly HealthCheck[] = [config];
