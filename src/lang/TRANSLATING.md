# Translating Cogworks Bot

Cogworks ships with English (`en`) as the reference language. Every other locale
lives in a sibling directory under [`src/lang/`](.) and can be translated
independently. Missing keys in any non-English locale **transparently fall back
to English**, so partial translations are welcome.

## Layout

```
src/lang/
├── en/             ← reference, always complete
├── es/             ← Spanish
├── pt-BR/          ← Brazilian Portuguese
├── fr/             ← French
├── de/             ← German
└── index.ts        ← loader + fallback proxy
```

Each locale directory mirrors the English one: same filenames (`ticket.json`,
`application.json`, …), same key structure. The loader at
[`src/lang/index.ts`](./index.ts) wraps every locale in a Proxy that defers to
English for any missing key, so you can translate one file at a time.

## Adding or updating a translation

1. **Pick the locale directory** you want to work on (e.g. `src/lang/es/`).
2. **Open the JSON file** whose strings you want to translate (e.g. `ticket.json`).
3. **Translate the values** — keep the keys and JSON structure identical to
   English. Only the string values change.
4. **Preserve formatting tokens** (see below).
5. **Test locally** by running the bot with `RELEASE=dev` and setting your test
   guild's locale via `/bot-setup` → Language.

You do not need to translate every file or every key. Anything missing falls
back to English at runtime.

## Formatting tokens & placeholders

Some strings contain placeholders the bot substitutes at runtime. Leave these
tokens exactly as-is; only translate the surrounding prose.

- `{{name}}`, `{username}` style placeholders — always preserve verbatim.
- Discord mentions such as `<@{userId}>`, `<#{channelId}>`, `<@&{roleId}>` —
  never translate angle brackets, ampersands, or IDs.
- Markdown syntax (`**bold**`, `*italic*`, `` `code` ``, `>`, `-`) — preserve
  markers, translate the enclosed text.
- Emoji (`🎫`, `⚠️`, …) — leave in place unless a different symbol is more
  idiomatic in your locale.
- Newlines (`\n`) — preserve; they separate sections in embeds and replies.

## Tone and voice

- Match the English voice: friendly, concise, moderator-facing.
- Prefer the informal second person where the locale supports it (`tú` in
  Spanish, `du` in German, `tu` in French) — Discord users expect that tone.
- Use your locale's standard Discord terminology (e.g. "canal" in Spanish for
  "channel", "Server" in German for "server" — loanwords are fine when they are
  the community norm).

## Quality checklist before opening a PR

- [ ] JSON is valid (no trailing commas, matched braces).
- [ ] Keys match English exactly; only values changed.
- [ ] Placeholders (`{...}`, `<@...>`, `\n`) are preserved.
- [ ] Strings aren't truncated — Discord embeds render multi-line text fine, but
      some select-menu labels have 100-character limits. Test any string that
      appears in a select menu.
- [ ] No English left in the files you touched (unless a term is intentionally
      untranslated, e.g. a proper noun).
- [ ] Ran `bun run check` and `bun test` locally.

## Adding a brand-new locale

1. Create a new directory under `src/lang/` named after the BCP-47 code
   (`fr-CA`, `ja`, `zh-Hant`, …).
2. Copy `src/lang/en/*.json` into it as a starting scaffold.
3. Add the locale code to the `SUPPORTED_LOCALES` array in
   [`src/lang/index.ts`](./index.ts).
4. Add a friendly label for it to `LOCALE_LABELS` in
   [`src/commands/handlers/botSetup/index.ts`](../commands/handlers/botSetup/index.ts).
5. Open a PR — the review will cover code + a spot-check of your translations.

## Questions?

Open a draft PR early with the files you're working on. Getting feedback on the
first few translated strings is much easier than re-doing an entire file.
