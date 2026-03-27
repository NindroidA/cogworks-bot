# Administrator Guide

**Last Updated:** `March 26, 2026`

Complete guide for server administrators using Cogworks Bot v3.

## Table of Contents

- [Initial Setup](#initial-setup)
- [Setup Dashboard](#setup-dashboard)
- [Managing Staff](#managing-staff)
- [Ticket System](#ticket-system)
- [Custom Ticket Types](#custom-ticket-types)
- [Ticket Workflow](#ticket-workflow)
- [Application System](#application-system)
- [Announcements](#announcements)
- [Rules Acknowledgment](#rules-acknowledgment)
- [Reaction Role Menus](#reaction-role-menus)
- [Bait Channel (Anti-Bot)](#bait-channel-anti-bot)
- [Memory System](#memory-system)
- [Starboard](#starboard)
- [XP & Leveling System](#xp--leveling-system)
- [Events System](#events-system)
- [Onboarding System](#onboarding-system)
- [Analytics & Insights](#analytics--insights)
- [AutoMod Integration](#automod-integration)
- [Context Menu Commands](#context-menu-commands)
- [Data Management](#data-management)
- [Troubleshooting](#troubleshooting)
- [Quick Reference](#quick-reference)

---

## Initial Setup

### First Steps

1. **Invite the bot** to your server with admin permissions.
2. **Run `/bot-setup`** to open the setup dashboard.
3. **Select the systems** you want to enable.

### What Gets Configured?

The `/bot-setup` dashboard lets you configure all systems from a single place: staff/admin roles, tickets, applications, announcements, bait channels, rules, memory, reaction roles, and all v3 systems.

- **First run**: Dashboard guides you through all available systems
- **Already configured**: Shows current state, allows updates
- **Partial setup**: Highlights unconfigured systems

Channels are auto-created when needed (e.g., memory forum channels, ticket categories).

---

## Setup Dashboard

The `/bot-setup` command opens an interactive dashboard with persistent state. It presents a menu of all available systems with their current status (configured / not configured). Select any system to configure or reconfigure it. Your configuration is saved as you go and you can return at any time.

---

## Managing Staff

### Setting Roles in Cogworks

**Option 1: Via Bot Setup Dashboard** (Recommended)
```
/bot-setup
> Follow prompts to add staff/admin roles
```

**Option 2: Individual Commands**
```
/role add admin @ModeratorRole moderator
/role add staff @SupportTeam support
```

The second argument is a custom alias that appears in bot messages.

### Viewing Configured Roles
```
/role list
```
Shows all admin and staff roles with their custom aliases.

### Removing Roles
```
/role remove admin @ModeratorRole
/role remove staff @SupportTeam
```

### Role Hierarchy

| Role Type | Permissions |
|-----------|-------------|
| **Server Owner** | Full access to everything |
| **Admin Roles**  | All commands, setup, configuration, data export |
| **Staff Roles**  | Ticket replies only |
| **Global Staff** | Optional role for alerting all staff across events |

---

## Ticket System

### Setup

**Via Bot Setup:**
```
/bot-setup
> Select Ticket System
> Choose creation channel
> Choose ticket category
> Choose archive forum
```

**Individual Setup:**
```
# All options are optional — update one or all at once
/ticket-setup channel:#ticket-creation archive:#ticket-archives category:Tickets
/ticket-setup channel:#new-channel    # update just one setting
```

### How It Works

1. Users click a button in the creation channel and select a ticket type
2. A modal form with custom fields appears
3. A private channel is created in the ticket category
4. Staff can reply and assist
5. When closed, the full transcript is archived to the forum and the channel is deleted

### Default Ticket Types

The bot creates 5 default types: **Ban Appeal**, **Player Report**, **Bug Report**, **18+ Verification**, and **Other** (default).

### Managing Tickets

- **Admin Only** button: Restricts visibility to ticket creator and admin roles
- **Close Ticket** button: Archives with full transcript and deletes the channel

### Ticket Settings

```
/ticket manage settings setting:admin-only-mention enabled:true
/ticket manage settings setting:ping-on-create enabled:true type:Bug Report
```

- **Admin-Only Staff Mention**: Only admin roles are mentioned in tickets
- **Ping Staff on Create**: Ping staff when a ticket is created (can be set per type)

### Importing Tickets from Email

```
/ticket manage import-email
```
Opens a modal for: sender email, name (optional), subject, body, and attachment URLs.

---

## Custom Ticket Types

### Creating Custom Types

```
/ticket type add
```
Opens a modal to configure: Type ID (lowercase, underscores), Display Name, Emoji, Color (hex), and Description.

### Managing Types

```
/ticket type list                        # List all types
/ticket type edit type:Bug Report        # Edit a type
/ticket type toggle type:Bug Report      # Toggle active/inactive
/ticket type default type:Other          # Set default type
/ticket type remove type:Bug Report      # Delete a type
```

### Custom Fields

Each ticket type can have up to 5 custom input fields:
```
/ticket type fields type:Bug Report
```
Opens an interactive field manager with buttons to Add, Delete, Reorder, Preview, and finish.

### User Restrictions

```
/ticket manage user-restrict user:@BadActor                    # Interactive menu
/ticket manage user-restrict user:@BadActor type:Ban Appeal     # Restrict specific type
```

---

## Ticket Workflow

The workflow system adds status tracking, staff assignment, and auto-close to your ticket system. It is optional and can be enabled per guild.

### Enabling the Workflow

```
/ticket workflow enable
```

This activates workflow features for all tickets. Existing open tickets will default to the "Open" status.

```
/ticket workflow disable
```

Disables workflow tracking (does not delete status history).

### Workflow Settings Modal

```
/ticket workflow settings
```

Opens a modal to quickly configure workflow and auto-close settings in one step.

### Default Statuses

When workflow is enabled, you get these default statuses:
- Open
- In Progress
- Awaiting Response
- Resolved
- Closed

### Custom Statuses

Add up to 10 custom statuses per guild:
```
/ticket workflow add-status id:escalated label:Escalated emoji:🔴
```

Remove a custom status (cannot remove `open` or `closed`):
```
/ticket workflow remove-status status:Escalated
```

### Using Workflow in Tickets

**Change a ticket's status** (run inside a ticket channel):
```
/ticket manage status status:In Progress
```
Uses autocomplete to show available statuses.

**Assign a staff member:**
```
/ticket manage assign user:@StaffMember
```

**Remove assignment:**
```
/ticket manage unassign
```

**View ticket details:**
```
/ticket manage info
```
Shows current status, assignment, creation date, and status history.

### Auto-Close

Automatically close tickets that have been inactive for a specified period. Requires workflow to be enabled.

**Enable auto-close:**
```
/ticket workflow autoclose-enable days:7 warning-hours:24 status:Awaiting Response
```
- `days` — Inactivity threshold (1-90 days, default: 7)
- `warning-hours` — Hours before closing to send a warning (1-72 hours)
- `status` — Only auto-close tickets with this status (optional, defaults to all)

**Disable auto-close:**
```
/ticket workflow autoclose-disable
```

The bot checks for inactive tickets hourly. A warning message is posted in the ticket channel before it is closed.

### SLA Tracking

Track response time targets for tickets. SLA (Service Level Agreement) monitoring alerts staff when tickets are at risk of breaching response time goals.

**Enable SLA tracking:**
```
/ticket sla enable target-minutes:60 breach-channel:#sla-alerts
```
- `target-minutes` — Target first response time in minutes (1-1440, optional)
- `breach-channel` — Channel to post breach alerts in (optional)

**Disable SLA tracking:**
```
/ticket sla disable
```

**Set per-type SLA targets:**
```
/ticket sla per-type type:Bug Report minutes:30
```
Override the global target for a specific ticket type. Omit `minutes` to clear the per-type override.

**View SLA statistics:**
```
/ticket sla stats days:30
```
Shows compliance rates, average response times, and breach counts.

### Smart Routing

Automatically assign tickets to staff based on rules. Requires workflow to be enabled.

**Enable routing:**
```
/ticket routing enable
```

**Disable routing:**
```
/ticket routing disable
```

**Add a routing rule:**
```
/ticket routing rule-add type:Bug Report role:@Developers max-open:5
```
- `type` — Ticket type to route
- `role` — Staff role to assign tickets to
- `max-open` — Maximum open tickets per staff member before skipping (1-50, optional)

**Remove a routing rule:**
```
/ticket routing rule-remove type:Bug Report
```

**Set routing strategy:**
```
/ticket routing strategy strategy:round-robin
```
Strategies: `round-robin`, `least-load`, `random`.

**View routing statistics:**
```
/ticket routing stats
```

---

## Application System

### Setup

**Via Bot Setup:**
```
/bot-setup
> Select Application System
> Choose submission channel
> Choose application category
> Choose archive forum
```

**Individual Setup:**
```
# All options are optional — update one or all at once
/application-setup channel:#apply-here archive:#application-archives category:Applications
/application-setup archive:#new-forum    # update just one setting
```

### Creating Application Positions

**From a Preset Template:**
```
/application position add template:Staff Application
```

Available templates: `General Application`, `Staff Application`, `Content Creator`, `Developer Application`, `Partnership Application`.

Templates pre-populate the title, description, emoji, custom fields, and age gate. You can override template values:
```
/application position add template:Developer Application title:Plugin Dev emoji:🔌
```

**From Scratch:**
```
/application position add title:My Position description:Apply to join our team! emoji:🎯
```
Positions created from scratch start with a single default field ("Tell us about yourself"). Use `/application position fields` to add custom fields.

### Editing Positions

```
/application position edit position:My Position
```
Opens a modal to edit:
- **Title** — Position display name
- **Description** — Position description
- **Emoji** — Button emoji (leave blank for default)
- **Age Gate** — Type `yes` or `no` to toggle age verification

Changes are reflected immediately in the application channel.

### Custom Fields

Each position can have up to 5 custom modal fields (Discord limit):
```
/application position fields position:Dev Partner Application
```
Opens an interactive field manager with buttons to Add, Delete, Reorder, Preview, and finish.

### Managing Positions

```
/application position list                            # Shows all positions
/application position toggle position:My Position     # Toggle active/inactive
/application position remove position:My Position     # Remove a position
/application position refresh                         # Refresh channel message
```

### Age Gate

Positions can require age verification before the form opens. The `Staff Application` template has it enabled by default. Toggle via `/application position edit` (set Age Gate to `yes` or `no`).

### How Applications Work

1. Users click a position's Apply button in the submission channel
2. Age gate confirmation (if enabled), then modal form opens
3. A review channel is created with all responses
4. Staff review, discuss, and Accept/Deny
5. Applicant is notified via DM and the application is archived

### Rate Limiting

- Users: **2 applications per day**
- Admins: **15 position operations per hour** per guild

---

## Announcements

### Setup

**Via Bot Setup:**
```
/bot-setup
> Select Announcement System
> Choose ping role
> Choose default channel
```

**Individual Setup:**
```
/announcement-setup role:@MinecraftPlayer channel:#announcements
```

### Types of Announcements

**Maintenance (Immediate):**
```
/announcement maintenance duration:short
/announcement maintenance duration:long
```

**Scheduled Maintenance:**
```
/announcement maintenance-scheduled time:"2026-03-30 14:00" duration:short
```

**Back Online:**
```
/announcement back-online
```

**Scheduled Update:**
```
/announcement update-scheduled version:"1.20.4" time:"2026-04-01 18:00"
```

**Update Complete:**
```
/announcement update-complete version:"1.20.4"
```

**Send from Template:**
```
/announcement send template:maintenance
```
Uses autocomplete to select from your configured templates.

All announcement commands accept optional `channel` and `message` parameters to override defaults.

### Announcement Templates

Create reusable announcement formats (up to 25 per server):

```
/announcement template create          # Opens modal for name, title, body, color, ping
/announcement template edit template:maintenance
/announcement template delete template:maintenance
/announcement template list
/announcement template preview template:maintenance
/announcement template reset           # Reset all to defaults
```

### Rate Limiting

- **5 announcements per hour** per user
- Admin role required

---

## Rules Acknowledgment

A react-to-accept system that assigns a role when users react to a rules message.

### Setup

```
/rules-setup setup channel:#rules role:@Member
```

Required parameters:
- `channel` — The text channel to post the rules message in
- `role` — The role to assign when a user reacts

Optional parameters:
- `message` — Custom rules message text (up to 1800 characters). If omitted, a default message is used.
- `emoji` — Custom reaction emoji. If omitted, a checkmark is used.

The bot posts an embed in the specified channel. When users react with the configured emoji, they receive the specified role.

### View Current Config

```
/rules-setup view
```
Shows the configured channel, role, message, and emoji.

### Remove Rules System

```
/rules-setup remove
```
Removes the rules configuration. The posted message remains in the channel but reactions will no longer be processed.

### How It Works

1. Admin runs `/rules-setup setup` with a channel and role
2. The bot posts a rules embed in that channel
3. Users react with the configured emoji
4. The bot assigns the configured role to the reacting user
5. If a user removes their reaction, the role is removed

The system uses an in-memory cache for performance since reaction events fire frequently.

---

## Reaction Role Menus

Create reaction-based role assignment menus with multiple modes.

### Creating a Menu

```
/reactionrole create channel:#roles name:Color Roles description:Pick your color! mode:normal
```

Parameters:
- `channel` (required) — Where to post the menu
- `name` (required) — Menu title
- `description` (optional) — Menu description text
- `mode` (optional, default: normal) — Selection mode:
  - **Normal**: Users can select multiple roles
  - **Unique**: Users can only hold one role from this menu at a time (selecting a new one removes the previous)
  - **Lock**: Users can add roles but cannot remove them by un-reacting

### Adding Roles to a Menu

```
/reactionrole add menu:Color Roles emoji:🔴 role:@Red description:Red color role
```

The `menu` parameter uses autocomplete. Each emoji+role pair creates a reaction option on the menu message.

### Removing Roles from a Menu

```
/reactionrole remove menu:Color Roles emoji:🔴
```

### Editing a Menu

```
/reactionrole edit menu:Color Roles name:Server Colors mode:unique
```

All edit parameters are optional. You can change the name, description, or mode.

### Deleting a Menu

```
/reactionrole delete menu:Color Roles
```

Removes the menu message and all associated data.

### Listing All Menus

```
/reactionrole list
```

Shows all menus in the server with their mode, channel, and number of options.

### Validating Menus

```
/reactionrole validate
```

Checks all menus for issues such as:
- Deleted channels or messages
- Deleted roles
- Missing bot permissions

---

## Bait Channel (Anti-Bot)

### What Is It?

A hidden channel that automated bots often post in, allowing detection and removal. The v2 system adds multi-channel support, escalation tiers, DM notifications, keyword detection, test mode, and weekly summaries.

### Setup

**Via Bot Setup:**
```
/bot-setup
> Select Bait Channel System
> Choose hidden channel
> Choose action (Ban/Kick/Timeout/Log Only)
> Set grace period (0-60 seconds)
> Optional: Choose log channel
```

**Individual Setup:**
```
/baitchannel setup setup channel:#bot-trap action:ban grace_period:5 log_channel:#mod-logs
```

### Auto-Protected Users

The following users are **automatically protected** and will never be actioned:
- **Server Owner**: Cannot be kicked or banned by Discord
- **Administrators**: Users with Administrator permission (unless disabled for testing)
- **Whitelisted Roles**: Roles added to the whitelist
- **Whitelisted Users**: Users added to the whitelist

### Detection Flags (Suspicion Score)

The system analyzes 7 factors to calculate a suspicion score (0-100):

| Flag | Points | Description |
|------|--------|-------------|
| New Account | Up to 30 | Account less than configured days old |
| New Member | 25 | Just joined the server |
| No Messages | 20 | Low message count in server |
| No Verification | 15 | Missing verification role |
| Link Spam | Up to 20 | Contains multiple links |
| Mention Spam | 15 | Excessive @mentions |
| Suspicious Content | Up to 25 | Common spam keywords detected |

**Score 90+**: Instant action (no grace period)
**Score 50-89**: Standard grace period applies
**Score <50**: Still triggers but lower priority

### Message Purge

When a user is banned, the bot automatically purges their messages across all server channels. A purge summary is included in the ban log embed.

### Multi-Channel Support

```
/baitchannel setup add-channel channel:#second-trap
/baitchannel setup remove-channel channel:#second-trap
```

### Settings Modal

```
/baitchannel detection settings
```

Opens a modal to view and modify all bait channel settings in one place.

### Keyword Detection

Manage custom keywords that contribute to the suspicion score:

```
/baitchannel detection keywords action:add keyword:free nitro weight:5
/baitchannel detection keywords action:remove keyword:free nitro
/baitchannel detection keywords action:list
/baitchannel detection keywords action:reset
```

Keywords with higher weight contribute more to the suspicion score. The `keyword` parameter uses autocomplete for removal.

### Escalation System

Escalation tiers allow different actions based on the suspicion score:

**Enable escalation:**
```
/baitchannel escalation enable
```

**Disable escalation:**
```
/baitchannel escalation disable
```

**Configure thresholds:**
```
/baitchannel escalation thresholds log:30 timeout:50 kick:70 ban:90
```
Each threshold is a suspicion score. When a user's score reaches a threshold, the corresponding action is taken instead of the default action.

### DM Notifications

Send a DM to users who trigger the bait channel before actioning them:

**Enable DM notification:**
```
/baitchannel dm enable
```

**Disable DM notification:**
```
/baitchannel dm disable
```

**Set appeal instructions** (included in the DM):
```
/baitchannel dm appeal-info text:To appeal, email appeals@example.com
```

**Clear appeal info:**
```
/baitchannel dm clear-appeal
```

### Test Mode

Test the bait channel system without taking real action:
```
/baitchannel detection test-mode enabled:true
```

In test mode, the bot logs what action it *would* take but does not actually ban, kick, or timeout anyone. Disable when ready:
```
/baitchannel detection test-mode enabled:false
```

### Weekly Summary

Enable automated weekly summary reports of bait channel activity:
```
/baitchannel stats summary enabled:true channel:#mod-logs
```

Disable summaries:
```
/baitchannel stats summary enabled:false
```

### Manual Override

Manually trigger a bait score analysis for a specific user:
```
/baitchannel stats override user:@SuspiciousUser
```

### Detection Settings

```
/baitchannel detection detection enabled:true min_account_age:7 min_membership:60 min_messages:1 require_verification:true threshold:50
```

Additional detection options:
- `disable_admin_whitelist` — Set to true to include admins in detection (for testing)
- `join_velocity_threshold` — Number of joins in the window that triggers burst detection (2-100)
- `join_velocity_window` — Time window in minutes for join velocity tracking (1-30)

### Whitelist Management

```
/baitchannel detection whitelist action:add role:@Verified
/baitchannel detection whitelist action:add user:@TrustedBot
/baitchannel detection whitelist action:remove user:@FormerBot
/baitchannel detection whitelist action:list
```

### View Status & Stats

```
/baitchannel setup status
/baitchannel stats stats days:30
```

### Toggle System

```
/baitchannel setup toggle enabled:false   # Disable
/baitchannel setup toggle enabled:true    # Enable
```

### Recommended Setup

Start with `log-only` action, `5s` grace period, and test mode enabled. Monitor for false positives. When satisfied, switch to `ban` or `kick`, disable test mode, and consider enabling escalation for tiered response.

---

## Memory System

A forum-based tracking system for bugs, features, suggestions, reminders, and notes. Supports up to **3 memory channels per server** for organizing different types of items.

### Setup

**Initial setup:**
```
/memory-setup setup
```

Options:
- Select an existing forum channel, OR
- Let the bot create a new "memory" forum channel (provide a `channel-name` to customize)

```
/memory-setup setup channel:#existing-forum
/memory-setup setup channel-name:project-tracker
```

The bot will:
- Configure the forum with default tags
- Post a pinned welcome thread
- Sync tags with Discord's forum tag system

### Multi-Channel Support

**Adding more channels (up to 3):**
```
/memory-setup add-channel channel:#feature-tracker
```
Each channel gets its own independent set of tags.

**Removing a channel:**
```
/memory-setup remove-channel
```
Select which channel to remove from a dropdown.

**Viewing all channels:**
```
/memory-setup view
```

### Creating Memory Items

**Manual Creation:**
```
/memory add
```
1. If multiple channels are configured, select which channel to use
2. Select category (Bug, Feature, Suggestion, etc.)
3. Select status (Open, In Progress, etc.)
4. Click "Continue"
5. Enter title and description in the modal
6. A new forum thread is created

**Capturing Messages:**
```
/memory capture message_link:https://discord.com/channels/123/456/789
```
- Captures an existing message as a memory item
- Accepts a message ID or full Discord message link
- Pre-fills description with the message content
- Shows source link in the created post

### Managing Memory Items

**Update Status:**
```
/memory update
```
- Run this command **inside a memory thread**
- Select the new status
- Thread automatically closes when set to "Completed"

**Quick Status Update** (from any channel):
```
/memory update-status
```
Uses autocomplete to select the memory item and new status.

**Quick Tag Update** (from any channel):
```
/memory update-tags
```
Uses autocomplete to select the memory item and update its tags.

**Delete Item:**
```
/memory delete
```
- Run this command **inside a memory thread**
- Confirms before deleting
- Removes both the forum thread and database record

### Custom Tag Management

Each memory channel has its own set of tags. Admins can customize them:

**Add a tag:**
```
/memory-setup tag-add name:Critical type:category emoji:🚨
/memory-setup tag-add name:Blocked type:status emoji:🚫 channel:#feature-tracker
```
- `type`: `category` or `status`
- `channel`: Optional, defaults to the first memory channel
- Limits: 10 category tags, 6 status tags per channel (20 total Discord forum tag limit)

**Remove a tag:**
```
/memory-setup tag-remove tag:Critical
```
Cannot remove default tags. Uses autocomplete.

**Edit a tag:**
```
/memory-setup tag-edit tag:Critical name:Urgent emoji:⚡
```

**List all tags:**
```
/memory-setup tag-list
/memory-setup tag-list channel:#feature-tracker
```

**Reset tags to defaults:**
```
/memory-setup tag-reset
```
Requires confirmation. Resets all tags to the default set.

### Default Tags

**Categories:** Bug, Feature, Suggestion, Reminder, Note

**Statuses:** Open, In Progress, On Hold, Completed

### Tips

- Use the forum's built-in filtering by tags to find items
- Status "Completed" automatically archives the thread
- Captured messages show a small link to the original source
- Tags sync with Discord's native forum tag system
- Each channel's tags are independent; adding a tag to one channel does not affect others

---

## Starboard

Automatically showcase popular messages in a dedicated channel when they receive enough reactions.

### Setup

```
/starboard setup channel:#starboard
/starboard setup channel:#starboard emoji:⭐ threshold:5
```

Parameters:
- `channel` (required) — The channel to post starred messages in
- `emoji` (optional, default: star) — The reaction emoji to track
- `threshold` (optional, default: 3) — Number of reactions required to post

### Configuration

Change individual settings:
```
/starboard config setting:emoji value:🌟
/starboard config setting:threshold value:5
/starboard config setting:self-star value:false
/starboard config setting:ignore-bots value:true
/starboard config setting:ignore-nsfw value:true
```

Available settings:
- **emoji** — The reaction emoji to track
- **threshold** — Number of reactions required (1-25)
- **self-star** — Whether the message author's reaction counts (true/false)
- **ignore-bots** — Ignore reactions from bot accounts (true/false)
- **ignore-nsfw** — Skip messages from NSFW channels (true/false)

### Ignoring Channels

Exclude specific channels from starboard tracking:
```
/starboard ignore channel:#admin-chat
/starboard unignore channel:#admin-chat
```

### Other Commands

**View starboard statistics:**
```
/starboard stats
```

**Toggle starboard on/off:**
```
/starboard toggle
```

**Show a random starred message:**
```
/starboard random
```

---

## XP & Leveling System

A full XP and leveling system with role rewards, channel multipliers, voice XP, and a leaderboard.

### Setup

**Enable the system:**
```
/xp-setup enable
```

**Disable the system:**
```
/xp-setup disable
```

### Configuration

```
/xp-setup config setting:<setting> value:<value>
```

Available settings:

| Setting | Description | Example |
|---------|-------------|---------|
| `xp-rate` | Min-max XP per message | `15-25` |
| `cooldown` | Seconds between XP gains | `60` |
| `voice-xp` | XP per minute in voice | `5` |
| `voice-xp-enabled` | Enable/disable voice XP | `true` |
| `level-up-channel` | Channel for level-up messages | Use the `channel` option |
| `level-up-message` | Custom level-up message | `GG {user}, you hit level {level}!` |
| `stack-multipliers` | Whether channel multipliers stack | `true` |

For the level-up channel, use the `channel` option:
```
/xp-setup config setting:level-up-channel channel:#level-ups
```

### Role Rewards

Automatically assign roles when users reach certain levels:

**Add a role reward:**
```
/xp-setup role-reward-add level:10 role:@Active Member
/xp-setup role-reward-add level:25 role:@Veteran remove-on-delevel:true
```
- `remove-on-delevel` — If true, the role is removed if the user drops below this level

**Remove a role reward:**
```
/xp-setup role-reward-remove level:10
```

**List all role rewards:**
```
/xp-setup role-reward-list
```

### Channel Multipliers

Boost or reduce XP gain in specific channels:

**Set a multiplier:**
```
/xp-setup multiplier-set channel:#events multiplier:2.0
/xp-setup multiplier-set channel:#spam multiplier:0.5
```
Multiplier range: 0.1 to 10.

**Remove a multiplier:**
```
/xp-setup multiplier-remove channel:#events
```

### Ignoring Channels

Prevent XP from being earned in specific channels:

```
/xp-setup ignore-channel-add channel:#bot-commands
/xp-setup ignore-channel-remove channel:#bot-commands
```

Works for both text and voice channels.

### Importing from MEE6

Migrate your existing XP data from MEE6:
```
/xp-setup import-mee6
```

### User Commands

These commands are available to all server members:

**View your rank or someone else's:**
```
/rank
/rank user:@SomeUser
```

**View the leaderboard:**
```
/leaderboard
/leaderboard page:3
```
Shows 10 users per page.

### Admin XP Commands

**Set a user's XP:**
```
/xp set user:@SomeUser xp:5000
```

**Reset a user's XP:**
```
/xp reset user:@SomeUser
```

**Reset all XP data for the server:**
```
/xp reset-all
```

---

## Events System

Create and manage server events with reminders, templates, and recurring schedules.

### Setup

**Enable the events system:**
```
/event setup enable
```

**Disable the events system:**
```
/event setup disable
```

**Set the reminder channel** (where reminder messages are sent):
```
/event setup reminder-channel channel:#event-reminders
```

**Set the summary channel** (for event recaps):
```
/event setup summary-channel channel:#events
```

**Set the default reminder time** (minutes before event):
```
/event setup default-reminder minutes:30
```

### Creating Events

```
/event create title:Game Night start:"2026-03-28 20:00" description:Weekly game night! duration:120 location:Voice Chat
```

Parameters: `title` (required), `start` (required, `YYYY-MM-DD HH:MM` format), `description`, `channel` (voice/stage), `duration` (minutes, 1-1440), `location`.

**From a template:**
```
/event from-template template:Game Night start:"2026-03-28 20:00"
```

**Recurring events:**
```
/event recurring template:Game Night start:"2026-03-28 20:00" pattern:weekly
```
Patterns: `daily`, `weekly`, `biweekly`, `monthly`.

### Managing Events

```
/event cancel event:Game Night              # Cancel an event
/event remind event:Game Night minutes:60   # Set a reminder (minutes before start)
```

### Event Templates

```
/event template create                          # Opens modal
/event template edit template:Game Night
/event template delete template:Game Night
/event template list
```

---

## Onboarding System

Create interactive onboarding flows for new members with configurable steps.

### Setup

**Enable onboarding:**
```
/onboarding enable
```

**Disable onboarding:**
```
/onboarding disable
```

### Configuration

**Set a welcome message** (shown at the start of the onboarding flow):
```
/onboarding welcome-message message:Welcome to our server! Let's get you set up.
```

**Set a completion role** (assigned when onboarding is finished):
```
/onboarding completion-role role:@Member
```

Clear the completion role (no role assigned on completion):
```
/onboarding completion-role
```

### Managing Steps

Steps are presented to new members in order. Available types: `message`, `role-select`, `channel-suggest`, `rules-accept`, `custom-question`.

```
/onboarding step-add type:message title:Welcome! description:Here's how our server works... required:true
/onboarding step-add type:role-select title:Pick Your Interests description:Select the topic roles you want
/onboarding step-remove step:Welcome!     # Uses autocomplete
/onboarding step-list
```

### Other Commands

```
/onboarding stats                         # Completion rates and drop-off data
/onboarding preview                       # Preview the flow as a new member
/onboarding resend user:@NewMember        # Re-trigger onboarding for a user
```

---

## Analytics & Insights

Track server activity with analytics dashboards and automated digest reports.

### Setup

**Enable analytics:**
```
/insights setup action:enable
```

**Disable analytics:**
```
/insights setup action:disable
```

**Set the digest channel:**
```
/insights setup action:channel channel:#analytics
```

**Set digest frequency:**
```
/insights setup action:frequency frequency:weekly
```
Options: `weekly`, `monthly`, `both`.

**Set the day for the digest** (0 = Sunday, 1 = Monday, ...):
```
/insights setup action:frequency day:1
```

**View current status:**
```
/insights setup action:status
```

### Viewing Insights

```
/insights overview              # Member count, activity summary, system usage
/insights growth days:30        # Joins, leaves, net growth (default 7 days, max 90)
/insights channels days:14      # Most active channels by message volume
/insights hours days:30         # Server activity by hour of day
```

---

## AutoMod Integration

Create and manage custom AutoMod rules with keywords, regex patterns, templates, and backups.

### Rules

```
/automod rule create name:No Spam type:spam         # Types: keyword, mention-spam, spam
/automod rule create name:Bad Words type:keyword
/automod rule edit rule:No Spam                      # Uses autocomplete
/automod rule delete rule:Bad Words
/automod rule list
```

### Keywords & Regex

```
/automod keyword add rule:Bad Words keyword:badword
/automod keyword remove rule:Bad Words keyword:badword
/automod regex add rule:Link Filter pattern:https?://bad-site\.com
/automod regex remove rule:Link Filter pattern:https?://bad-site\.com
```

### Exemptions

```
/automod exempt add rule:No Spam role:@Moderator
/automod exempt add rule:No Spam channel:#bot-commands
/automod exempt remove rule:No Spam role:@Moderator
```

### Templates

Apply preset configurations: `anti-spam`, `anti-phishing`, `family-friendly`, `gaming`.
```
/automod template apply template:anti-spam
```

### Backup & Restore

```
/automod backup export                               # Download rules as JSON
/automod backup restore file:<uploaded_file>          # Restore from backup
```

---

## Context Menu Commands

Right-click actions available on messages and users. These appear in Discord's context menu (right-click or long-press on mobile).

### Message Context Menus

**Capture to Memory**
Right-click a message and select "Capture to Memory" to save it as a memory item. Works the same as `/memory capture` but without needing to copy the message link.
- Requires: Manage Messages permission

**Post as Announcement**
Right-click a message and select "Post as Announcement" to repost it as a formatted announcement embed.
- Requires: Administrator permission

**Close Application**
Right-click a message in an application channel to close and archive the application.
- Requires: Manage Messages permission

### User Context Menus

**Open Ticket For User**
Right-click a user and select "Open Ticket For User" to create a ticket on their behalf.
- Requires: Manage Messages permission

**View Bait Score**
Right-click a user and select "View Bait Score" to see their current suspicion score and detection flags.
- Requires: Administrator permission

**Manage Restrictions**
Right-click a user and select "Manage Restrictions" to view and modify their ticket type restrictions.
- Requires: Administrator permission

---

## Data Management

### Exporting Server Data (GDPR Compliance)

```
/data-export
```

Exports all data from every configured system (tickets, applications, announcements, bait channel, rules, reaction roles, memory, starboard, XP, events, onboarding, analytics, AutoMod, archives, audit logs, and bot status).

- Sent via **DM** as a **JSON file**
- Rate limited: once per 24 hours
- Admin-only command

### Bot Reset (Factory Reset)

```
/bot-reset
```

Complete factory reset: removes all configuration and data. Compiles an archive before deletion (sent via DM). Requires confirmation. **Irreversible** — use `/data-export` first if you want a backup.

### Archive Cleanup

```
/archive cleanup system:tickets
/archive cleanup system:applications
/archive cleanup system:all
```

Exports archived records as JSON (via DM), then removes them from the database. Forum posts in Discord remain. Use this to reduce database size over time.

### Data Deletion

When the bot leaves your server, **ALL server data is automatically deleted** — every entity across every system. This is GDPR-compliant and ensures no data remains after bot removal.

### Data Privacy

- All data is **server-isolated** (cannot see other servers)
- No cross-server data sharing
- Automatic cleanup on bot removal
- Export anytime for transparency
- Minimal data collection (only what is needed for functionality)

---

## Troubleshooting

### Common Issues

**Commands Not Working:**
- Check the bot has required permissions (Administrator is recommended)
- Verify your role is configured as admin/staff with `/role list`
- Make sure the bot's role is higher than roles it needs to assign

**Can't Create Tickets:**
- Verify the ticket system is set up (`/bot-setup` or `/ticket-setup`)
- Check the bot has "Manage Channels" permission
- Ensure the ticket category is not at the 50-channel limit

**Announcements Not Sending:**
- Check you have an admin role configured
- Verify announcement system is set up
- Check rate limits (5/hour per user)

**Bot Not Responding:**
- Check the bot is online
- Verify the bot has "Send Messages" and "Use Application Commands" permissions
- Check for Discord outages at https://discordstatus.com

**Rules Reactions Not Working:**
- Ensure the bot has "Add Reactions" and "Manage Roles" permissions
- Verify the bot's role is higher than the role it is trying to assign
- Check `/rules-setup view` to confirm configuration

**Reaction Roles Not Assigning:**
- Run `/reactionrole validate` to check for issues
- Ensure the bot's role is above the roles it is trying to assign
- Verify the message still exists in the channel

**XP Not Being Tracked:**
- Confirm the XP system is enabled with `/xp-setup enable`
- Check if the channel is in the ignore list
- Users earn XP once per cooldown period (default: 60 seconds)

**Starboard Not Posting:**
- Verify the starboard channel still exists
- Check the reaction threshold is not set too high
- Ensure the starboard is toggled on (`/starboard toggle`)

**Bait Channel False Positives:**
- Use test mode (`/baitchannel detection test-mode enabled:true`) to evaluate without acting
- Adjust threshold (`/baitchannel detection detection threshold:70`) or add roles to whitelist

**Memory Tags Out of Sync:**
- Run `/memory-setup tag-list` to check, `/memory-setup tag-reset` to fix

**Events Not Sending Reminders:**
- Verify reminder channel is set and the event has a reminder configured

**Onboarding Not Triggering:**
- Ensure enabled (`/onboarding enable`) with at least one step (`/onboarding step-list`)

**AutoMod Rules Not Triggering:**
- Check exemptions and rule status with `/automod rule list`

**Dashboard Actions Not Reflecting:**
- Ensure the bot is running and the internal API port (3002) is accessible

---

## Quick Reference

### Essential Commands

| Command | Purpose | Required Role |
|---------|---------|---------------|
| `/bot-setup` | Setup dashboard | Admin |
| `/role list` | View configured roles | Admin |
| `/data-export` | Export server data | Admin |
| `/bot-reset` | Factory reset | Admin |
| `/archive cleanup` | Clean archived data | Admin |
| `/ticket-setup` | Configure ticket system | Admin |
| `/ticket type list` | View ticket types | Admin |
| `/ticket workflow enable` | Enable ticket workflow | Admin |
| `/ticket workflow autoclose-enable` | Enable auto-close | Admin |
| `/ticket sla enable` | Enable SLA tracking | Admin |
| `/ticket routing enable` | Enable smart routing | Admin |
| `/application-setup` | Configure applications | Admin |
| `/application position add` | Create application position | Admin |
| `/application position fields` | Configure position fields | Admin |
| `/application position list` | View positions | Admin |
| `/announcement` | Send announcements | Admin |
| `/announcement template list` | View announcement templates | Admin |
| `/rules-setup setup` | Configure rules system | Admin |
| `/reactionrole create` | Create reaction role menu | Admin |
| `/reactionrole list` | View reaction role menus | Admin |
| `/baitchannel setup setup` | Configure bait channel | Admin |
| `/baitchannel setup status` | View bait channel status | Admin |
| `/memory-setup setup` | Configure memory system | Admin |
| `/memory add` | Create memory item | Admin |
| `/starboard setup` | Configure starboard | Admin |
| `/xp-setup enable` | Enable XP system | Admin |
| `/xp-setup config` | Configure XP settings | Admin |
| `/event create` | Create an event | Admin |
| `/event setup enable` | Enable events system | Admin |
| `/onboarding enable` | Enable onboarding | Admin |
| `/insights setup` | Configure analytics | Admin |
| `/automod rule create` | Create AutoMod rule | Admin |
| `/rank` | View XP rank | All |
| `/leaderboard` | View XP leaderboard | All |
| `/ping` | Check bot status | All |
| `/coffee` | Support Cogworks | All |
| `/server` | Development Discord invite | All |
| `/dashboard` | Open web dashboard | All |

### Setup Checklist

- [ ] Run `/bot-setup` (setup dashboard)
- [ ] Configure admin and staff roles
- [ ] Set up ticket system
- [ ] Customize ticket types (optional)
- [ ] Enable ticket workflow (optional)
- [ ] Set up application system (if needed)
- [ ] Configure announcements (if needed)
- [ ] Set up rules acknowledgment (if needed)
- [ ] Set up reaction role menus (if needed)
- [ ] Set up bait channel (if needed)
- [ ] Set up memory system (if needed)
- [ ] Set up starboard (if needed)
- [ ] Set up XP system (if needed)
- [ ] Set up events system (if needed)
- [ ] Configure onboarding (if needed)
- [ ] Enable analytics (if needed)
- [ ] Configure AutoMod rules (if needed)
- [ ] Test each enabled system
- [ ] Train staff on commands
- [ ] Review rate limits
- [ ] Export data to verify

For command reference, see [Commands Documentation](commands.md)
