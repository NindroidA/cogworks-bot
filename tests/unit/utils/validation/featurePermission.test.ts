import { describe, expect, test } from "bun:test";
import type { GuildPermission } from "../../../../src/typeorm/entities/GuildPermission";
import {
  FEATURES,
  isFeature,
  isLevel,
  LEVELS,
  levelMeets,
  resolveMemberLevel,
} from "../../../../src/utils/validation/featurePermission";

// Helper: build a GuildPermission row without pulling the whole entity class.
function row(overrides: Partial<GuildPermission>): GuildPermission {
  return {
    id: 1,
    guildId: "g1",
    feature: "tickets",
    roleId: "r1",
    level: "use",
    ...overrides,
  } as GuildPermission;
}

describe("FEATURES / LEVELS catalog", () => {
  test("FEATURES contains the full set documented in the patch spec", () => {
    expect(FEATURES).toEqual([
      "tickets",
      "applications",
      "announcements",
      "baitchannel",
      "memory",
      "xp",
      "starboard",
      "events",
      "reactionroles",
      "onboarding",
      "automod",
      "rules",
      "analytics",
    ]);
  });

  test("LEVELS are ordered lowest-to-highest", () => {
    expect(LEVELS).toEqual(["use", "manage", "admin"]);
  });

  test("isFeature accepts known keys and rejects others", () => {
    expect(isFeature("tickets")).toBe(true);
    expect(isFeature("xp")).toBe(true);
    expect(isFeature("nonsense")).toBe(false);
    expect(isFeature(42)).toBe(false);
    expect(isFeature(null)).toBe(false);
  });

  test("isLevel accepts known values and rejects others", () => {
    expect(isLevel("use")).toBe(true);
    expect(isLevel("manage")).toBe(true);
    expect(isLevel("admin")).toBe(true);
    expect(isLevel("none")).toBe(false);
    expect(isLevel("")).toBe(false);
    expect(isLevel(undefined)).toBe(false);
  });
});

describe("levelMeets", () => {
  test("admin satisfies every requirement", () => {
    expect(levelMeets("admin", "use")).toBe(true);
    expect(levelMeets("admin", "manage")).toBe(true);
    expect(levelMeets("admin", "admin")).toBe(true);
  });

  test("manage satisfies manage and use but not admin", () => {
    expect(levelMeets("manage", "use")).toBe(true);
    expect(levelMeets("manage", "manage")).toBe(true);
    expect(levelMeets("manage", "admin")).toBe(false);
  });

  test("use satisfies only use", () => {
    expect(levelMeets("use", "use")).toBe(true);
    expect(levelMeets("use", "manage")).toBe(false);
    expect(levelMeets("use", "admin")).toBe(false);
  });
});

describe("resolveMemberLevel", () => {
  test("returns null when the member has no matching role", () => {
    const rows = [row({ roleId: "role-a", level: "admin" })];
    expect(resolveMemberLevel(["role-b"], rows)).toBeNull();
  });

  test("returns the level of the single matching role", () => {
    const rows = [row({ roleId: "role-a", level: "manage" })];
    expect(resolveMemberLevel(["role-a"], rows)).toBe("manage");
  });

  test("picks the HIGHEST level when the member has multiple matching roles", () => {
    const rows = [
      row({ id: 1, roleId: "role-a", level: "use" }),
      row({ id: 2, roleId: "role-b", level: "admin" }),
      row({ id: 3, roleId: "role-c", level: "manage" }),
    ];
    expect(resolveMemberLevel(["role-a", "role-b", "role-c"], rows)).toBe(
      "admin",
    );
  });

  test("ignores rows with invalid level strings defensively", () => {
    const rows = [
      row({ roleId: "role-a", level: "godmode" as unknown as "use" }),
      row({ roleId: "role-a", level: "use" }),
    ];
    expect(resolveMemberLevel(["role-a"], rows)).toBe("use");
  });

  test("returns null for an empty role list", () => {
    const rows = [row({ roleId: "role-a", level: "admin" })];
    expect(resolveMemberLevel([], rows)).toBeNull();
  });

  test("returns null for an empty row list", () => {
    expect(resolveMemberLevel(["role-a"], [])).toBeNull();
  });

  test("does not consider rows for a different feature (caller is expected to pre-filter)", () => {
    // The resolver is feature-agnostic; confirm the contract by showing it
    // would count a non-ticket row if passed one.
    const rows = [row({ roleId: "role-a", feature: "xp", level: "admin" })];
    expect(resolveMemberLevel(["role-a"], rows)).toBe("admin");
  });
});
