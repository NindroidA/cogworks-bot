export type TicketStatus = 'created' | 'opened' | 'closed' | 'adminOnly' | 'error';
export type ApplicationStatus = 'created' | 'opened' | 'closed' | 'accepted' | 'rejected' | 'error';
export type SavedRoleTypes = 'staff' | 'admin';

export interface DownloadOptions {
    outputDir: string;
    skipExisting?: boolean;
    batchSize?: number;
    maxRetries?: number;
}