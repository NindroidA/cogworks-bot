import chalk from 'chalk';

/* easier way for importing the lang json */
export { default as lang } from './lang.json';

/* function to format lang strings */
export function LANGF(template: string, ...args: (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (match, index) => {
        const argIndex = parseInt(index);
        return args[argIndex] !== undefined ? String(args[argIndex]) : match;
    });
}

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

/* helper function to parse time input */
export function parseTimeInput(timeInput: string): Date | null {
    try {
        // parse YYYY-MM-DD HH:MM AM/PM format
        const match = timeInput.match(/^(\d{4})-(\d{2})-(\d{2})\s(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
        if (!match) return null;

        const [, year, month, day, hourStr, minute, ampm] = match;
        
        // convert to 24-hour format
        let hour = parseInt(hourStr);
        if (ampm.toUpperCase() === 'PM' && hour !== 12) {
            hour += 12;
        } else if (ampm.toUpperCase() === 'AM' && hour === 12) {
            hour = 0;
        }

        // format hour with leading zero if needed
        const hourFormatted = hour.toString().padStart(2, '0');
        
        // for simplicity, assuming timezone CST (UTC-6)
        const centralTime = new Date(`${year}-${month}-${day}T${hourFormatted}:${minute}:00-05:00`);
        
        return centralTime;
    } catch {
        return null;
    }
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