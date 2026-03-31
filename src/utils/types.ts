/** Possible states for a support ticket (includes workflow custom statuses via string) */
export type TicketStatus = 'created' | 'opened' | 'closed' | 'adminOnly' | 'error' | (string & {});

/** Possible states for a staff application (includes workflow custom statuses via string) */
export type ApplicationStatus = 'created' | 'opened' | 'closed' | 'accepted' | 'rejected' | 'error' | (string & {});
