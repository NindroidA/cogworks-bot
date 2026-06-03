/**
 * transcriptBuilder unit tests.
 *
 * The builder is pure over TranscriptMessage[] — no Discord client — so
 * these tests can drive it with synthetic arrays and assert on the exact
 * markdown output.
 */

import { describe, expect, test } from "bun:test";
import {
  buildTranscript,
  chunkByMessageBoundary,
  formatDurationShort,
  formatHeader,
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

// truncateLongMessage was removed in v3.2.1 — content is split across chunks,
// never truncated. The carbon-copy guarantees are covered by the formatMessage
// and chunkByMessageBoundary suites below.

describe("formatHeader()", () => {
  test("contains all required metadata lines", () => {
    const header = formatHeader(META, 5, 2);
    expect(header).toContain("# 🎫 Ticket: Ban Appeal");
    expect(header).toContain("**Created by:** alice");
    expect(header).toContain("**Type:** Ban Appeal");
    expect(header).toContain("**Assigned to:** staff_bob");
    expect(header).toContain("**Messages:** 5");
    expect(header).toContain("**Attachments:** 2");
    expect(header).toContain("**Duration:** 2h 14m");
  });

  test("omits the attachments line when count is zero", () => {
    const header = formatHeader(META, 3, 0);
    expect(header).not.toContain("**Attachments:**");
  });

  test("renders Unassigned when assigneeUsername is null", () => {
    const header = formatHeader({ ...META, assignedToUsername: null }, 1, 0);
    expect(header).toContain("**Assigned to:** Unassigned");
  });
});

describe("formatMessage()", () => {
  test("plain text becomes a blockquote", () => {
    const out = formatMessage(makeMessage({ content: "Hello\nWorld" }));
    expect(out).toContain("**alice**");
    expect(out).toContain("> Hello");
    expect(out).toContain("> World");
  });

  test("reply adds ↩️ suffix with original author", () => {
    const out = formatMessage(
      makeMessage({
        content: "got it",
        replyTo: { author: "staff_bob", content: "please confirm" },
      }),
    );
    expect(out).toContain("↩️ *replying to staff_bob*");
  });

  test("multiple attachments render each on its own line", () => {
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
    expect(out).toContain("> 📎 [img.png](https://cdn/img.png)");
    expect(out).toContain("> 📎 [log.txt](https://cdn/log.txt)");
  });

  test("attachment with empty URL renders as unavailable", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        attachments: [{ name: "gone.pdf", url: "" }],
      }),
    );
    expect(out).toContain("> 📎 ~~gone.pdf~~ (unavailable)");
  });

  test("code block content is preserved inside the blockquote", () => {
    const content = "```js\nconst x = 1;\n```";
    const out = formatMessage(makeMessage({ content }));
    expect(out).toContain("> ```js");
    expect(out).toContain("> const x = 1;");
  });

  test("embed with title + description renders indented under the message", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        embeds: [
          { title: "Heads up", description: "This is important", fields: [] },
        ],
      }),
    );
    expect(out).toContain("**Heads up**");
    expect(out).toContain("This is important");
  });

  test("empty message falls back to placeholder so the header still lines up", () => {
    const out = formatMessage(makeMessage({ content: "" }));
    expect(out).toContain("*(no content)*");
  });

  test("long single message keeps ALL content — never truncated (carbon-copy)", () => {
    const body = "x".repeat(2000);
    const out = formatMessage(makeMessage({ content: body }));
    expect(out).not.toContain("… (truncated)");
    // Every original character survives (blockquote prefixes add `> ` but the
    // body text itself is intact).
    expect(out).toContain(body);
  });

  test("renders a sticker as a labelled link", () => {
    const out = formatMessage(
      makeMessage({
        content: "",
        stickers: [{ name: "party", url: "https://cdn/sticker.png" }],
      }),
    );
    expect(out).toContain("> 🏷️ Sticker: [party](https://cdn/sticker.png)");
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
    expect(out).toContain("> 📊 **Poll:** Best color?");
    expect(out).toContain("> • Red — 3 votes");
    expect(out).toContain("> • Blue — 1 vote");
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
      (_, i) => `> line ${i} ${"y".repeat(190)}`,
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
      (_, i) => `> const v${i} = ${"a".repeat(60)};`,
    );
    const message = ["**alice** ts", "> ```js", ...codeLines, "> ```"].join(
      "\n",
    );
    const chunks = chunkByMessageBoundary([message], 1900, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk has a balanced number of ``` fences (so each renders cleanly).
    for (const chunk of chunks) {
      const fences = chunk.split("```").length - 1;
      expect(fences % 2).toBe(0);
    }
  });

  test("balances a fence nested inside a double blockquote (embed code block)", () => {
    // Embed bodies are double-quoted (`> > `). A fence there must still toggle
    // and rebalance at the right depth (Copilot review finding).
    const codeLines = Array.from(
      { length: 40 },
      (_, i) => `> > const v${i} = ${"b".repeat(60)};`,
    );
    const message = [
      "**author** ts",
      "> > ```js",
      ...codeLines,
      "> > ```",
    ].join("\n");
    const chunks = chunkByMessageBoundary([message], 1900, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.split("```").length - 1) % 2).toBe(0); // balanced fences
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  test("hard-sliced long blockquoted line keeps its `> ` prefix on every continuation", () => {
    // A 5000-char single blockquoted line (e.g. a long URL/base64). Each emitted
    // segment must retain the `> ` prefix so continuations stay blockquoted, and
    // nothing is dropped (Copilot review finding).
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
    expect(result.chunks.join("\n")).toContain("real message from alice");
    expect(result.chunks.join("\n")).toContain("another real message");
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
    expect(result.chunks).toEqual(["*(No messages)*"]);
  });

  test("bot-only ticket (only system/component noise) returns the human-empty placeholder", () => {
    const messages: TranscriptMessage[] = [
      makeMessage({ content: "", isSystem: true }),
      makeMessage({ content: "", hasOnlyComponents: true }),
    ];
    const result = buildTranscript(messages, META);
    expect(result.messageCount).toBe(0);
    expect(result.chunks).toEqual(["*(No human messages)*"]);
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
    const joined = result.chunks.join("\n");
    expect(joined.indexOf("first")).toBeLessThan(joined.indexOf("second"));
    expect(joined.indexOf("second")).toBeLessThan(joined.indexOf("third"));
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
    expect(result.chunks.join("\n")).toContain("Sticker: [wave]");
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
    expect(result.chunks.join("\n")).toContain("📊 **Poll:** Q?");
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
    const joined = result.chunks.join("\n");
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
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // Strip the `> ` blockquote prefixes and chunk joins, then assert every
    // message's start and end markers survived.
    const flat = result.chunks
      .join("\n")
      .replace(/\n> /g, "")
      .replace(/^> /gm, "");
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
