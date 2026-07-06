/**
 * transcriptBuilder unit tests.
 *
 * The builder is pure over TranscriptMessage[] — no Discord client — so
 * these tests can drive it with synthetic arrays and assert on the exact
 * markdown output (chat-style format, v3.14.0).
 */

import { describe, expect, test } from "bun:test";
import {
  buildHeaderData,
  buildTranscript,
  chunkByMessageBoundary,
  formatDurationShort,
  formatMessage,
  type TicketMetadata,
  type TranscriptMessage,
} from "../../../../src/utils/ticket/transcriptBuilder";

function makeMessage(
  overrides: Partial<TranscriptMessage> = {},
): TranscriptMessage {
  return {
    author: { username: "alice", id: "111", bot: false },
    content: "Hello world",
    timestamp: new Date("2026-04-01T12:00:00Z"),
    attachments: [],
    embeds: [],
    stickers: [],
    poll: null,
    isSystem: false,
    hasOnlyComponents: false,
    ...overrides,
  };
}

const META: TicketMetadata = {
  title: "Ban Appeal",
  type: "Ban Appeal",
  createdByUsername: "alice",
  openedAt: new Date("2026-04-01T12:00:00Z"),
  closedAt: new Date("2026-04-01T14:14:00Z"),
  assignedToUsername: "staff_bob",
};

/** Joined text of all chunk contents — the "what does the archive say" view. */
function joinedContent(result: ReturnType<typeof buildTranscript>): string {
  return result.chunks.map((c) => c.content).join("\n");
}

describe("formatDurationShort()", () => {
  test("under a minute renders as <1m", () => {
    expect(formatDurationShort(5_000)).toBe("<1m");
  });

  test("minutes-only", () => {
    expect(formatDurationShort(47 * 60_000)).toBe("47m");
  });

  test("hours-and-minutes", () => {
    expect(formatDurationShort(2 * 60 * 60_000 + 14 * 60_000)).toBe("2h 14m");
  });

  test("hours-only when minutes are zero", () => {
    expect(formatDurationShort(3 * 60 * 60_000)).toBe("3h");
  });

  test("multi-day duration", () => {
    expect(formatDurationShort(3 * 24 * 60 * 60_000 + 5 * 60 * 60_000)).toBe(
      "3d 5h",
    );
  });

  test("multi-day duration with no hours", () => {
    expect(formatDurationShort(2 * 24 * 60 * 60_000)).toBe("2d");
  });
});

describe("buildHeaderData()", () => {
  test("ticket header carries all metadata fields", () => {
    const header = buildHeaderData(META, 5, 2);
    expect(header.title).toBe("🎫 Ban Appeal");
    const byName = Object.fromEntries(
      header.fields.map((f) => [f.name, f.value]),
    );
    expect(byName["Created by"]).toBe("alice");
    expect(byName.Type).toBe("Ban Appeal");
    expect(byName["Assigned to"]).toBe("staff_bob");
    expect(byName.Duration).toBe("2h 14m");
    expect(byName.Messages).toBe("5 · 2 📎");
    expect(byName.Opened).toMatch(/^<t:\d+:f>$/);
    expect(byName.Closed).toMatch(/^<t:\d+:f>$/);
  });

  test("messages field omits the attachment count when zero", () => {
    const header = buildHeaderData(META, 3, 0);
    const messages = header.fields.find((f) => f.name === "Messages");
    expect(messages?.value).toBe("3");
  });

  test("unassigned ticket renders Unassigned", () => {
    const header = buildHeaderData({ ...META, assignedToUsername: null }, 1, 0);
    const assigned = header.fields.find((f) => f.name === "Assigned to");
    expect(assigned?.value).toBe("Unassigned");
  });

  test("application kind gets the 📋 emoji and omits the empty assignee row", () => {
    const header = buildHeaderData(
      { ...META, kind: "application", assignedToUsername: null },
      1,
      0,
    );
    expect(header.title).toBe("📋 Ban Appeal");
    expect(header.fields.find((f) => f.name === "Assigned to")).toBeUndefined();
  });

  test("titles over Discord's 256-char embed limit are clamped (long email subjects)", () => {
    const header = buildHeaderData({ ...META, title: "s".repeat(400) }, 1, 0);
    expect(header.title.length).toBeLessThanOrEqual(256);
    expect(header.title.endsWith("…")).toBe(true);
  });
});

