/**
 * Raw API component helpers for Discord's new modal components.
 *
 * discord.js 14.25.1 does NOT have builder classes for RadioGroup, CheckboxGroup,
 * Checkbox, or Label yet. We construct raw API objects using discord-api-types enums.
 * When discord.js ships builders, this file becomes a mechanical find-and-replace.
 */

import type {
  APICheckboxComponent,
  APICheckboxGroupComponent,
  APICheckboxGroupOption,
  APILabelComponent,
  APIRadioGroupComponent,
  APIRadioGroupOption,
} from 'discord-api-types/v10';
import { ComponentType } from 'discord-api-types/v10';

export interface RadioOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

export interface CheckboxOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

/**
 * Create a RadioGroup component (ComponentType 21).
 * Users select exactly one option from 2-10 choices.
 */
export function radioGroup(customId: string, options: RadioOption[], required = true): APIRadioGroupComponent {
  return {
    type: ComponentType.RadioGroup,
    custom_id: customId,
    options: options as APIRadioGroupOption[],
    required,
  };
}

/**
 * Create a CheckboxGroup component (ComponentType 22).
 * Users select multiple options from up to 10 choices.
 */
export function checkboxGroup(
  customId: string,
  options: CheckboxOption[],
  minValues?: number,
  maxValues?: number,
  required?: boolean,
): APICheckboxGroupComponent {
  // Discord requires required=false when min_values is 0
  const isRequired = required ?? (minValues === 0 ? false : true);
  const component: APICheckboxGroupComponent = {
    type: ComponentType.CheckboxGroup,
    custom_id: customId,
    options: options as APICheckboxGroupOption[],
    required: isRequired,
  };
  if (minValues !== undefined) component.min_values = minValues;
  if (maxValues !== undefined) component.max_values = maxValues;
  return component;
}

/**
 * Create a single Checkbox component (ComponentType 23).
 * A standalone true/false toggle. The label is set on the parent Label wrapper.
 */
export function checkbox(customId: string, defaultValue?: boolean): APICheckboxComponent {
  return {
    type: ComponentType.Checkbox,
    custom_id: customId,
    default: defaultValue,
  };
}

/**
 * Wrap a component in a Label (ComponentType 18).
 * All new modal components (radio, checkbox, checkbox group, select menus)
 * MUST be wrapped in a Label when used inside modals.
 * Max 45 chars for label, max 100 chars for description.
 */
export function labelWrap(
  label: string,
  component: APILabelComponent['component'],
  description?: string,
): APILabelComponent {
  const wrapper: APILabelComponent = {
    type: ComponentType.Label,
    label,
    component,
  };
  if (description) wrapper.description = description;
  return wrapper;
}

/**
 * Create a Channel Select component for use in modals.
 * Allows users to pick a channel from the guild.
 */
export function channelSelect(
  customId: string,
  channelTypes?: number[],
  required = true,
): APILabelComponent['component'] {
  const component: any = {
    type: ComponentType.ChannelSelect,
    custom_id: customId,
  };
  if (channelTypes) component.channel_types = channelTypes;
  if (!required) component.required = false;
  return component;
}

/**
 * Create a Role Select component for use in modals.
 * Allows users to pick a role from the guild.
 */
export function roleSelect(customId: string, required = true): APILabelComponent['component'] {
  const component: any = {
    type: ComponentType.RoleSelect,
    custom_id: customId,
  };
  if (!required) component.required = false;
  return component;
}

/**
 * Build a raw modal object for use with interaction.showModal().
 * Use this instead of ModalBuilder when using new component types.
 * Max 5 top-level components per modal.
 */
export function rawModal(customId: string, title: string, components: APILabelComponent[]) {
  return {
    custom_id: customId,
    title,
    components,
  };
}
