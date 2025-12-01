import { AppDataSource } from '../../typeorm';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/**
 * Ensures a guild has default custom ticket types
 * Auto-creates 5 default types if guild has none configured
 * Safe to call multiple times - only creates if missing
 */
export async function ensureDefaultTicketTypes(guildId: string): Promise<void> {
    try {
        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        // Check if guild already has types
        const existingCount = await typeRepo.count({ where: { guildId } });

        if (existingCount > 0) {
            return; // Guild already has custom types
        }

        // Create default types based on legacy system with custom input fields
        const defaultTypes = [
            {
                guildId,
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
                        style: 'short' as const,
                        placeholder: 'e.g., Player123',
                        required: true,
                        minLength: 2,
                        maxLength: 100
                    },
                    {
                        id: 'ban_reason',
                        label: 'What was the reason for the ban?',
                        style: 'paragraph' as const,
                        placeholder: 'Explain what you were banned for...',
                        required: true,
                        minLength: 10,
                        maxLength: 1000
                    },
                    {
                        id: 'appeal_reason',
                        label: 'Why should the ban be appealed?',
                        style: 'paragraph' as const,
                        placeholder: 'Explain why you think the ban should be lifted...',
                        required: true,
                        minLength: 20,
                        maxLength: 2000
                    }
                ]
            },
            {
                guildId,
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
                        style: 'short' as const,
                        placeholder: 'Player name or ID',
                        required: true,
                        minLength: 2,
                        maxLength: 100
                    },
                    {
                        id: 'violation',
                        label: 'What rule did they violate?',
                        style: 'short' as const,
                        placeholder: 'e.g., Harassment, Cheating, Griefing',
                        required: true,
                        minLength: 3,
                        maxLength: 100
                    },
                    {
                        id: 'report_details',
                        label: 'Please provide details about the incident',
                        style: 'paragraph' as const,
                        placeholder: 'What happened? When? Where? Include any relevant details...',
                        required: true,
                        minLength: 20,
                        maxLength: 2000
                    },
                    {
                        id: 'evidence',
                        label: 'Evidence (Screenshots, URLs, etc.)',
                        style: 'paragraph' as const,
                        placeholder: 'Paste links to screenshots, videos, or other evidence...',
                        required: false,
                        maxLength: 500
                    }
                ]
            },
            {
                guildId,
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
                        style: 'short' as const,
                        placeholder: 'e.g., Game crashes when opening inventory',
                        required: true,
                        minLength: 10,
                        maxLength: 100
                    },
                    {
                        id: 'steps_to_reproduce',
                        label: 'Steps to reproduce',
                        style: 'paragraph' as const,
                        placeholder: '1. Go to...\n2. Click on...\n3. Observe...',
                        required: true,
                        minLength: 20,
                        maxLength: 1000
                    },
                    {
                        id: 'expected_behavior',
                        label: 'What should happen?',
                        style: 'paragraph' as const,
                        placeholder: 'Describe the expected behavior...',
                        required: true,
                        minLength: 10,
                        maxLength: 500
                    },
                    {
                        id: 'actual_behavior',
                        label: 'What actually happens?',
                        style: 'paragraph' as const,
                        placeholder: 'Describe what actually occurs...',
                        required: true,
                        minLength: 10,
                        maxLength: 500
                    }
                ]
            },
            {
                guildId,
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
                        style: 'short' as const,
                        placeholder: 'Type "I am 18 or older"',
                        required: true,
                        minLength: 10,
                        maxLength: 100
                    },
                    {
                        id: 'verification_method',
                        label: 'Preferred verification method',
                        style: 'paragraph' as const,
                        placeholder: 'How would you like to verify? (ID photo, date of birth, etc.)',
                        required: true,
                        minLength: 10,
                        maxLength: 500
                    }
                ]
            },
            {
                guildId,
                typeId: 'other',
                displayName: 'Other',
                emoji: '❓',
                embedColor: '#0099ff',
                description: 'General support or other inquiries',
                isActive: true,
                isDefault: true, // Set as default
                sortOrder: 5,
                customFields: [
                    {
                        id: 'subject',
                        label: 'Subject',
                        style: 'short' as const,
                        placeholder: 'Brief subject of your ticket',
                        required: true,
                        minLength: 5,
                        maxLength: 100
                    },
                    {
                        id: 'description',
                        label: 'Please describe your issue or question',
                        style: 'paragraph' as const,
                        placeholder: 'Provide as much detail as possible...',
                        required: true,
                        minLength: 20,
                        maxLength: 2000
                    }
                ]
            }
        ];

        for (const typeData of defaultTypes) {
            const type = typeRepo.create(typeData);
            await typeRepo.save(type);
        }

        enhancedLogger.info(
            `Created default ticket types for guild ${guildId}`,
            LogCategory.DATABASE,
            { guildId, count: defaultTypes.length }
        );
    } catch (error) {
        enhancedLogger.error(
            `Failed to create default ticket types for guild ${guildId}`,
            error as Error,
            LogCategory.DATABASE
        );
        throw error;
    }
}

