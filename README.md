# cogworks-bot

Discord ticketing bot developed for ease-of-use

## Overview

A comprehensive Discord bot for server management featuring:
- 🎫 Advanced ticket system with archiving
- 📝 Application management with custom positions
- 📢 Announcement system with rich embeds and previews
- 🎣 Bait channel anti-bot detection system
- 👥 Role management for staff
- 🌐 Multi-server support with full data isolation
- 🛡️ GDPR-compliant data export and deletion
- 🔧 Robust development/production mode separation
- 🛡️ Comprehensive error handling with rate limiting
- 📊 Archive migration and database storage
- ❤️‍🩹 Health monitoring with HTTP endpoints
- 📝 Production-grade logging system
- ⚡ Bun-powered runtime with Node.js fallback

Built with TypeScript, Discord.js, TypeORM, and Bun.

## Documentation

- **[Commands](docs/commands.md)** - Available bot commands
- **[Privacy Policy](docs/privacy_policy.md)** - Data handling policy
- **[Terms of Service](docs/terms_of_service.md)** - Usage terms

## Features

### Multi-Server Ready 🌐
- **Full Data Isolation**: Each server's data completely separated
- **GDPR Compliance**: `/data-export` command for admins
- **Automatic Cleanup**: Data deleted when bot leaves a server
- **Guild-Scoped Queries**: All database operations isolated by server
- **Performance Optimized**: Indexed queries for fast multi-server operation

### Ticket System
- Create support tickets with custom categories
- Admin-only mode for sensitive tickets
- Automatic archiving with full transcripts
- Age verification for 18+ tickets
- Archive migration from YAGPDB
- Per-server configuration and isolation

### Application System
- Custom application positions
- Template-based applications
- Age verification for positions
- Application archiving
- Server-specific positions and templates

### Announcement System
- Rich embed templates (maintenance, updates, back online)
- Preview system with Send/Cancel buttons
- Discord timestamps with timezone support
- Role pinging support
- Auto-publish to news channels
- Scheduled announcements
- Configurable per server

### Bait Channel System
- Smart spam/bot detection with 7 detection flags
- Configurable actions (ban, kick, log-only)
- Suspicion scoring (0-100)
- Whitelist management
- Activity tracking and leaderboards
- Grace period with countdown timer
- Independent configuration per server

### Security & Rate Limiting 🔒
- **User-level rate limiting**: Prevents spam and abuse
- **Guild-level rate limiting**: Protects server resources
- **Permission validation**: Comprehensive permission checks
- **Command throttling**: 30 commands/minute per user globally
- **Data export limits**: Once per 24 hours per server
- **Application limits**: 2 submissions per day per user

### Admin Tools
- Role management (add/remove/get)
- Bot configuration per server
- Global staff role support
- Archive analysis and migration
- Data export for GDPR compliance

## Commands

Run `/bot-setup` in your Discord server to get started. See [docs/commands.md](docs/commands.md) for full command list.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

For issues or questions, open an issue on GitHub.

## Development
Since the release of version 2.0.0, Cogworks development has been accelerated through the use of AI-assisted development tools, including GitHub Copilot, Claude, and other AI programming assistants. These tools have enhanced productivity while maintaining code quality and best practices. All AI-generated code and documentation has been reviewed, tested, and refined to ensure reliability and security interests.

**Note**: This bot is in active development. Some features may be incomplete or subject to change.
