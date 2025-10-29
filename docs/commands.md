# Cogworks Bot Commands

🚧 IMPORTANT: This document is still under construction and review, and may contain false or not up-to-date information.

**Last Updated:** October 29, 2025

Complete command reference for all bot systems.

## 🔧 Bot Setup & Configuration

### Comprehensive Setup Wizard
**`/bot-setup`**
- **Complete guided setup** for all bot systems in one command
- **Smart detection** - Automatically detects what's already configured
- **Auto-skip configured systems** - Only shows setup for missing features

#### Systems Configured:
1. **Global Staff Role** (optional)
   - Enable/disable global staff role

2. **Ticket System** (optional)
   - Ticket creation channel
   - Ticket category for organizing channels
   - Archive forum for closed tickets

3. **Application System** (optional)
   - Application submission channel
   - Application category for review channels
   - Archive forum for closed applications

4. **Announcement System** (optional)
   - Minecraft role for mentions
   - Default channel for announcements

5. **Bait Channel (Anti-Bot)** (optional)
   - Bait channel for bot detection
   - Action on detection (Ban/Kick/Log Only)
   - Grace period (0-60 seconds)
   - Optional log channel

6. **Staff & Admin Roles** (optional)
   - Add multiple staff roles with aliases
   - Add multiple admin roles with aliases

#### Smart Behavior:
- **Fresh setup**: Guides through all systems
- **Complete setup**: Allows updating of existing configurations
- **Custom welcome message**: Shows which systems are already configured

## 🎫 Ticket System

### Ticket Setup
**`/ticket-setup channel [channel]`**
- Configure ticket creation channel
- `channel` - Text channel to send the setup message to

**`/ticket-setup archive [channel]`**
- Configure ticket archive storage
- `channel` - Forum channel to send archived transcripts to

**`/ticket-setup category [category]`**
- Set the category for ticket channels
- `category` - Category to create ticket channels in

### Ticket Management
**`/ticket-reply bapple approve`**
- Approve a ban appeal ticket

**`/ticket-reply bapple deny`**
- Deny a ban appeal ticket

## 📢 Announcement System

### Announcement Setup
**`/announcement-setup minecraft-role:[role] default-channel:[channel]`**
- `minecraft-role` - Role to mention in announcements
- `default-channel` - Default channel for announcements

### Announcements
**`/announcement maintenance duration:[short|long]`**
- Send immediate maintenance announcement
- Shows preview with Send/Cancel buttons (2min timeout)

