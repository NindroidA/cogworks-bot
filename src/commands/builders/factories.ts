/**
 * Builder option factories
 *
 * Collapse the repeated channel-option and action-choice scaffolding shared
 * across command builders. Each helper sets only the fields the call sites
 * actually varied (name/description/required, choices), so the generated
 * command JSON is byte-identical to the hand-written option blocks they replace.
 */
import { ChannelType, type SlashCommandChannelOption, type SlashCommandStringOption } from 'discord.js';

interface ChannelOptionConfig {
  /** Option name — defaults to 'channel'. */
  name?: string;
  description: string;
  /**
   * Only emitted when defined. Omitting it leaves `required` off the option
   * (matching a bare `.addChannelTypes(...)` block), which is distinct JSON
   * from an explicit `.setRequired(false)`.
   */
  required?: boolean;
}

function applyChannelOption(
  option: SlashCommandChannelOption,
  type: ChannelType.GuildText | ChannelType.GuildForum,
  { name = 'channel', description, required }: ChannelOptionConfig,
): SlashCommandChannelOption {
  option.setName(name).setDescription(description).addChannelTypes(type);
  if (required !== undefined) {
    option.setRequired(required);
  }
  return option;
}

/** A `GuildText` channel option. */
export function createTextChannelOption(
  option: SlashCommandChannelOption,
  config: ChannelOptionConfig,
): SlashCommandChannelOption {
  return applyChannelOption(option, ChannelType.GuildText, config);
}

/** A `GuildForum` channel option. */
export function createForumChannelOption(
  option: SlashCommandChannelOption,
  config: ChannelOptionConfig,
): SlashCommandChannelOption {
  return applyChannelOption(option, ChannelType.GuildForum, config);
}

interface ActionOptionConfig {
  description: string;
  choices: { name: string; value: string }[];
  /** Defaults to true — every current action option is required. */
  required?: boolean;
}

/** A required `action` string option carrying a fixed choice set. */
export function createActionOption(
  option: SlashCommandStringOption,
  { description, choices, required = true }: ActionOptionConfig,
): SlashCommandStringOption {
  return option
    .setName('action')
    .setDescription(description)
    .addChoices(...choices)
    .setRequired(required);
}
