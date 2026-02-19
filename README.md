# Cogworks Bot

A modular Discord server management bot built for communities that need more than just moderation. Tickets, applications, announcements, reaction roles, rules enforcement, anti-bot detection, and more — all in one bot with per-server isolation.

<p>
  <img src="https://img.shields.io/github/package-json/v/NindroidA/cogworks-bot?style=flat-square&color=blue" alt="Version" />
  <img src="https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun&logoColor=white" alt="Bun" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
  <img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/NindroidA/cogworks-bot/main/.github/badges/loc.json&style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBvbHlsaW5lIHBvaW50cz0iMTYgMTggMjIgMTIgMTYgNiIvPjxwb2x5bGluZSBwb2ludHM9IjggNiAyIDEyIDggMTgiLz48L3N2Zz4=" alt="Lines of Code" />
</p>

## Quick Start

```
/bot-setup
```

The setup wizard auto-detects what's already configured and walks you through the rest.

## Features

<table>
<tr>
<td width="50%" valign="top">

### Tickets
- Custom ticket types with configurable fields
- Admin-only mode for sensitive tickets
- Forum-based archive with full transcripts
- Per-type staff ping settings
- Email import support
- User restrictions per ticket type

</td>
<td width="50%" valign="top">

### Applications
- Position-based application system
- Modal forms with custom questions
- Forum-based archive for closed applications
- Streamlined review workflow

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Reaction Roles
- Create menus with emoji-to-role mappings
- **Normal** — select multiple roles
- **Unique** — one role at a time (auto-swap)
- **Lock** — once selected, can't be removed
- Up to 25 menus / 20 options each

</td>
<td width="50%" valign="top">

### Rules Acknowledgment
- Post a rules message in any channel
- Users react to receive a configured role
- Un-react removes the role
- Custom message text and emoji
- Role hierarchy validation on setup

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Announcements
- Rich embed templates (maintenance, updates, back online)
- Preview before sending with Send/Cancel
- Discord timestamps (user timezone)
- Scheduled announcements
- Auto-publish to news channels

</td>
<td width="50%" valign="top">

### Memory System
- Forum-based tracker for bugs, features, suggestions, reminders, notes
- Capture messages directly into the tracker
- Category and status tags with custom tag support
- Status-driven thread archiving

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Bait Channel (Anti-Bot)
- 7 detection flags with suspicion scoring (0-100)
- Configurable actions: ban, kick, or log-only
- Whitelist management for trusted users/roles
- Smart detection: account age, membership, message count
- Grace period with countdown

</td>
<td width="50%" valign="top">

### Outage Status
- Bot owner sets operational status levels
- Bot presence updates automatically (Online/Idle/DND)
- Health check integration with auto-recovery
- 24-hour manual override window
- Optional status channel posting

</td>
</tr>
</table>

---

### And Also...

- **Role Management** — Admin/staff roles with custom aliases
- **Health Monitoring** — HTTP endpoints for Docker health checks
- **Data Export** — GDPR-compliant `/data-export` for full server data
- **Auto-Cleanup** — All data removed when bot leaves a server
- **Setup Wizard** — `/bot-setup` configures everything in one guided flow

## Multi-Server Architecture

Every piece of data is scoped to the guild it belongs to. Servers never see each other's config, tickets, applications, or logs. All database queries are filtered by `guildId` with indexed columns for performance.

## Security

| Layer | Protection |
|-------|------------|
| **Rate Limiting** | Per-user, per-guild, and global throttles |
| **Permissions** | Admin/staff/owner validation on every command |
| **Input Sanitization** | Discord markdown escaping, snowflake validation, parameterized SQL |
| **Data Isolation** | Guild-scoped queries on all entities |
| **GDPR** | Data export + automatic deletion on guild leave |

## Documentation

| Document | Description |
|----------|-------------|
| [Commands](docs/commands.md) | Full command reference |
| [Privacy Policy](docs/privacy_policy.md) | Data handling policy |
| [Terms of Service](docs/terms_of_service.md) | Usage terms |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript 5.9 |
| Runtime | Bun (Node.js compatible) |
| Framework | Discord.js v14 |
| Database | MySQL + TypeORM |
| Deployment | Docker |
| Testing | Jest + ts-jest |
| Logging | Structured logging with categories |
| Monitoring | HTTP health endpoints |

## License

MIT License — see [LICENSE](LICENSE) for details.

## Support

For issues or questions, open an issue on GitHub.

Use `/coffee` in Discord to support Cogworks development.

## Development

Since the release of version 2.0.0, Cogworks development has been accelerated through the use of AI-assisted development tools, including GitHub Copilot, Claude, and other AI programming assistants. These tools have enhanced productivity while maintaining code quality and best practices. All AI-generated code and documentation has been reviewed, tested, and refined to ensure reliability and security.