**`/announcement maintenance-scheduled time:[YYYY-MM-DD HH:MM] duration:[short|long]`**
- Schedule maintenance announcement
- Uses Discord timestamps (shows in user's timezone)

**`/announcement back-online`**
- Announce server is back online

**`/announcement update-scheduled version:[version] time:[YYYY-MM-DD HH:MM]`**
- Announce scheduled server update

**`/announcement update-complete version:[version]`**
- Announce update completion

All announcements display a preview before sending with Send/Cancel buttons.

## 📝 Application System

### Application Setup
**`/application-setup position-name:[name] questions:[q1|q2|q3...]`**
- Create custom application forms
- Questions separated by `|` character
- Automatically generates application button and form

### Application Management
Applications are submitted via modal forms and stored in the database.

## 👥 Role Management

### Adding Roles
**`/add-role admin [role_id] [alias]`**
- Add an admin role with custom alias
- `role_id` - The actual Discord Role ID
- `alias` - Custom name to refer to this role

**`/add-role staff [role_id] [alias]`**
- Add a staff role with custom alias
- `role_id` - The actual Discord Role ID
- `alias` - Custom name to refer to this role

### Removing Roles
**`/remove-role admin [role_id]`**
- Remove an admin role
- `role_id` - The actual Discord Role ID

**`/remove-role staff [role_id]`**
- Remove a staff role
- `role_id` - The actual Discord Role ID

### Viewing Roles
**`/get-roles`**
- Display all configured admin and staff roles with their aliases

## 🎣 Bait Channel System

### Basic Setup (via `/bot-setup`)
The bait channel system can be configured through the main setup wizard with basic settings:
- Bait channel selection
- Action type (Ban/Kick/Log Only)
- Grace period (0-60 seconds)
- Optional log channel

### Advanced Configuration
**`/baitchannel setup channel:[channel] grace_period:[0-60] action:[ban|kick|log-only] log_channel:[channel]`**
- Complete bait channel configuration
- `channel` - The hidden bait channel
- `grace_period` - Seconds to wait before action (0-60)
- `action` - What to do when bot detected (ban/kick/log-only)
- `log_channel` - Optional logging channel

**`/baitchannel detection enabled:[true|false]`**
- Configure smart detection settings
- Optional parameters:
  - `min_account_age` - Minimum account age in days (0-365)
  - `min_membership` - Minimum server membership in minutes (0-1440)
  - `min_messages` - Minimum message count (0-100)
  - `require_verification` - Require verification role

**`/baitchannel whitelist action:[add|remove] role:[role] user:[user]`**
- Manage whitelist for trusted users/roles
- `action` - Add or remove from whitelist
- `role` - Role to whitelist (optional)
- `user` - User to whitelist (optional)

**`/baitchannel status`**
- View current bait channel configuration and statistics

**`/baitchannel stats days:[1-90]`**
- View detailed statistics
- `days` - Number of days to analyze (default: 7)

**`/baitchannel toggle enabled:[true|false]`**
- Enable or disable the bait channel system
- `enabled` - true to enable, false to disable

### How It Works
1. Create a hidden text channel with no permissions for @everyone
2. Configure it as the bait channel
3. Automated bots often try to access all visible channels
4. When someone joins the bait channel, they're flagged
5. System takes configured action (ban/kick/log)
6. All detections are logged with timestamps and user info

### Security Features
- **Smart Detection**: Filter by account age, server membership, message count
- **Whitelist System**: Protect trusted users and roles
- **Grace Period**: Give users time to leave before action
- **Detailed Logging**: Track all detections with full context
- **Statistics**: Monitor bot activity over time

### Bait Channel Management
**Previously listed as:**
- `/bait-channel-setup` - Use `/baitchannel setup` instead
- `/bait-channel-disable` - Use `/baitchannel toggle` instead
- `/bait-channel-add-score` - Deprecated (not part of anti-bot system)
- `/bait-channel-leaderboard` - Deprecated (not part of anti-bot system)

## 📊 System Information

### Data Export (GDPR Compliance)
**`/data-export`**
- **Admin-only command**
- Exports all server data to JSON format
- Sent via DM for privacy
- **Rate limited**: Once per 24 hours per server
- **Includes**:
  - Bot configuration
  - Ticket configuration and active tickets
  - Application configuration and active applications
  - Announcement settings
  - Bait channel configuration
  - Saved roles (admin/staff)
  - Archived tickets and applications

**Data Privacy:**
- Data sent privately via DM
- Comprehensive export for compliance
- Automatic cleanup when bot leaves server
- Full transparency of stored data

### Error Handling
All commands use centralized error handling with:
- User-friendly error messages
- Automatic error logging
- Structured error codes (`VALIDATION_FAILED`, `DATABASE_ERROR`, `API_ERROR`, `PERMISSION_DENIED`, `NOT_FOUND`)

### API Integration
Commands that interact with NindroidSystems API include:
- Automatic retry logic
- Configurable timeouts
- Request/response logging
- User tracking for all API calls

## 🔒 Security Features

### Rate Limiting
All commands are protected with rate limiting:
- **Ticket creation**: 3 per hour per user
- **Application submission**: 2 per day per user
- **Announcements**: 5 per hour per user
- **Bot setup**: 5 per hour per guild
- **Data export**: Once per 24 hours per guild
- **Global throttle**: 30 commands/minute per user

### Permission Checks
- Every command validates user permissions
- Guild-only commands verified
- Admin/staff role validation
- Server owner bypass for critical commands

## 🔑 Permission Levels

| Level | Access |
|-------|--------|
| **Admin** | All commands + role management + setup + data export |
| **Staff** | Ticket replies only |
| **User**  | None (all commands are staff-only) |