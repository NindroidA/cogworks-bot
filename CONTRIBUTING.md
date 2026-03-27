# Contributing to Cogworks Bot

Thanks for your interest in contributing! This document covers how to set up the project and submit changes.

## Prerequisites

- [Bun](https://bun.sh) runtime
- MySQL 8.0+
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- Node.js 18+ (for TypeORM CLI)

## Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/NindroidA/cogworks-bot.git
   cd cogworks-bot
   bun install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Set `RELEASE=dev` in `.env` to use the development bot token and enable `synchronize: true` for the database.

4. Start the bot:
   ```bash
   bun run dev
   ```

## Development Workflow

```bash
bun run dev        # Watch mode
bun run build      # TypeScript compilation
bun run check      # Lint + format check
bun run check:fix  # Auto-fix lint + format
bun test           # Run tests
```

## Code Style

- **Biome** handles linting and formatting (config in `biome.json`)
- Single quotes, semicolons, trailing commas, 120-char line width
- Use `enhancedLogger` instead of `console.log` in production code
- Use `lang` module for all user-facing strings (no hardcoded text)
- Use `lazyRepo()` for database repository access
- Use `MessageFlags.Ephemeral` (not deprecated `ephemeral: true`)

## Critical Rules

1. **Guild-scope all queries** — every database query must filter by `guildId`
2. **Delete Discord first, then DB** — use `verifiedChannelDelete`/`verifiedThreadDelete`
3. **Rate limit all commands** — use `rateLimiter.check()` with appropriate limits
4. **Validate permissions** — use `requireAdmin()` before admin-only operations

See `CLAUDE.md` for the full developer guide.

## Pull Requests

- Create a feature branch from `main`
- Ensure `bun run build` and `bun run check` pass
- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why

## Reporting Issues

Use GitHub Issues with the appropriate template (bug report or feature request).

## License

By contributing, you agree that your contributions will be licensed under the PolyForm Noncommercial License 1.0.0.