describe("buildHeaderData() enrichment rows (v3.16.0)", () => {
  const byName = (header: ReturnType<typeof buildHeaderData>) =>
    Object.fromEntries(header.fields.map((f) => [f.name, f.value]));

  test("bare metadata renders NO enrichment rows (absent data shows nothing)", () => {
    const fields = byName(buildHeaderData(META, 1, 0));
    for (const name of ["Ticket #", "Application #", "Closed by", "First response", "Outcome", "Reviewed by", "Participants"]) {
      expect(fields[name]).toBeUndefined();
    }
  });

  test("entityId renders Ticket # for tickets and Application # for applications", () => {
    expect(byName(buildHeaderData({ ...META, entityId: 42 }, 1, 0))["Ticket #"]).toBe("42");
    expect(byName(buildHeaderData({ ...META, entityId: 7, kind: "application" }, 1, 0))["Application #"]).toBe("7");
  });

  test("Closed by renders `username (`id`)` with both, and degrades to whichever exists", () => {
    expect(
      byName(buildHeaderData({ ...META, closedByUsername: "closer", closedById: "999" }, 1, 0))["Closed by"],
    ).toBe("closer (`999`)");
    expect(byName(buildHeaderData({ ...META, closedByUsername: "closer" }, 1, 0))["Closed by"]).toBe("closer");
    expect(byName(buildHeaderData({ ...META, closedById: "999" }, 1, 0))["Closed by"]).toBe("`999`");
  });

  test("First response renders the stamp; the SLA badge appends only when breached", () => {
    const when = new Date("2026-04-01T13:00:00Z");
    expect(byName(buildHeaderData({ ...META, firstResponseAt: when }, 1, 0))["First response"]).toMatch(
      /^<t:\d+:f>$/,
    );
    expect(
      byName(buildHeaderData({ ...META, firstResponseAt: when, slaBreached: true }, 1, 0))["First response"],
    ).toMatch(/^<t:\d+:f>\n⚠️ SLA breached$/);
  });

  test("breached with NO first response renders 'None' + badge (never answered)", () => {
    expect(byName(buildHeaderData({ ...META, slaBreached: true }, 1, 0))["First response"]).toBe(
      "None\n⚠️ SLA breached",
    );
  });

  test("Outcome and Reviewed by rows render for applications", () => {
    const fields = byName(
      buildHeaderData(
        { ...META, kind: "application", outcome: "Accepted", reviewedByUsername: "rev", reviewedById: "5" },
        1,
        0,
      ),
    );
    expect(fields.Outcome).toBe("Accepted");
    expect(fields["Reviewed by"]).toBe("rev (`5`)");
  });

  test("participants render as `name (count)` sorted, non-inline", () => {
    const header = buildHeaderData(META, 3, 0, [
      { username: "alice", count: 12 },
      { username: "bob", count: 5 },
    ]);
    const field = header.fields.find((f) => f.name === "Participants");
    expect(field?.value).toBe("alice (12), bob (5)");
    expect(field?.inline).toBe(false);
  });

  test("participants over the 1024-char field cap collapse the tail into '+N more'", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      username: `participant-with-a-rather-long-name-${String(i).padStart(2, "0")}`,
      count: 60 - i,
    }));
    const field = buildHeaderData(META, 3, 0, many).fields.find((f) => f.name === "Participants");
    expect(field).toBeDefined();
    expect(field!.value.length).toBeLessThanOrEqual(1024);
    expect(field!.value).toMatch(/\+\d+ more$/);
  });
});

