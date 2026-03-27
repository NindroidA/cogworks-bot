/**
 * Onboarding step type definitions.
 *
 * Each step appears in the DM onboarding flow.
 * Steps are stored as simple-json on OnboardingConfig.
 */

export type OnboardingStepType = 'message' | 'role-select' | 'channel-suggest' | 'rules-accept' | 'custom-question';

export interface OnboardingRoleOption {
  label: string;
  roleId: string;
  emoji?: string;
}

export interface OnboardingStepDef {
  /** Unique identifier for this step (e.g. "welcome", "interests") */
  id: string;
  /** Step type determines the UI presented to the user */
  type: OnboardingStepType;
  /** Display title shown at the top of the step embed */
  title: string;
  /** Description text shown in the embed body */
  description: string;
  /** Options for role-select steps */
  options?: OnboardingRoleOption[];
  /** Whether the user must complete this step to proceed */
  required: boolean;
}
