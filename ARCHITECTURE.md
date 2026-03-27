# Cogworks Bot — Architecture

## System Overview

```mermaid
graph TB
    subgraph Discord["Discord Gateway"]
        Events[Events]
        Commands[Slash Commands]
        Components[Buttons/Modals/Menus]
    end

    subgraph Bot["Cogworks Bot"]
        Index[index.ts<br/>Entry Point]
        Router[commands.ts<br/>Command Router]
        EventHandlers[Event Handlers]
        InteractionRouter[interactionRouter.ts<br/>Component Router]

        subgraph Features["Feature Handlers"]
            Tickets[Ticket System]
            Apps[Application System]
            Announce[Announcements]
            BaitCh[Bait Channel]
            Memory[Memory System]
            RR[Reaction Roles]
            XP[XP & Levels]
            Events2[Events]
            Star[Starboard]
            Onboard[Onboarding]
            Status[Status]
            Insights[Insights]
        end

        subgraph Utils["Shared Utilities"]
            Validation[Permission<br/>Validation]
            RateLimit[Rate Limiter]
            ErrorHandler[Error Handler]
            EmbedBuilders[Embed Builders]
            Sanitizer[Input Sanitizer]
            Logger[Enhanced Logger]
            VerifiedDelete[Verified Delete]
        end

        subgraph Data["Data Layer"]
            TypeORM[TypeORM DataSource]
            Entities[Entities]
            Migrations[Migrations]
            LazyRepo[lazyRepo]
        end

        API[Internal API<br/>Port 3002]
        Health[Health Server]
    end

    subgraph External["External"]
        MySQL[(MySQL)]
        Dashboard[Web Dashboard]
    end

    Commands --> Router
    Events --> EventHandlers
    Components --> InteractionRouter

    Router --> Features
    EventHandlers --> Features
    InteractionRouter --> Features

    Features --> Utils
    Features --> Data
    API --> Data

    Data --> MySQL
    Dashboard --> API
    Health --> Index
```

## Command Flow

```mermaid
sequenceDiagram
    participant U as User
    participant D as Discord
    participant R as Command Router
    participant H as Handler
    participant V as Validators
    participant DB as Database

    U->>D: /ticket setup
    D->>R: ChatInputCommandInteraction
    R->>R: Global rate limit check (30/min)
    R->>R: Guild validation
    R->>R: BotConfig check
    R->>H: Route to handler
    H->>V: requireAdmin(interaction)
    V-->>H: { allowed: true }
    H->>DB: Query/Update (guild-scoped)
    DB-->>H: Result
    H->>D: Reply (ephemeral)
    R->>R: Record metrics
```

## Entity Relationships

```mermaid
erDiagram
    BotConfig ||--o{ Guild : "one per guild"

    TicketConfig ||--o{ CustomTicketType : has
    TicketConfig ||--o{ Ticket : manages
    Ticket ||--o| ArchivedTicket : "closes to"
    ArchivedTicketConfig ||--o{ ArchivedTicket : archives

    ApplicationConfig ||--o{ Position : has
    Position ||--o{ Application : receives
    Application ||--o| ArchivedApplication : "closes to"

    AnnouncementConfig ||--o{ AnnouncementTemplate : has
    AnnouncementConfig ||--o{ AnnouncementLog : logs

    ReactionRoleMenu ||--o{ ReactionRoleOption : "CASCADE"

    MemoryConfig ||--o{ MemoryItem : tracks
    MemoryConfig ||--o{ MemoryTag : organizes

    XPConfig ||--o{ XPUser : tracks
    XPConfig ||--o{ XPRoleReward : rewards

    StarboardConfig ||--o{ StarboardEntry : highlights

    EventConfig ||--o{ EventTemplate : templates
    EventConfig ||--o{ EventReminder : schedules

    OnboardingConfig ||--o{ OnboardingCompletion : tracks

    BaitChannelConfig ||--o{ BaitChannelLog : logs
    BaitChannelConfig ||--o{ BaitKeyword : detects
```

## Event Handling

```mermaid
graph LR
    subgraph "Discord Events"
        MC[messageCreate]
        MD[messageDelete]
        CD[channelDelete]
        RD[roleDelete]
        TD[threadDelete]
        GMA[guildMemberAdd]
        GD[guildDelete]
        MRA[messageReactionAdd]
    end

    subgraph "Handlers"
        XPMsg[XP Message Handler]
        CleanMsg[Message Cleanup<br/>8 entities]
        CleanCh[Channel Cleanup<br/>13 entities]
        CleanRole[Role Cleanup<br/>9 entities]
        CleanThread[Thread Cleanup<br/>MemoryItem]
        Onboard[Onboarding Join]
        GDPR[GDPR Full Purge]
        StarRx[Starboard Reaction]
        RulesRx[Rules Reaction]
        RRHandler[Reaction Role Handler]
    end

    MC --> XPMsg
    MD --> CleanMsg
    CD --> CleanCh
    RD --> CleanRole
    TD --> CleanThread
    GMA --> Onboard
    GD --> GDPR
    MRA --> StarRx
    MRA --> RulesRx
    MRA --> RRHandler
```

## Ticket Close Workflow

```mermaid
flowchart TD
    Start[Close Triggered] --> Mark[Mark ticket 'closed']
    Mark --> Transcript[Create transcript .txt + .zip]
    Transcript -->|fail| ErrReply[Return error to caller]
    Transcript -->|ok| Forum[Fetch archive forum channel]
    Forum --> TypeInfo{Custom or legacy type?}
    TypeInfo -->|custom| DBLookup[Query CustomTicketType]
    TypeInfo -->|legacy| LegacyMap[Use LEGACY_TYPE_INFO]
    TypeInfo -->|none| NoTag[Skip tags]
    DBLookup --> EnsureTag[ensureForumTag]
    LegacyMap --> EnsureTag
    EnsureTag --> Exists{Existing archive?}
    NoTag --> Exists
    Exists -->|no| CreatePost[Create forum thread]
    Exists -->|yes| AddToPost[Add transcript to thread]
    CreatePost --> ApplyTags[Apply forum tags]
    AddToPost --> MergeTags[Merge new tags with existing]
    ApplyTags --> SaveArchive[Save ArchivedTicket to DB]
    MergeTags --> Cleanup[Delete temp files]
    SaveArchive --> Cleanup
    Cleanup --> DeleteCh[verifiedChannelDelete]
    DeleteCh --> Done[Done]
```

## Internal API

```
POST /internal/guilds/:guildId/<feature>/<action>
Authorization: Bearer <COGWORKS_INTERNAL_API_TOKEN>
```

Handlers registered in `src/utils/api/handlers/`:
- **tickets** — close, assign
- **applications** — list, review
- **announcements** — send
- **memory** — list, add
- **reactionRoles** — list, sync
- **setup** — dashboard state, system configuration
- **config** — bot config read/write
- **guilds** — guild info, member counts

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Guild-scoped everything | Multi-tenant safety — no cross-server data leaks |
| Discord-first deletion | Delete Discord objects before DB records to prevent orphans |
| `lazyRepo()` pattern | Deferred repository init avoids accessing DataSource before ready |
| Forum tag accumulation | Merge tags on existing posts, never replace |
| Verified deletion helpers | Returns `{ success, alreadyGone, error }` — "already gone" counts as success |
| `lang` module | Centralized strings enable future i18n |
| Rate limiting at multiple levels | User, guild, and global throttles prevent abuse |
| Shared close workflow | Single `archiveAndCloseTicket()` used by both event and API handlers |