describe("formatMessage()", () => {
  test("plain text renders unquoted under a name + short-time line", () => {
    const out = formatMessage(makeMessage({ content: "Hello\nWorld" }));
    expect(out).toMatch(/^\*\*alice\*\* · <t:\d+:t>\nHello\nWorld$/);
  });

  test("bot author gets a 🤖 badge", () => {
    const out = formatMessage(
      makeMessage({ author: { username: "cogworks", id: "999", bot: true } }),
    );
    expect(out).toContain("🤖 **cogworks** ·");
  });

  test("opener and assignee get 👤 / 🛡️ badges, others none", () => {
    const badges = { createdById: "111", assignedToId: "222" };
    expect(formatMessage(makeMessage(), badges)).toContain("👤 **alice**");
    expect(
      formatMessage(
        makeMessage({ author: { username: "staff_bob", id: "222", bot: false } }),
        badges,
      ),
    ).toContain("🛡️ **staff_bob**");
    expect(
      formatMessage(
        makeMessage({ author: { username: "carol", id: "333", bot: false } }),
        badges,
      ),
    ).toStartWith("**carol**");
  });

  test("reply adds ↳ marker with a context snippet", () => {
    const out = formatMessage(
      makeMessage({
        content: "got it",
        replyTo: { author: "staff_bob", content: "please confirm" },
      }),
    );
    expect(out).toContain('↳ *to staff_bob: "please confirm"*');
  });

  test("reply snippet strips markdown, collapses whitespace, and truncates", () => {
    const out = formatMessage(
      makeMessage({
        content: "ok",
        replyTo: { author: "bob", content: `**bold**\nand ${"x".repeat(80)}` },
      }),
    );
    expect(out).toContain('↳ *to bob: "bold and x');
    expect(out).toContain("…");
    expect(out).not.toContain("**bold**");
  });

  test("reply to an empty-bodied message falls back to the bare marker", () => {
    const out = formatMessage(
      makeMessage({ content: "ok", replyTo: { author: "bob", content: "" } }),
    );
    expect(out).toContain("↳ *to bob*");
  });

  test("multiple attachments render each as a preview-suppressed link line", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        attachments: [
          {
            name: "img.png",
            url: "https://cdn/img.png",
            contentType: "image/png",
          },
          { name: "log.txt", url: "https://cdn/log.txt" },
        ],
      }),
    );
    expect(out).toContain("📎 [img.png](<https://cdn/img.png>)");
    expect(out).toContain("📎 [log.txt](<https://cdn/log.txt>)");
  });

  test("attachment with empty URL renders as unavailable", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        attachments: [{ name: "gone.pdf", url: "" }],
      }),
    );
    expect(out).toContain("📎 ~~gone.pdf~~ (unavailable)");
  });

  test("attachment names with brackets can't break the link markup", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        attachments: [{ name: "a](https://evil).png", url: "https://cdn/a.png" }],
      }),
    );
    expect(out).toContain("📎 [a\\](https://evil).png](<https://cdn/a.png>)");
  });

  test("user lines mimicking author chrome or day dividers are neutralized", () => {
    const spoof = "🛡️ **Admin** · <t:1750000000:t>\n-# ── Fake Divider ──\nnormal text";
    const out = formatMessage(makeMessage({ content: spoof }));
    // The zero-width space breaks the fake bold/subtext markup.
    expect(out).toContain("🛡️ *​*Admin** · <t:1750000000:t>");
    expect(out).toContain("-​# ── Fake Divider ──");
    expect(out).toContain("normal text");
    // Genuine chrome from the builder itself is untouched.
    expect(out).toMatch(/^\*\*alice\*\* · <t:\d+:t>/);
  });

  test("code block content is preserved verbatim", () => {
    const content = "```js\nconst x = 1;\n```";
    const out = formatMessage(makeMessage({ content }));
    expect(out).toContain("```js\nconst x = 1;\n```");
  });

  test("embed with title + description renders blockquoted under the message", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        embeds: [
          { title: "Heads up", description: "This is important", fields: [] },
        ],
      }),
    );
    expect(out).toContain("> **Heads up**");
    expect(out).toContain("> This is important");
  });

  test("empty message falls back to placeholder so the header still lines up", () => {
    const out = formatMessage(makeMessage({ content: "" }));
    expect(out).toContain("*(no content)*");
  });

  test("long single message keeps ALL content — never truncated (carbon-copy)", () => {
    const body = "x".repeat(2000);
    const out = formatMessage(makeMessage({ content: body }));
    expect(out).not.toContain("… (truncated)");
    expect(out).toContain(body);
  });

  test("renders a sticker as a labelled link", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        stickers: [{ name: "party", url: "https://cdn/sticker.png" }],
      }),
    );
    expect(out).toContain("🏷️ Sticker: [party](https://cdn/sticker.png)");
  });

  test("renders a poll with question + per-answer vote counts", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        poll: {
          question: "Best color?",
          answers: [
            { text: "Red", voteCount: 3 },
            { text: "Blue", voteCount: 1 },
          ],
        },
      }),
    );
    expect(out).toContain("📊 **Poll:** Best color?");
    expect(out).toContain("• Red — 3 votes");
    expect(out).toContain("• Blue — 1 vote");
  });

  test("renders embed image + footer + author + linked title", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        embeds: [
          {
            title: "Release",
            url: "https://example.com/r",
            author: "ci-bot",
            footer: "built at 12:00",
            imageUrl: "https://cdn/img.png",
            fields: [],
          },
        ],
      }),
    );
    expect(out).toContain("**[Release](https://example.com/r)**");
    expect(out).toContain("*ci-bot*");
    expect(out).toContain("🖼️ [image](https://cdn/img.png)");
    expect(out).toContain("— built at 12:00");
  });
});

