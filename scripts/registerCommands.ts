/**
 * Manual Command Registration Script
 * 
 * Use this to manually register commands for a specific guild.
 * Useful for fixing servers where commands aren't showing up.
 * 
 * Usage: npx ts-node scripts/registerCommands.ts <GUILD_ID>
 */

import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { commands } from '../src/commands/commandList';

dotenv.config();

const GUILD_ID = process.argv[2];
const TOKEN = process.env.RELEASE === 'dev' ? process.env.DEV_BOT_TOKEN! : process.env.BOT_TOKEN!;
const CLIENT_ID = process.env.RELEASE === 'dev' ? process.env.DEV_CLIENT_ID! : process.env.CLIENT_ID!;

if (!GUILD_ID) {
	console.error('❌ Error: Please provide a guild ID');
	console.log('Usage: npx ts-node scripts/registerCommands.ts <GUILD_ID>');
	process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
	try {
		console.log(`🔄 Registering ${commands.length} commands for guild ${GUILD_ID}...`);

		await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
			body: commands,
		});

		console.log(`✅ Successfully registered commands for guild ${GUILD_ID}`);
		console.log(`📝 Commands registered: ${commands.map((c: any) => c.name).join(', ')}`);
	} catch (error) {
		console.error('❌ Failed to register commands:', error);
		process.exit(1);
	}
}

registerCommands();
