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
/**
 * The longest custom id prefix each step type sends (`sendStep` in `onboardingEngine.ts`), or null
 * when it sends no components: a role-select step without options and an unknown type.
 */
function longestIdPrefix(step: Partial<OnboardingStepDef>): string | null {
  switch (step.type) {
    case 'message':
    case 'channel-suggest':
    case 'custom-question':
      return 'onboarding_continue_'; // and onboarding_skip_
    case 'rules-accept':
      return 'onboarding_accept_';
    case 'role-select':
      // onboarding_roleselect_ and onboarding_skip_ are shorter.
      return Array.isArray(step.options) && step.options.length > 0 ? 'onboarding_confirmrole_' : null;
    default:
      return null;
  }
}
/** Discord caps custom ids at 100 characters. */
const idTooLong = (step: Partial<OnboardingStepDef>, id: string) => {
  const prefix = longestIdPrefix(step);
  return prefix !== null && prefix.length + id.length > 100;
};
/** Discord's embed description limit, which the welcome DM's text goes into. */
const EMBED_DESCRIPTION = 4096;
/** Display names (nickname or global name) are at most 32 characters. */
const LONGEST_NAME = 'x'.repeat(32);
/** The welcome text as `sendWelcomeMessage` renders it. */
const renderWelcome = (text: string, server: string, user: string) =>
  text.replace(/{server}/g, server).replace(/{user}/g, user);
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
    // The stored text is at most 2000 characters, but {server} (the server name, up to 100) and
    // {user} (the member's display name) can push the rendered embed past 4096: then the welcome
    // DM fails and onboarding never starts. For everyone, or only for members with long names.
    const welcome = String(row.welcomeMessage ?? '');
    const shortest = renderWelcome(welcome, ctx.guild.name, 'x').length;
    const longest = renderWelcome(welcome, ctx.guild.name, LONGEST_NAME).length;
    if (longest > EMBED_DESCRIPTION) {
      const severity = shortest > EMBED_DESCRIPTION ? 'block' : 'degraded';
      out.push(emit('welcome_too_long', severity, 'manual', at('welcomeMessage', { length: longest })));
    }
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