describe("chunkByMessageBoundary()", () => {
  test("small messages fit in one chunk", () => {
    const chunks = chunkByMessageBoundary(["aaa", "bbb", "ccc"], 1900);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("aaa");
    expect(chunks[0]).toContain("ccc");
  });

  test("splits on message boundary when buffer would exceed limit", () => {
    const big = "x".repeat(1000);
    const chunks = chunkByMessageBoundary([big, big, big], 1900);
    // 1000 + 2 + 1000 = 2002 > 1900, so each chunk holds one message.
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });

  test("individual oversized message is SPLIT, not dropped — every chunk fits the hard limit", () => {
    // A single message of 30 lines × ~200 chars = ~6000 chars: well over a
    // single Discord post. Pre-v3.2.1 this was truncated at 500 chars; now it
    // must split across chunks with zero content loss.
    const lines = Array.from(
      { length: 30 },
      (_, i) => `line ${i} ${"y".repeat(190)}`,
    );
    const oversize = lines.join("\n");
    const chunks = chunkByMessageBoundary([oversize], 1900, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // Every original line survives somewhere in the output.
    const joined = chunks.join("\n");
    for (let i = 0; i < 30; i++) {
      expect(joined).toContain(`line ${i} `);
    }
  });

  test("a single line longer than the limit is hard-sliced, never dropped", () => {
    const giant = `> ${"z".repeat(5000)}`;
    const chunks = chunkByMessageBoundary([giant], 1900, 2000);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // All 5000 z's are preserved across the chunks.
    const zCount = chunks.join("").split("z").length - 1;
    expect(zCount).toBe(5000);
  });

  test("splitting inside a code fence balances the fence on both pieces", () => {
    // Force a split mid-fence: a long fenced block as one formatted message.
    const codeLines = Array.from(
      { length: 40 },
      (_, i) => `const v${i} = ${"a".repeat(60)};`,
    );
    const message = ["**alice** ts", "```js", ...codeLines, "```"].join("\n");
    const chunks = chunkByMessageBoundary([message], 1900, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk has a balanced number of ``` fences (so each renders cleanly).
    for (const chunk of chunks) {
      const fences = chunk.split("```").length - 1;
      expect(fences % 2).toBe(0);
    }
  });

  test("balances a fence nested inside a blockquote (embed code block)", () => {
    // Embed bodies are blockquoted (`> `). A fence there must still toggle
    // and rebalance at the right depth.
    const codeLines = Array.from(
      { length: 40 },
      (_, i) => `> const v${i} = ${"b".repeat(60)};`,
    );
    const message = ["**author** ts", "> ```js", ...codeLines, "> ```"].join(
      "\n",
    );
    const chunks = chunkByMessageBoundary([message], 1900, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.split("```").length - 1) % 2).toBe(0); // balanced fences
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  test("hard-sliced long blockquoted line keeps its `> ` prefix on every continuation", () => {
    // A 5000-char single blockquoted line (e.g. inside an embed). Each emitted
    // segment must retain the `> ` prefix so continuations stay blockquoted,
    // and nothing is dropped.
    const longLine = `> ${"a".repeat(5000)}`;
    const chunks = chunkByMessageBoundary([longLine], 1900, 2000);
    const lines = chunks
      .flatMap((c) => c.split("\n"))
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.startsWith("> ")).toBe(true);
    expect(chunks.join("").split("a").length - 1).toBe(5000);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
  });

  test("never splits mid-message even when two back-to-back fit but a third does not", () => {
    const mid = "z".repeat(900);
    const chunks = chunkByMessageBoundary([mid, mid, mid], 1900);
    // First chunk: mid + '\n\n' + mid = 1802 ≤ 1900 → fits. Third goes alone.
    expect(chunks).toHaveLength(2);
  });
});

describe("buildTranscript()", () => {
  test("filters system + component-only messages", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: "real message from alice" }),
      makeMessage({ content: "", isSystem: true }),
      makeMessage({ content: "", hasOnlyComponents: true }),
      makeMessage({
        author: { username: "bob", id: "222", bot: false },
        content: "another real message",
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(2);
    expect(joinedContent(result)).toContain("real message from alice");
    expect(joinedContent(result)).toContain("another real message");
  });

  test("counts attachments across surviving messages", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "pics or it didnt happen",
        attachments: [
          { name: "a.png", url: "https://cdn/a.png" },
          { name: "b.png", url: "https://cdn/b.png" },
        ],
      }),
      makeMessage({
        content: "",
        hasOnlyComponents: true,
        attachments: [{ name: "filtered-out.png", url: "https://cdn/f.png" }],
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.attachmentCount).toBe(2);
  });

  test("empty ticket produces a placeholder chunk", () => {
    const result = buildTranscript([], META);
    expect(result.messageCount).toBe(0);
    expect(result.chunks).toEqual([{ content: "*(No messages)*", files: [] }]);
  });

  test("bot-only ticket (only system/component noise) returns the human-empty placeholder", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: "", isSystem: true }),
      makeMessage({ content: "", hasOnlyComponents: true }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(0);
    expect(result.chunks).toEqual([
      { content: "*(No human messages)*", files: [] },
    ]);
  });

  test("preserves chronological ordering", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "first",
        timestamp: new Date("2026-04-01T12:00:00Z"),
      }),
      makeMessage({
        author: { username: "bob", id: "222", bot: false },
        content: "second",
        timestamp: new Date("2026-04-01T12:05:00Z"),
      }),
      makeMessage({
        content: "third",
        timestamp: new Date("2026-04-01T12:10:00Z"),
      }),
    ];
    const result = buildTranscript(messages, META);
    const joined = joinedContent(result);
    expect(joined.indexOf("first")).toBeLessThan(joined.indexOf("second"));
    expect(joined.indexOf("second")).toBeLessThan(joined.indexOf("third"));
  });

  test("opens with a day divider and adds one per UTC day change", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "day one",
        timestamp: new Date("2026-04-01T12:00:00Z"),
      }),
      makeMessage({
        content: "day two",
        timestamp: new Date("2026-04-02T09:00:00Z"),
      }),
    ];
    const result = buildTranscript(messages, META);
    const joined = joinedContent(result);
    expect(joined).toContain("-# ── Wednesday, April 1, 2026 ──");
    expect(joined).toContain("-# ── Thursday, April 2, 2026 ──");
    // Exactly two dividers — none repeated within a day.
    expect(joined.split("-# ──").length - 1).toBe(2);
  });

  test("groups consecutive same-author messages under one name line", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "part one",
        timestamp: new Date("2026-04-01T12:00:00Z"),
      }),
      makeMessage({
        content: "part two",
        timestamp: new Date("2026-04-01T12:03:00Z"),
      }),
    ];
    const result = buildTranscript(messages, META);
    const joined = joinedContent(result);
    expect(joined.split("**alice**").length - 1).toBe(1);
    expect(joined).toContain("part one\npart two");
  });

  test("does NOT group across the 7-minute window, replies, or author changes", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "one",
        timestamp: new Date("2026-04-01T12:00:00Z"),
      }),
      makeMessage({
        content: "fifteen minutes later",
        timestamp: new Date("2026-04-01T12:15:00Z"),
      }),
      makeMessage({
        content: "a reply",
        timestamp: new Date("2026-04-01T12:16:00Z"),
        replyTo: { author: "bob", content: "hi" },
      }),
    ];
    const result = buildTranscript(messages, META);
    const joined = joinedContent(result);
    expect(joined.split("**alice**").length - 1).toBe(3);
  });

  test("attachments ride on the chunk holding their message", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: "look at this" }),
      makeMessage({
        content: "the screenshot",
        timestamp: new Date("2026-04-01T12:20:00Z"),
        attachments: [
          { name: "a.png", url: "https://cdn/a.png", size: 100 },
          { name: "gone.png", url: "" },
        ],
      }),
      makeMessage({
        author: { username: "bob", id: "222", bot: false },
        content: "nice",
        timestamp: new Date("2026-04-01T12:21:00Z"),
      }),
    ];
    const result = buildTranscript(messages, META);
    // The attachment-bearing chunk is flushed so files sit under their text.
    const withFiles = result.chunks.filter((c) => c.files.length > 0);
    expect(withFiles).toHaveLength(1);
    expect(withFiles[0].content).toContain("the screenshot");
    // Only uploadable (url-bearing) attachments become file payloads.
    expect(withFiles[0].files).toEqual([
      { name: "a.png", url: "https://cdn/a.png", size: 100 },
    ]);
  });

  test("more than 10 attachments overflow into continued file-only chunks", () => {
    const attachments = Array.from({ length: 13 }, (_, i) => ({
      name: `f${i}.png`,
      url: `https://cdn/f${i}.png`,
    }));
    const messages = [makeMessage({ content: "dump", attachments })];
    const result = buildTranscript(messages, META);
    const withFiles = result.chunks.filter((c) => c.files.length > 0);
    expect(withFiles).toHaveLength(2);
    expect(withFiles[0].files).toHaveLength(10);
    expect(withFiles[1].files).toHaveLength(3);
    expect(withFiles[1].content).toBe("-# 📎 (continued)");
  });

  test("keeps a sticker-only message (no longer filtered)", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "",
        stickers: [{ name: "wave", url: "https://cdn/wave.png" }],
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(1);
    expect(joinedContent(result)).toContain("Sticker: [wave]");
  });

  test("keeps a poll-only message (no longer filtered)", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "",
        poll: { question: "Q?", answers: [{ text: "A", voteCount: 0 }] },
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(1);
    expect(joinedContent(result)).toContain("📊 **Poll:** Q?");
  });

  test("keeps an author/footer-only embed message (filter aligned with renderer)", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({
        content: "",
        embeds: [{ author: "ci-bot", footer: "v1.2.3" }],
      }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(1);
    const joined = joinedContent(result);
    expect(joined).toContain("ci-bot");
    expect(joined).toContain("v1.2.3");
  });

  test("carbon-copy: a multi-thousand-char conversation loses nothing across chunks", () => {
    // 8 messages, each ~3000 chars — far past a single Discord post. The full
    // text of every message must be reconstructable from the chunks.
    const bodies = Array.from(
      { length: 8 },
      (_, i) => `MSG${i}-${"w".repeat(3000)}-END${i}`,
    );
    const messages = bodies.map((content, i) =>
      makeMessage({ content, timestamp: new Date(`2026-04-01T12:0${i}:00Z`) }),
    );
    const result = buildTranscript(messages, META);
    for (const chunk of result.chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2000);
    }
    const flat = joinedContent(result);
    for (let i = 0; i < 8; i++) {
      expect(flat).toContain(`MSG${i}-`);
      expect(flat).toContain(`-END${i}`);
    }
    // Total-interior-content assertion: every one of the 8×3000 filler chars
    // must survive. Boundary-marker checks alone would still pass if an entire
    // interior chunk were silently dropped — this count would not.
    expect(flat.split("w").length - 1).toBe(8 * 3000);
  });
});

