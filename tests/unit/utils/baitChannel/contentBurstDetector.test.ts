import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ContentBurstDetector } from "../../../../src/utils/baitChannel/contentBurstDetector";

let detector: ContentBurstDetector;

beforeEach(() => {
  detector = new ContentBurstDetector();
});

afterEach(() => {
  detector.stop();
});

describe("ContentBurstDetector", () => {
  test("does not burst on first message", () => {
    const r = detector.recordMessage("g1", "u1", "c1", "hello world", 30, 3);
    expect(r.bursting).toBe(false);
    expect(r.distinctChannels).toBe(1);
  });

  test("detects burst when same content in N distinct channels", () => {
    detector.recordMessage("g1", "u1", "c1", "free nitro link", 30, 3);
    detector.recordMessage("g1", "u1", "c2", "free nitro link", 30, 3);
    const r = detector.recordMessage(
      "g1",
      "u1",
      "c3",
      "free nitro link",
      30,
      3,
    );
    expect(r.bursting).toBe(true);
    expect(r.distinctChannels).toBe(3);
  });

  test("does not burst on different content", () => {
    detector.recordMessage("g1", "u1", "c1", "hello", 30, 3);
    detector.recordMessage("g1", "u1", "c2", "world", 30, 3);
    const r = detector.recordMessage("g1", "u1", "c3", "foo", 30, 3);
    expect(r.bursting).toBe(false);
    expect(r.distinctChannels).toBe(1);
  });

  test("same content in same channel does not increment distinct count", () => {
    detector.recordMessage("g1", "u1", "c1", "spam", 30, 3);
    detector.recordMessage("g1", "u1", "c1", "spam", 30, 3);
    const r = detector.recordMessage("g1", "u1", "c1", "spam", 30, 3);
    expect(r.bursting).toBe(false);
    expect(r.distinctChannels).toBe(1);
  });

  test("normalizes mentions before hashing — different mention IDs still match", () => {
    detector.recordMessage("g1", "u1", "c1", "hello <@111>", 30, 3);
    detector.recordMessage("g1", "u1", "c2", "hello <@222>", 30, 3);
    const r = detector.recordMessage("g1", "u1", "c3", "hello <@333>", 30, 3);
    expect(r.bursting).toBe(true);
  });

  test("case-insensitive normalization", () => {
    detector.recordMessage("g1", "u1", "c1", "Free NITRO", 30, 3);
    detector.recordMessage("g1", "u1", "c2", "free nitro", 30, 3);
    const r = detector.recordMessage("g1", "u1", "c3", "FREE NITRO", 30, 3);
    expect(r.bursting).toBe(true);
  });

  test("different users tracked independently", () => {
    detector.recordMessage("g1", "u1", "c1", "spam", 30, 3);
    detector.recordMessage("g1", "u1", "c2", "spam", 30, 3);
    detector.recordMessage("g1", "u2", "c1", "spam", 30, 3);
    const r = detector.recordMessage("g1", "u2", "c2", "spam", 30, 3);
    expect(r.bursting).toBe(false); // u2 only has 2 distinct channels
  });

  test("respects custom threshold", () => {
    detector.recordMessage("g1", "u1", "c1", "spam", 30, 2);
    const r = detector.recordMessage("g1", "u1", "c2", "spam", 30, 2);
    expect(r.bursting).toBe(true);
  });

  test("same user + content across DIFFERENT guilds does not merge into one burst (multi-server isolation)", () => {
    // Channel IDs are globally-unique snowflakes, so without guild scoping the
    // distinct-channel Set would have counted these as one cross-channel burst.
    detector.recordMessage("guildA", "u1", "cA1", "free nitro link", 30, 3);
    detector.recordMessage("guildA", "u1", "cA2", "free nitro link", 30, 3);
    const inB = detector.recordMessage(
      "guildB",
      "u1",
      "cB1",
      "free nitro link",
      30,
      3,
    );
    // guildB's window for u1 only has 1 channel — must NOT burst off guildA's posts.
    expect(inB.bursting).toBe(false);
    expect(inB.distinctChannels).toBe(1);
  });
});
