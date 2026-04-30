import { AppDataSource } from '../../typeorm';
import type { CustomInputField } from '../../typeorm/entities/shared/CustomInputField';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/**
 * Default ticket-type seed data — used when a guild's `CustomTicketType`
 * table is empty. Lives at module top (rather than inside the function
 * body) so the data is one diff away from the schema and the function body
 * stays readable. Each entry is `Omit<CustomTicketType, 'guildId'>`; the
 * guildId is supplied per-row at insert time.
 */
type DefaultTicketTypeSeed = {
  typeId: string;
  displayName: string;
  emoji: string;
  embedColor: string;
  description: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  customFields: CustomInputField[];
};

const DEFAULT_TICKET_TYPE_SEEDS: DefaultTicketTypeSeed[] = [
  {
    typeId: 'ban_appeal',
    displayName: 'Ban Appeal',
    emoji: '⚖️',
    embedColor: '#ff6b6b',
    description: 'Submit an appeal for a ban or suspension',
    isActive: true,
    isDefault: false,
    sortOrder: 1,
    customFields: [
      {
        id: 'banned_user',
        label: 'What is the username of the banned user?',
        style: 'short',
        placeholder: 'e.g., Player123',
        required: true,
        minLength: 2,
        maxLength: 100,
      },
      {
        id: 'ban_reason',
        label: 'What was the reason for the ban?',
        style: 'paragraph',
        placeholder: 'Explain what you were banned for...',
        required: true,
        minLength: 10,
        maxLength: 1000,
      },
      {
        id: 'appeal_reason',
        label: 'Why should the ban be appealed?',
        style: 'paragraph',
        placeholder: 'Explain why you think the ban should be lifted...',
        required: true,
        minLength: 20,
        maxLength: 2000,
      },
    ],
  },
  {
    typeId: 'player_report',
    displayName: 'Player Report',
    emoji: '📢',
    embedColor: '#ffd93d',
    description: 'Report a player for rule violations',
    isActive: true,
    isDefault: false,
    sortOrder: 2,
    customFields: [
      {
        id: 'reported_player',
        label: 'Who are you reporting?',
        style: 'short',
        placeholder: 'Player name or ID',
        required: true,
        minLength: 2,
        maxLength: 100,
      },
      {
        id: 'violation',
        label: 'What rule did they violate?',
        style: 'short',
        placeholder: 'e.g., Harassment, Cheating, Griefing',
        required: true,
        minLength: 3,
        maxLength: 100,
      },
      {
        id: 'report_details',
        label: 'Please provide details about the incident',
        style: 'paragraph',
        placeholder: 'What happened? When? Where? Include any relevant details...',
        required: true,
        minLength: 20,
        maxLength: 2000,
      },
      {
        id: 'evidence',
        label: 'Evidence (Screenshots, URLs, etc.)',
        style: 'paragraph',
        placeholder: 'Paste links to screenshots, videos, or other evidence...',
        required: false,
        maxLength: 500,
      },
    ],
  },
  {
    typeId: 'bug_report',
    displayName: 'Bug Report',
    emoji: '🐛',
    embedColor: '#6bcf7f',
    description: 'Report a bug or technical issue',
    isActive: true,
    isDefault: false,
    sortOrder: 3,
    customFields: [
      {
        id: 'bug_summary',
        label: 'Brief summary of the bug',
        style: 'short',
        placeholder: 'e.g., Game crashes when opening inventory',
        required: true,
        minLength: 10,
        maxLength: 100,
      },
      {
        id: 'steps_to_reproduce',
        label: 'Steps to reproduce',
        style: 'paragraph',
        placeholder: '1. Go to...\n2. Click on...\n3. Observe...',
        required: true,
        minLength: 20,
        maxLength: 1000,
      },
      {
        id: 'expected_behavior',
        label: 'What should happen?',
        style: 'paragraph',
        placeholder: 'Describe the expected behavior...',
        required: true,
        minLength: 10,
        maxLength: 500,
      },
      {
        id: 'actual_behavior',
        label: 'What actually happens?',
        style: 'paragraph',
        placeholder: 'Describe what actually occurs...',
        required: true,
        minLength: 10,
        maxLength: 500,
      },
    ],
  },
  {
    typeId: '18_verify',
    displayName: '18+ Verification',
    emoji: '🔞',
    embedColor: '#a29bfe',
    description: 'Verify your age for 18+ content',
    isActive: true,
    isDefault: false,
    sortOrder: 4,
    customFields: [
      {
        id: 'age_confirmation',
        label: 'Please confirm you are 18 years or older',
        style: 'short',
        placeholder: 'Type "I am 18 or older"',
        required: true,
        minLength: 10,
        maxLength: 100,
      },
      {
        id: 'verification_method',
        label: 'Preferred verification method',
        style: 'paragraph',
        placeholder: 'How would you like to verify? (ID photo, date of birth, etc.)',
        required: true,
        minLength: 10,
        maxLength: 500,
      },
    ],
  },
  {
    typeId: 'other',
    displayName: 'Other',
    emoji: '❓',
    embedColor: '#0099ff',
    description: 'General support or other inquiries',
    isActive: true,
    isDefault: true,
    sortOrder: 5,
    customFields: [
      {
        id: 'subject',
        label: 'Subject',
        style: 'short',
        placeholder: 'Brief subject of your ticket',
        required: true,
        minLength: 5,
        maxLength: 100,
      },
      {
        id: 'description',
        label: 'Please describe your issue or question',
        style: 'paragraph',
        placeholder: 'Provide as much detail as possible...',
        required: true,
        minLength: 20,
        maxLength: 2000,
      },
    ],
  },
];

/**
 * Ensures a guild has default custom ticket types.
 * Auto-creates the seeds in `DEFAULT_TICKET_TYPE_SEEDS` if the guild has none
 * configured. Safe to call multiple times — only seeds when missing.
 */
export async function ensureDefaultTicketTypes(guildId: string): Promise<void> {
  try {
    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const existingCount = await typeRepo.count({ where: { guildId } });
    if (existingCount > 0) return;

    for (const seed of DEFAULT_TICKET_TYPE_SEEDS) {
      const type = typeRepo.create({ guildId, ...seed });
      await typeRepo.save(type);
    }

    enhancedLogger.info(`Created default ticket types for guild ${guildId}`, LogCategory.DATABASE, {
      guildId,
      count: DEFAULT_TICKET_TYPE_SEEDS.length,
    });
  } catch (error) {
    enhancedLogger.error(
      `Failed to create default ticket types for guild ${guildId}`,
      error as Error,
      LogCategory.DATABASE,
    );
    throw error;
  }
}
