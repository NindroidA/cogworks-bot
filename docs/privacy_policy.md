# Privacy Policy for Cogworks Bot

**Last Updated:** January 5, 2026

## 1. Introduction

Cogworks Bot ("the Bot") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect information when you interact with our Discord bot.

By using Cogworks Bot, you agree to the collection and use of information in accordance with this policy.

## 2. Information We Collect

### 2.1 Automatically Collected Information

When you interact with the Bot, we automatically collect:

- **Discord User ID**: Your unique Discord identifier
- **Discord Guild ID**: The server where the Bot is used
- **Message Content**: Only for specific features (tickets, applications, bait channels)
- **Channel IDs**: Where interactions occur
- **Role IDs**: For permission management
- **Timestamps**: When actions are performed

### 2.2 User-Provided Information

Information you explicitly provide through:

- **Ticket Submissions**: Messages and content within ticket channels
- **Custom Ticket Types**: Type configurations, custom fields, and display settings
- **Email Imports**: Email content imported as tickets (sender, subject, body, attachments)
- **Application Forms**: Responses to custom application questions
- **Command Interactions**: Parameters and options provided to commands
- **Configuration Settings**: Server-specific setup preferences
- **User Restrictions**: Per-user ticket type access restrictions

## 3. How We Use Your Information

We use collected information for the following purposes:

### 3.1 Core Functionality
- **Ticket Management**: Creating, tracking, and archiving support tickets
- **Announcement Distribution**: Sending server announcements with proper mentions
- **Application Processing**: Managing and reviewing user-submitted applications
- **Role Management**: Configuring and maintaining permission-based access
- **Bait Channel Anti-Bot System**: Detection and removal of automated bots
  - Detection flags and suspicion scores (account age, membership duration, message count)
  - Action logging (ban, kick, log-only)
  - Whitelist management for roles and users

### 3.2 System Operations
- **Error Logging**: Diagnosing and fixing technical issues
- **API Integration**: Connecting with external NindroidSystems services
- **Activity Tracking**: Maintaining leaderboards and user statistics
- **Configuration Storage**: Preserving server-specific settings

### 3.3 Security & Moderation
- **Ban Appeal Processing**: Reviewing and responding to ban appeals
- **User Verification**: Age verification and identity confirmation
- **Abuse Prevention**: Detecting and preventing system misuse

## 4. Data Storage and Security

### 4.1 Storage Methods
- **Database**: TypeORM-based MySQL database
- **File System**: Archived transcripts and metadata (temporary -- only saved when converting ticket to txt file, then immediately removed from storage after)
- **In-Memory**: Cached configuration and active sessions

### 4.2 Security Measures
- Encrypted database connections
- Access-controlled admin commands
- Role-based permission systems
- Automatic session expiration (2-minute timeout on confirmations)
- Secure API authentication with request tracking

### 4.3 Data Retention
- **Active Tickets**: Retained until closed and archived
- **Archived Tickets**: Retained indefinitely for record-keeping
- **Custom Ticket Types**: Retained while Bot is active in server
- **User Restrictions**: Retained while Bot is active in server
- **Applications**: Retained until reviewed and processed
- **Bait Channel Logs**: Detection events retained for statistics and auditing
- **Configuration Data**: Retained while Bot is active in server
- **Error Logs**: Retained for debugging purposes (personally identifiable information removed)

## 5. Data Sharing and Disclosure

### 5.1 Third-Party Services

We may share data with:

- **Cogworks API**: For integration with NindroidSystems Homepage
- **Discord**: As required for Bot functionality via Discord's API

### 5.2 No Sale of Data

We **do not** sell, trade, or rent your personal information to third parties.

### 5.3 Legal Requirements

We may disclose information if required by law or in response to valid legal processes.

## 6. Your Data Rights

### 6.1 Access and Correction
You have the right to:
- Request information about data we store about you
- Request correction of inaccurate data
- Request deletion of your data (subject to operational requirements)

### 6.2 Data Deletion Requests
To request data deletion, contact the bot owner. We will:
- Remove your data from active systems within 30 days
- Retain archived records only as required for server moderation

### 6.3 Opt-Out Options
- **Leave Server**: Removes you from future data collection
- **Close Tickets**: Prevents further ticket-related data collection
- **Contact Owner**: Request specific feature opt-outs

## 7. Children's Privacy

Cogworks Bot may implement age verification features. We do not knowingly collect information from users under 13 without parental consent, in compliance with COPPA (Children's Online Privacy Protection Act).

## 8. International Users

By using Cogworks Bot, you consent to the transfer of your information to servers located in the United States or other countries where our infrastructure operates.

## 9. Changes to This Privacy Policy

We may update this Privacy Policy periodically. Changes will be:
- Reflected in the "Last Updated" date at the top
- Announced in servers where the Bot is active (for major changes)

Continued use of the Bot after changes constitutes acceptance of the updated policy.

## 10. Contact Information

For questions, concerns, or data requests regarding this Privacy Policy, please contact:

- **Discord**: (Nindroid's Development Server will be added here later)
- **GitHub**: https://github.com/NindroidA/cogworks-bot

## 11. Consent

By using Cogworks Bot, you acknowledge that you have read and understood this Privacy Policy and consent to the collection, use, and storage of your information as described herein.
