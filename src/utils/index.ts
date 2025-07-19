import chalk from 'chalk';

/* easier way for importing the lang json */
export { default as lang } from './lang.json';

/* helper function to extract ID from mention */
export function extractIdFromMention(mention: string): string | null {
    const matches = mention.match(/^<@&?(\d+)>$/);
    return matches ? matches[1] : null;
}

/* formats bytes into readable string */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* helper function to get current timestamp */
export function getTimestamp() {
    return new Date().toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    }).toLowerCase();
}

/* helper function for console logging */
export function logger(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') {
    const prefix = `[${getTimestamp()} - ${level}]`;

    switch (level) {
        case 'ERROR':
            console.error(chalk.redBright(`${prefix} ${message}`));
            break;
        case 'WARN':
            console.warn(chalk.yellow(`${prefix} ${message}`));
            break;
        default:
            console.log(`${prefix} ${message}`);
    }
}