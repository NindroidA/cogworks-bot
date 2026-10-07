# Translating Cogworks Bot

Cogworks ships in English (`en`) only. The locale machinery is still in place,
so a translation can be added without touching the rest of the code: you add
**only the strings you have translated**, and every file or key you leave out
**falls back to English** at runtime. Partial translations are welcome.

(Earlier releases carried `es`, `pt-BR`, `fr` and `de` directories, but they
were untranslated copies of an old English snapshot, so 3.16.19 removed them.
Guilds that had picked one of those now read English.)

## Layout

```
src/lang/
├── en/             ← reference, always complete (one JSON file per feature)
├── <code>/         ← a translation: only the files and keys it translates
├── index.ts        ← LOCALE_REGISTRY + loader + English fallback Proxy
└── types.ts        ← the Language shape (derived from the English files)
```

A translation file mirrors the English file of the same name (`ticket.json`,
`general.json`, …) but contains **only the keys you translated**, at the same
nesting. For example, a Spanish `src/lang/es/ticket.json` that translates two
strings is just:

```json
{
  "created": "Tu ticket fue creado: ",
  "setup": {
    "createTicket": "Crear ticket"
  }
}
```

Everything else in `ticket.json`, and every file you didn't create, reads from
English. Don't copy the English files as a starting point: untranslated copies
stop picking up English fixes and new keys.

## Adding a new locale

1. Create `src/lang/<code>/` named after the BCP-47 code (`es`, `pt-BR`,
   `fr-CA`, `ja`, …) and add the JSON files you've translated, each holding only
   its translated keys.
2. In [`src/lang/index.ts`](./index.ts), import those files and add one entry to
   `LOCALE_REGISTRY`:

   ```ts
   import generalEs from './es/general.json';
   import ticketEs from './es/ticket.json';

   const LOCALE_REGISTRY = {
     en: { label: 'English', modules: englishModules },
     es: { label: 'Español', modules: { general: generalEs, ticket: ticketEs } },
   } satisfies Record<string, LocaleDefinition>;
   ```

   `label` is the native name shown in the picker. The module keys are the
   English file names without `.json`.
3. That's the whole registration. `SUPPORTED_LOCALES` is derived from the
   registry, and the **Language** button on the `/bot-setup` dashboard appears
   automatically once more than one locale is registered. No database migration is needed:
   `BotConfig.locale` already stores the code. (See "Wiring and testing" for
   where translated strings actually show up.)

To translate more strings later, add keys to the existing files or add new
files and list them in the locale's `modules`.

## Wiring and testing

Translated strings only appear where code reads the guild's language with
`await getGuildLang(guildId)` instead of the English `lang` export. Today every
call site uses `lang`, so shipping the first real translation also means
switching the call sites it covers to `getGuildLang`.

To test, run the bot with `RELEASE=dev`, open `/bot-setup`, click **Language**,
pick your locale, and exercise the commands you wired up.

## Formatting tokens & placeholders

Some strings contain placeholders the bot substitutes at runtime. Leave these
tokens exactly as-is; only translate the surrounding prose.

- `{name}` placeholders — keep each one exactly as written, but move it
  wherever your grammar needs it.
- Discord mentions such as `<@{userId}>`, `<#{channelId}>`, `<@&{roleId}>` —
  never translate angle brackets, ampersands, or IDs.
- Markdown syntax (`**bold**`, `*italic*`, `` `code` ``, `>`, `-`) — preserve
  markers, translate the enclosed text.
- Emoji (`🎫`, `⚠️`, …) — leave in place unless a different symbol is more
  idiomatic in your locale.
- Newlines (`\n`) — preserve; they separate sections in embeds and replies.
- Arrays (for example `general.presenceMessages`) are replaced as a whole: if
  you translate one, provide the full list.

## Tone and voice

- Match the English voice: friendly, concise, moderator-facing.
- Prefer the informal second person where the locale supports it (`tú` in
  Spanish, `du` in German, `tu` in French) — Discord users expect that tone.
- Use your locale's standard Discord terminology (e.g. "canal" in Spanish for
  "channel", "Server" in German for "server" — loanwords are fine when they are
  the community norm).

## Quality checklist before opening a PR

- [ ] JSON is valid (no trailing commas, matched braces).
- [ ] Every key exists in the English file at the same path (a misspelled key is
      silently ignored and the English string shows instead).
- [ ] The files contain only translated strings, not untranslated English copies.
- [ ] Placeholders (`{...}`, `<@...>`, `\n`) are preserved.
- [ ] Strings aren't truncated — Discord embeds render multi-line text fine, but
      some select-menu labels have 100-character limits. Test any string that
      appears in a select menu.
- [ ] Ran `bun run check` and `bun run test` locally.

## Questions?

Open a draft PR early with the files you're working on. Getting feedback on the
first few translated strings is much easier than re-doing an entire file.
