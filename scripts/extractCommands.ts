#!/usr/bin/env bun
/**
 * Extract Commands Script
 *
 * Extracts command metadata from the bot's builder files and language files
 * to generate documentation for the Cogworks webapp.
 *
 * Usage: bun run scripts/extractCommands.ts
 * Output: dist/commands.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = process.cwd();
const LANG_DIR = join(ROOT_DIR, 'src', 'lang');
const OUTPUT_DIR = join(ROOT_DIR, 'dist');

// Command interface matching webapp format
interface Command {
    name: string;
    description: string;
    usage: string;
    category: string;
    permissions: string[];
    examples: string[];
    subcommands?: Subcommand[];
}

interface Subcommand {
    name: string;
    description: string;
    usage: string;
}

// Load language files
function loadLangFile(filename: string): Record<string, any> {
    try {
        const filePath = join(LANG_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`Warning: Could not load ${filename}`);
        return {};
    }
}

// Map command names to categories
const categoryMap: Record<string, string> = {
    'bot-setup': 'Setup',
    'ticket-setup': 'Setup',
    'application-setup': 'Setup',
    'announcement-setup': 'Setup',
    'ticket': 'Tickets',
    'application': 'Applications',
    'announcement': 'Announcements',
    'baitchannel': 'Bait Channel',
    'role': 'Roles',
    'memory': 'Memory',
    'ping': 'General',
    'coffee': 'General',
    'data-export': 'General',
    'dev': 'Admin',
    'migrate': 'Admin',
};

// Map command names to permissions
const permissionMap: Record<string, string[]> = {
    'bot-setup': ['Administrator'],
    'ticket-setup': ['Administrator'],
    'application-setup': ['Administrator'],
    'announcement-setup': ['Administrator'],
    'ticket': ['Manage Channels'],
    'application': ['Administrator'],
    'announcement': ['Manage Messages'],
    'baitchannel': ['Administrator'],
    'role': ['Administrator'],
    'memory': ['Administrator'],
    'ping': [],
    'coffee': [],
    'data-export': [],
    'dev': ['Administrator'],
    'migrate': ['Administrator'],
};

// Extract commands from language files and builder metadata
function extractCommands(): Command[] {
    const commands: Command[] = [];

    // Load all language files
    const general = loadLangFile('general.json');
    const ticket = loadLangFile('ticket.json');
    const application = loadLangFile('application.json');
    const announcement = loadLangFile('announcement.json');
    const baitChannel = loadLangFile('baitChannel.json');
    const roles = loadLangFile('roles.json');
    const botSetup = loadLangFile('botSetup.json');
    const dev = loadLangFile('dev.json');
    const dataExport = loadLangFile('dataExport.json');
    const memory = loadLangFile('memory.json');

    // Ping command
    if (general.ping) {
        commands.push({
            name: 'ping',
            description: general.ping.cmdDescrp || 'Check bot latency and status',
            usage: '/ping',
            category: 'General',
            permissions: [],
            examples: ['/ping'],
        });
    }

    // Coffee command
    if (general.coffee) {
        commands.push({
            name: 'coffee',
            description: general.coffee.cmdDescrp || 'Support Cogworks development',
            usage: '/coffee',
            category: 'General',
            permissions: [],
            examples: ['/coffee'],
        });
    }

    // Memory command
    if (memory.builder) {
        const subcommands: Subcommand[] = [
            { name: 'setup', description: 'Set up the memory system', usage: '/memory setup [channel]' },
            { name: 'add', description: 'Add a new memory item', usage: '/memory add' },
            { name: 'capture', description: 'Capture a message as memory item', usage: '/memory capture <message_link>' },
            { name: 'tags', description: 'Manage memory tags', usage: '/memory tags <action>' },
        ];

        commands.push({
            name: 'memory',
            description: memory.builder?.cmdDescrp || 'Manage memory system for tracking bugs, features, and notes',
            usage: '/memory <subcommand>',
            category: 'Memory',
            permissions: ['Administrator'],
            examples: ['/memory setup', '/memory add', '/memory tags list'],
            subcommands,
        });
    }

    // Bot Setup command
    if (botSetup.builder) {
        commands.push({
            name: 'bot-setup',
            description: botSetup.builder?.cmdDescrp || 'Configure Cogworks for your server with an interactive setup wizard.',
            usage: '/bot-setup',
            category: 'Setup',
            permissions: ['Administrator'],
            examples: ['/bot-setup'],
        });
    }

    // Ticket Setup command
    if (ticket.setup) {
        commands.push({
            name: 'ticket-setup',
            description: ticket.setup?.builder?.cmdDescrp || 'Set up the ticket system for your server.',
            usage: '/ticket-setup',
            category: 'Setup',
            permissions: ['Administrator'],
            examples: ['/ticket-setup'],
        });
    }

    // Ticket command with subcommands
    if (ticket.customTypes) {
        const subcommands: Subcommand[] = [];
        const ct = ticket.customTypes;

        if (ct.typeAdd) subcommands.push({ name: 'type-add', description: ct.typeAdd.cmdDescrp || 'Add a custom ticket type', usage: '/ticket type-add' });
        if (ct.typeEdit) subcommands.push({ name: 'type-edit', description: ct.typeEdit.cmdDescrp || 'Edit a ticket type', usage: '/ticket type-edit <type>' });
        if (ct.typeList) subcommands.push({ name: 'type-list', description: ct.typeList?.cmdDescrp || 'List all ticket types', usage: '/ticket type-list' });
        if (ct.typeToggle) subcommands.push({ name: 'type-toggle', description: ct.typeToggle?.cmdDescrp || 'Toggle a ticket type', usage: '/ticket type-toggle <type>' });
        if (ct.typeDefault) subcommands.push({ name: 'type-default', description: ct.typeDefault?.cmdDescrp || 'Set default ticket type', usage: '/ticket type-default <type>' });
        if (ct.typeRemove) subcommands.push({ name: 'type-remove', description: ct.typeRemove?.cmdDescrp || 'Remove a ticket type', usage: '/ticket type-remove <type>' });

        commands.push({
            name: 'ticket',
            description: 'Manage custom ticket types and import email tickets.',
            usage: '/ticket <subcommand>',
            category: 'Tickets',
            permissions: ['Administrator'],
            examples: ['/ticket type-add', '/ticket type-list'],
            subcommands,
        });
    }

    // Application Setup command
    if (application.setup) {
        commands.push({
            name: 'application-setup',
            description: application.setup?.builder?.cmdDescrp || 'Set up the application system.',
            usage: '/application-setup',
            category: 'Setup',
            permissions: ['Administrator'],
            examples: ['/application-setup'],
        });
    }

    // Application command with position subcommand group
    if (application.position) {
        const subcommands: Subcommand[] = [
            { name: 'position add', description: 'Add a new application position', usage: '/application position add' },
            { name: 'position remove', description: 'Remove an application position', usage: '/application position remove <id>' },
            { name: 'position toggle', description: 'Toggle position availability', usage: '/application position toggle <id>' },
            { name: 'position list', description: 'List all positions', usage: '/application position list' },
            { name: 'position refresh', description: 'Refresh position message', usage: '/application position refresh' },
        ];

        commands.push({
            name: 'application',
            description: 'Manage application system and positions.',
            usage: '/application position <subcommand>',
            category: 'Applications',
            permissions: ['Administrator'],
            examples: ['/application position add', '/application position list'],
            subcommands,
        });
    }

    // Announcement Setup command
    if (announcement.setup) {
        commands.push({
            name: 'announcement-setup',
            description: announcement.setup?.builder?.cmdDescrp || 'Set up the announcement system.',
            usage: '/announcement-setup',
            category: 'Setup',
            permissions: ['Administrator'],
            examples: ['/announcement-setup'],
        });
    }

    // Announcement command with subcommands
    if (announcement.builder) {
        const subcommands: Subcommand[] = [
            { name: 'maintenance', description: 'Send a maintenance announcement', usage: '/announcement maintenance' },
            { name: 'maintenance-scheduled', description: 'Schedule maintenance announcement', usage: '/announcement maintenance-scheduled <time>' },
            { name: 'back-online', description: 'Send back online announcement', usage: '/announcement back-online' },
            { name: 'update-scheduled', description: 'Schedule update announcement', usage: '/announcement update-scheduled <time>' },
            { name: 'update-complete', description: 'Send update complete announcement', usage: '/announcement update-complete' },
        ];

        commands.push({
            name: 'announcement',
            description: announcement.builder?.cmdDescrp || 'Send various types of announcements.',
            usage: '/announcement <type>',
            category: 'Announcements',
            permissions: ['Manage Messages'],
            examples: ['/announcement maintenance', '/announcement back-online'],
            subcommands,
        });
    }

    // Bait Channel command
    if (baitChannel.builder) {
        const subcommands: Subcommand[] = [
            { name: 'setup', description: 'Set up bait channel detection', usage: '/baitchannel setup' },
            { name: 'detection', description: 'Configure detection settings', usage: '/baitchannel detection' },
            { name: 'whitelist', description: 'Manage whitelist', usage: '/baitchannel whitelist <add|remove>' },
            { name: 'status', description: 'View bait channel status', usage: '/baitchannel status' },
            { name: 'stats', description: 'View detection statistics', usage: '/baitchannel stats' },
            { name: 'toggle', description: 'Enable/disable bait channel', usage: '/baitchannel toggle' },
        ];

        commands.push({
            name: 'baitchannel',
            description: baitChannel.builder?.cmdDescrp || 'Configure bait channel honeypot system.',
            usage: '/baitchannel <subcommand>',
            category: 'Bait Channel',
            permissions: ['Administrator'],
            examples: ['/baitchannel setup', '/baitchannel status'],
            subcommands,
        });
    }

    // Role command (consolidated)
    if (roles.add || roles.remove || roles.get) {
        const subcommands: Subcommand[] = [
            { name: 'add staff', description: 'Add a staff role', usage: '/role add staff <role> <alias>' },
            { name: 'add admin', description: 'Add an admin role', usage: '/role add admin <role> <alias>' },
            { name: 'remove staff', description: 'Remove a staff role', usage: '/role remove staff <alias>' },
            { name: 'remove admin', description: 'Remove an admin role', usage: '/role remove admin <alias>' },
            { name: 'list', description: 'View configured staff and admin roles', usage: '/role list' },
        ];

        commands.push({
            name: 'role',
            description: 'Manage saved staff and admin roles.',
            usage: '/role <add|remove|list>',
            category: 'Roles',
            permissions: ['Administrator'],
            examples: ['/role add staff @Moderator mod', '/role list'],
            subcommands,
        });
    }

    // Data Export command
    if (dataExport.builder) {
        commands.push({
            name: 'data-export',
            description: dataExport.builder?.cmdDescrp || 'Export your personal data (GDPR compliance).',
            usage: '/data-export',
            category: 'General',
            permissions: [],
            examples: ['/data-export'],
        });
    }

    // Dev command (admin only)
    if (dev.builder) {
        const subcommands: Subcommand[] = [
            { name: 'bulk-close-tickets', description: 'Close all active tickets', usage: '/dev bulk-close-tickets' },
            { name: 'delete-archived-ticket', description: 'Delete archived ticket', usage: '/dev delete-archived-ticket <user>' },
            { name: 'delete-all-archived-tickets', description: 'Delete all archived tickets', usage: '/dev delete-all-archived-tickets' },
            { name: 'delete-archived-application', description: 'Delete archived application', usage: '/dev delete-archived-application <user>' },
            { name: 'delete-all-archived-applications', description: 'Delete all archived applications', usage: '/dev delete-all-archived-applications' },
        ];

        commands.push({
            name: 'dev',
            description: dev.builder?.cmdDescrp || 'Development and maintenance commands (admin only).',
            usage: '/dev <subcommand>',
            category: 'Admin',
            permissions: ['Administrator'],
            examples: ['/dev bulk-close-tickets'],
            subcommands,
        });
    }

    // Migrate command
    commands.push({
        name: 'migrate',
        description: 'Migration commands for updating bot data structures.',
        usage: '/migrate <ticket-tags|application-tags>',
        category: 'Admin',
        permissions: ['Administrator'],
        examples: ['/migrate ticket-tags'],
        subcommands: [
            { name: 'ticket-tags', description: 'Migrate ticket tags to new format', usage: '/migrate ticket-tags' },
            { name: 'application-tags', description: 'Migrate application tags', usage: '/migrate application-tags' },
        ],
    });

    return commands;
}

// Generate categories from commands
function extractCategories(commands: Command[]): string[] {
    const categories = new Set<string>();
    commands.forEach(cmd => categories.add(cmd.category));
    return ['All', ...Array.from(categories).sort()];
}

// Main execution
async function main() {
    console.log('Extracting command metadata...\n');

    const commands = extractCommands();
    const categories = extractCategories(commands);

    // Ensure output directory exists
    if (!existsSync(OUTPUT_DIR)) {
        mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Write commands JSON
    const output = {
        version: process.env.npm_package_version || '0.0.0',
        generatedAt: new Date().toISOString(),
        commandCount: commands.length,
        categories,
        commands,
    };

    const outputPath = join(OUTPUT_DIR, 'commands.json');
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`Extracted ${commands.length} commands`);
    console.log(`Categories: ${categories.join(', ')}`);
    console.log(`\nOutput written to: ${outputPath}`);

    // Also generate TypeScript file for direct import
    const tsOutput = `// Auto-generated by extractCommands.ts
// Generated at: ${new Date().toISOString()}
// Version: ${output.version}

export interface Command {
    name: string;
    description: string;
    usage: string;
    category: string;
    permissions: string[];
    examples: string[];
    subcommands?: Subcommand[];
}

export interface Subcommand {
    name: string;
    description: string;
    usage: string;
}

export const commands: Command[] = ${JSON.stringify(commands, null, 2)};

export const commandCategories = ${JSON.stringify(categories, null, 2)};
`;

    const tsOutputPath = join(OUTPUT_DIR, 'commands.ts');
    writeFileSync(tsOutputPath, tsOutput);
    console.log(`TypeScript file written to: ${tsOutputPath}`);
}

main().catch(console.error);
