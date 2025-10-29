/**
 * Message Archiving Module
 * 
 * Utilities for fetching and archiving Discord channel messages with attachments.
 * Creates text transcripts and ZIP archives of image attachments.
 */

import axios from 'axios';
import { GuildTextBasedChannel, Message } from 'discord.js';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';
import { lang } from './index';

// ============================================================================
// Archiving Functions
// ============================================================================

/**
 * Fetches all messages from a channel and saves them to files
 * Creates a transcript TXT file and optionally a ZIP file of image attachments
 * 
 * @param channel - The Discord text channel to archive
 * @param outputPath - Directory path where files will be saved
 * @throws Error if channel is invalid or not a text channel
 * @example
 * await fetchMessagesAndSaveToFile(ticketChannel, './archives/');
 * // Creates: ./archives/1234567890.txt
 * // Creates: ./archives/attachments_1234567890.zip (if images found)
 */
export async function fetchMessagesAndSaveToFile(
	channel: GuildTextBasedChannel, 
	outputPath: string
): Promise<void> {
	// Validate channel
	if (!channel) {
		throw new Error('Invalid channel or channel is not a text channel.');
	}

	// ========================================================================
	// Fetch Messages
	// ========================================================================

	let messages: Message[] = [];
	let lastId: string | undefined;

	// Fetch messages in batches of 100 (Discord API limit)
	while (true) {
		const fetchedMessages = await channel.messages.fetch({
			limit: 100,
			before: lastId,
		});

		if (fetchedMessages.size === 0) break;

		messages = messages.concat(Array.from(fetchedMessages.values()));
		lastId = fetchedMessages.last()?.id;
	}

	// ========================================================================
	// Save Transcript
	// ========================================================================

	// Build file path
	const transcriptPath = path.resolve(outputPath + `${channel.id}.txt`);

	// Create header with timestamp
	const date = new Date();
	const now: string = date.toLocaleString();
	const header = `Transcript Created - ${now}\n\n`;

	// Format messages chronologically
	const fileContent = messages
		.reverse() // Reverse to maintain chronological order
		.map((msg) => `[${msg.author.tag}]: ${msg.content}`)
		.join('\n');

	// Write transcript file
	const fullFile = header + fileContent;
	fs.writeFileSync(transcriptPath, fullFile);
	console.log(lang.console.transcriptSaved);

	// ========================================================================
	// Save Image Attachments
	// ========================================================================

	const zip = new JSZip();
	let attachmentCount = 0;

	// Collect all image attachments
	for (const msg of messages) {
		for (const attach of msg.attachments.values()) {
			// Only save images
			if (attach.contentType?.startsWith('image/')) {
				const resp = await axios.get(attach.url, { responseType: 'arraybuffer' });
				zip.file(attach.name, resp.data);
				attachmentCount++;
			}
		}
	}

	// Save ZIP if we found any images
	if (attachmentCount > 0) {
		const zipPath = path.resolve(outputPath + `attachments_${channel.id}.zip`);
		const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
		fs.writeFileSync(zipPath, zipBuffer);
		console.log(`${lang.console.attachmentsSaved} (${attachmentCount} images)`);
	}
}