describe("buildTranscript() participants aggregation (v3.16.0)", () => {
  test("tallies kept messages per human author, bots excluded, most active first", () => {
    const messages = [
      makeMessage({ author: { username: "alice", id: "1", bot: false } }),
      makeMessage({ author: { username: "bob", id: "2", bot: false } }),
      makeMessage({ author: { username: "alice", id: "1", bot: false } }),
      makeMessage({ author: { username: "helper-bot", id: "3", bot: true } }),
      makeMessage({ author: { username: "alice", id: "1", bot: false } }),
    ];
    const result = buildTranscript(messages, META);
    const field = result.headerData.fields.find((f) => f.name === "Participants");
    expect(field?.value).toBe("alice (3), bob (1)");
  });

  test("filtered-out messages (system/UI noise) do not count toward participant tallies", () => {
    const messages = [
      makeMessage({ author: { username: "alice", id: "1", bot: false } }),
      makeMessage({
        author: { username: "alice", id: "1", bot: false },
        isSystem: true,
      }),
    ];
    const result = buildTranscript(messages, META);
    const field = result.headerData.fields.find((f) => f.name === "Participants");
    expect(field?.value).toBe("alice (1)");
  });

  test("bot-only conversation renders no Participants row", () => {
    const messages = [
      makeMessage({ author: { username: "helper-bot", id: "3", bot: true } }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.headerData.fields.find((f) => f.name === "Participants")).toBeUndefined();
  });
});
