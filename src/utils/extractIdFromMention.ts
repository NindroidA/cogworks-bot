// helper function to extract ID from mention
export function extractIdFromMention(mention: string): string | null {
    const matches = mention.match(/^<@&?(\d+)>$/);
    return matches ? matches[1] : null;
}