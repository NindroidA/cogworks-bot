import { GuildTextBasedChannel, Message} from 'discord.js';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import axios from 'axios';

export async function fetchMessagesAndSaveToFile(channel: GuildTextBasedChannel, outputPath: string): Promise<void> {

    // make sure channel exists
    if (!channel) {
        throw new Error('Invalid channel or channel is not a text channel.');
    }

    /* SAVING TRANSCRIPT */
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
    let fullPath = path.resolve(outputPath + `${channel.id}.txt`);

    // header for the transcript
    const date = new Date();
    const now: string = date.toLocaleString();
    const header = 'Transcript Created - ' + now + '\n\n';

    // write messages to a file
    const fileContent = messages
        .reverse() // reverse to maintain chronological order
        .map((msg) => `[${msg.author.tag}]: ${msg.content}`)
        .join('\n');

    // full file contents
    const fullFile = header + fileContent;
    fs.writeFileSync(fullPath, fullFile);
    console.log('Transcript saved!');

    /* SAVING ATTACHMENTS */
    const zip = new JSZip();
    let attachmentCount = 0;

    for (const msg of messages) {
        for (const attach of msg.attachments.values()) {
            // find only images
            if (attach.contentType?.startsWith('image/')) {
                const resp = await axios.get(attach.url, { responseType: 'arraybuffer' });
                zip.file(attach.name, resp.data);
                attachmentCount++;
            }
        }
    }

    // if we got any attachments
    if (attachmentCount > 0) {
        fullPath = path.resolve(outputPath + `attachments_${channel.id}.zip`);
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        fs.writeFileSync(fullPath, zipBuffer);
        console.log('Attachments saved!');
    }
    
}