/* eslint-disable @typescript-eslint/no-unused-vars */
import { GuildTextBasedChannel, Message} from 'discord.js';
import fs from 'fs';
import path from 'path';

export async function fetchMessagesAndSaveToFile(channel: GuildTextBasedChannel, outputPath: string): Promise<void> {

    // make sure channel exists
    if (!channel) {
        throw new Error('Invalid channel or channel is not a text channel.');
    }

    let messages: Message[] = [];
    let lastId: string | undefined;

    // fetch messages in batches
    while (true) {
        const fetchedMessages = await channel.messages.fetch({
            limit: 100,
            before: lastId,
        });

        if (fetchedMessages.size === 0) break;

        messages = messages.concat(Array.from(fetchedMessages.values()));
        lastId = fetchedMessages.last()?.id;
    }

    // resolve the full file path
    const fullPath = path.resolve(outputPath);

    // write messages to a file
    const fileContent = messages
        .reverse() // reverse to maintain chronological order
        .map((msg) => `[${msg.author.tag}]: ${msg.content}`)
        .join('\n');

    fs.writeFileSync(outputPath, fileContent);
    console.log(`Transcript saved!`);
}