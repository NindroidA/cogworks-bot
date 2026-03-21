/**
 * Default Announcement Templates
 *
 * These are seeded into the database on first setup for each guild.
 * They match the 5 original hardcoded templates from the legacy system.
 */

interface DefaultTemplateDefinition {
  name: string;
  displayName: string;
  description: string;
  color: string;
  title: string;
  body: string;
  fields: Array<{ name: string; value: string; inline: boolean }> | null;
  footerText: string | null;
  showTimestamp: boolean;
  mentionRole: boolean;
  isDefault: boolean;
  createdBy: string;
}

export const DEFAULT_ANNOUNCEMENT_TEMPLATES: DefaultTemplateDefinition[] = [
  {
    name: 'maintenance',
    displayName: 'Immediate Maintenance',
    description: 'Announce immediate server maintenance',
    color: '#FFA500',
    title: 'Server Maintenance',
    body: 'This is a notice that the server will be going down for maintenance. Expected duration: **{duration}**. We will update this channel if anything changes. Thank you for your patience.',
    fields: [
      { name: 'Expected Duration', value: '{duration}', inline: true },
      { name: 'Starting', value: 'In about 5 minutes', inline: true },
    ],
    footerText: 'Times shown are in your local timezone',
    showTimestamp: true,
    mentionRole: true,
    isDefault: true,
    createdBy: 'system',
  },
  {
    name: 'maintenance-scheduled',
    displayName: 'Scheduled Maintenance',
    description: 'Announce scheduled server maintenance with a specific time',
    color: '#FFA500',
    title: 'Scheduled Server Maintenance',
    body: 'The server will be going down for maintenance and updates. We will update this channel if anything goes awry.',
    fields: [
      { name: 'Expected Duration', value: '{duration}', inline: true },
      { name: 'Scheduled Time', value: '{time}', inline: false },
      { name: 'Relative Time', value: '{time_relative}', inline: false },
    ],
    footerText: 'Times shown are in your local timezone',
    showTimestamp: true,
    mentionRole: true,
    isDefault: true,
    createdBy: 'system',
  },
  {
    name: 'back-online',
    displayName: 'Back Online',
    description: 'Announce that the server is back online',
    color: '#00FF00',
    title: 'Server is Back Online!',
    body: 'Updates were successful; server is back online!',
    fields: [{ name: 'Status', value: 'Online and ready', inline: true }],
    footerText: 'Times shown are in your local timezone',
    showTimestamp: true,
    mentionRole: true,
    isDefault: true,
    createdBy: 'system',
  },
  {
    name: 'update-scheduled',
    displayName: 'Scheduled Update',
    description: 'Announce a scheduled server update with version and time',
    color: '#5865F2',
    title: 'Scheduled Server Update',
    body: 'The server will be updating to **{version}** soon. The update itself should not take too long, but no promises in case there are any issues. There will be another announcement once the server is updated and good to go.',
    fields: [
      { name: 'Version', value: '{version}', inline: true },
      { name: 'Scheduled Time', value: '{time}', inline: false },
      { name: 'Relative Time', value: '{time_relative}', inline: false },
    ],
    footerText: 'Times shown are in your local timezone',
    showTimestamp: true,
    mentionRole: true,
    isDefault: true,
    createdBy: 'system',
  },
  {
    name: 'update-complete',
    displayName: 'Update Complete',
    description: 'Announce that a server update has been completed',
    color: '#00FF00',
    title: 'Server Update Complete!',
    body: 'The server has been successfully updated to **version {version}**!\n\nEverything seems to have been updated properly -- there really should not be any bugs, but if anything seems seriously off just let us know!\n\nThank you for your patience!',
    fields: [
      { name: 'New Version', value: '{version}', inline: true },
      { name: 'Status', value: 'Online and ready', inline: true },
    ],
    footerText: 'Times shown are in your local timezone',
    showTimestamp: true,
    mentionRole: true,
    isDefault: true,
    createdBy: 'system',
  },
];
