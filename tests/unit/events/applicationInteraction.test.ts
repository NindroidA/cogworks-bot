/**
 * Unit Tests: handleApplicationInteraction
 *
 * Covers the branching logic of src/events/applicationInteraction.ts:
 *   - apply_ button: age gate shown when enabled, modal shown directly when disabled
 *   - apply_ button: position not found → ephemeral error reply
 *   - age_verify_yes_ button: opens modal when position exists
 *   - age_verify_yes_ button: position gone after gate → update with error
 *   - age_verify_no_ button: rejection message sent via update
 *   - cancel_application button: cancelled reply
 *   - close_application button: confirmation row shown
 *   - cancel_close_application button: cancel message via update
 *   - confirm_close_application button: delegates to applicationCloseEvent
 *   - application_modal_ submit: no guild → error reply
 *   - application_modal_ submit: no category → error reply
 *   - application_modal_ submit: position not found → error reply
 *   - application_modal_ submit: rate limited → denial reply
 *   - application_modal_ submit: default field → channel created, reply sent
 *   - application_modal_ submit: saved admin role missing from the guild → left out of overwrites
 *   - application_modal_ submit: custom fields → each field read from modal
 *   - showModal: title includes position title, fallback emoji, one row per field
 *
 * Strategy: Spy on TypeORM Repository.prototype so that every repository
 * instance's findOneBy / findOne / create / save / update / createQueryBuilder
 * is intercepted without replacing the real module. Sub-event handlers
 * (applicationCloseEvent) are replaced via Bun's mock.module().
 */

import * as realApplicationCloseModule from "../../../src/events/application/close";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  jest,
} from "bun:test";
import { MessageFlags } from "discord.js";
import { Repository } from "typeorm";
import { rateLimiter } from "../../../src/utils/security/rateLimiter";

// ---------------------------------------------------------------------------
// Sub-event handler mock — replaced before the module under test is evaluated
// ---------------------------------------------------------------------------

const mockApplicationCloseEvent = jest.fn().mockResolvedValue(undefined);

// Spread the REAL module so sibling exports (buttons, the *Impl alias used by
// events/application/close.test.ts) pass through — mock.module is process-
// global in bun, and a stub-only factory clobbers them for every other suite.
mock.module("../../../src/events/application/close", () => ({
  ...realApplicationCloseModule,
  applicationCloseEvent: (...args: unknown[]) =>
    mockApplicationCloseEvent(...args),
}));

// ---------------------------------------------------------------------------
// Static import of the module under test (after mock.module() calls)
// ---------------------------------------------------------------------------

import { handleApplicationInteraction } from "../../../src/events/applicationInteraction";
import { splitAnswer } from "../../../src/events/application/apply";

// ---------------------------------------------------------------------------
// Prototype-level spies — intercept every TypeORM Repository instance
// ---------------------------------------------------------------------------

type SpyFn = ReturnType<typeof jest.spyOn>;

let findOneBySpy: SpyFn;
let findOneSpy: SpyFn;
let createSpy: SpyFn;
let saveSpy: SpyFn;
let updateSpy: SpyFn;
let createQueryBuilderSpy: SpyFn;
let rateLimiterCheckSpy: SpyFn;

const DEFAULT_QUERY_BUILDER = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CustomField = {
  id: string;
  label: string;
  style: "short" | "paragraph";
  required: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
};

function makePosition(
  overrides: {
    id?: number;
    guildId?: string;
    title?: string;
    description?: string;
    emoji?: string | null;
    customFields?: CustomField[] | null;
    ageGateEnabled?: boolean;
    isActive?: boolean;
    displayOrder?: number;
  } = {},
) {
  return {
    id: 1,
    guildId: "guild-123",
    title: "Moderator",
    description: "Be a mod.",
    emoji: "🛡️",
    customFields: null,
    ageGateEnabled: false,
    isActive: true,
    displayOrder: 0,
    ...overrides,
  };
}

function makeButtonInteraction(
  customId: string,
  opts: {
    guildId?: string;
    guild?: object | null;
  } = {},
) {
  const showModalCalls: unknown[] = [];
  const replyCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  const interaction = {
    guildId: opts.guildId ?? "guild-123",
    guild: opts.guild !== undefined ? opts.guild : { id: "guild-123" },
    channelId: "channel-abc",
    customId,
    user: {
      id: "user-456",
      tag: "TestUser#0001",
      username: "TestUser",
      displayName: "TestUser",
    },
    member: {
      id: "user-456",
      user: {
        id: "user-456",
        tag: "TestUser#0001",
        username: "TestUser",
        displayName: "TestUser",
      },
    },
    isButton: () => true,
    isModalSubmit: () => false,
    replied: false,
    deferred: false,
    _showModalCalls: showModalCalls,
    _replyCalls: replyCalls,
    _updateCalls: updateCalls,
    reply: async (args: unknown) => {
      replyCalls.push(args);
    },
    update: async (args: unknown) => {
      updateCalls.push(args);
    },
    showModal: async (modal: unknown) => {
      showModalCalls.push(modal);
    },
  };

  return interaction;
}

function makeNewChannelStub() {
  const sendCalls: unknown[] = [];
  return {
    id: "new-channel-999",
    _sendCalls: sendCalls,
    send: async (args: unknown) => {
      sendCalls.push(args);
      return { id: `msg-${sendCalls.length}` };
    },
  };
}

function makeModalInteraction(
  customId: string,
  fieldValues: Record<string, string> = {},
  opts: { guildId?: string; guild?: object | null } = {},
) {
  const replyCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const newChannel = makeNewChannelStub();

  const defaultGuild = {
    id: "guild-123",
    // Overwrites are filtered to roles that still exist (v3.16.11).
    roles: { cache: new Map() },
    channels: {
      _createCalls: [] as unknown[],
      create: async function (args: unknown) {
        (this._createCalls as unknown[]).push(args);
        return newChannel;
      },
    },
  };

  const interaction = {
    guildId: opts.guildId ?? "guild-123",
    guild: opts.guild !== undefined ? opts.guild : defaultGuild,
    channelId: "channel-abc",
    customId,
    user: {
      id: "user-456",
      tag: "TestUser#0001",
      username: "TestUser",
      displayName: "TestUser",
    },
    member: {
      id: "user-456",
      user: {
        id: "user-456",
        tag: "TestUser#0001",
        username: "TestUser",
        displayName: "TestUser",
      },
    },
    isButton: () => false,
    isModalSubmit: () => true,
    replied: false,
    deferred: false,
    fields: {
      _getCalls: [] as string[],
      getTextInputValue(fieldId: string) {
        this._getCalls.push(fieldId);
        return fieldValues[fieldId] ?? "default answer";
      },
    },
    _replyCalls: replyCalls,
    _updateCalls: updateCalls,
    _newChannel: newChannel,
    reply: async (args: unknown) => {
      replyCalls.push(args);
    },
    update: async (args: unknown) => {
      updateCalls.push(args);
    },
  };

  return interaction;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("handleApplicationInteraction", () => {
  const mockClient = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset query builder mock functions
    DEFAULT_QUERY_BUILDER.select.mockReturnThis();
    DEFAULT_QUERY_BUILDER.where.mockReturnThis();
    DEFAULT_QUERY_BUILDER.andWhere.mockReturnThis();
    DEFAULT_QUERY_BUILDER.getRawMany.mockResolvedValue([]);

    // Spy on TypeORM Repository.prototype methods
    // Default: applicationConfig found (findOneBy), position not found (findOne)
    findOneBySpy = jest
      .spyOn(Repository.prototype, "findOneBy")
      .mockResolvedValue({
        guildId: "guild-123",
        categoryId: "cat-111",
      } as never);

    findOneSpy = jest
      .spyOn(Repository.prototype, "findOne")
      .mockResolvedValue(null as never);

    createSpy = jest
      .spyOn(Repository.prototype, "create")
      .mockReturnValue({ id: 42 } as never);

    saveSpy = jest
      .spyOn(Repository.prototype, "save")
      .mockResolvedValue({ id: 42 } as never);

    updateSpy = jest
      .spyOn(Repository.prototype, "update")
      .mockResolvedValue({ affected: 1 } as never);

    createQueryBuilderSpy = jest
      .spyOn(Repository.prototype, "createQueryBuilder")
      .mockReturnValue(DEFAULT_QUERY_BUILDER as never);

    // Rate limiter — allow by default
    rateLimiterCheckSpy = jest
      .spyOn(rateLimiter, "check")
      .mockReturnValue({ allowed: true } as never);
  });

  afterEach(() => {
    findOneBySpy.mockRestore();
    findOneSpy.mockRestore();
    createSpy.mockRestore();
    saveSpy.mockRestore();
    updateSpy.mockRestore();
    createQueryBuilderSpy.mockRestore();
    rateLimiterCheckSpy.mockRestore();
  });

  // =========================================================================
  // apply_ button
  // =========================================================================

  describe("apply_ button", () => {
    it("should reply with notAvailable when position does not exist", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "❌ This position is no longer available.",
        flags: [MessageFlags.Ephemeral],
      });
    });

    it("should reply with age verification buttons when ageGateEnabled is true", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({ ageGateEnabled: true }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      const call = interaction._replyCalls[0] as {
        content: string;
        flags: number[];
        components: unknown[];
      };
      expect(call.content).toContain("Age Verification Required");
      expect(call.flags).toContain(MessageFlags.Ephemeral);
      // ActionRowBuilder yields one row containing both buttons
      expect(call.components).toHaveLength(1);
    });

    it("should show the age gate buttons for the correct position id in customId", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({ id: 99, ageGateEnabled: true }) as never,
      );
      const interaction = makeButtonInteraction("apply_99");

      await handleApplicationInteraction(mockClient, interaction as never);

      const call = interaction._replyCalls[0] as { content: string };
      expect(call.content).toContain("Age Verification Required");
    });

    it("should show modal directly when ageGateEnabled is false", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({ ageGateEnabled: false }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._showModalCalls).toHaveLength(1);
      expect(interaction._replyCalls).toHaveLength(0);
    });

    it("should not show modal when position is not found (no ageGate branch reached)", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._showModalCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // age_verify_yes_ button
  // =========================================================================

  describe("age_verify_yes_ button", () => {
    it("should update with notAvailable when position no longer exists", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeButtonInteraction("age_verify_yes_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._updateCalls).toHaveLength(1);
      expect(interaction._updateCalls[0]).toMatchObject({
        content: "This position is no longer available.",
        components: [],
      });
    });

    it("should show the application modal when position still exists", async () => {
      findOneSpy.mockResolvedValue(makePosition() as never);
      const interaction = makeButtonInteraction("age_verify_yes_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._showModalCalls).toHaveLength(1);
      expect(interaction._updateCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // age_verify_no_ button
  // =========================================================================

  describe("age_verify_no_ button", () => {
    it("should update with ageVerifyNoReply and clear components", async () => {
      const interaction = makeButtonInteraction("age_verify_no_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._updateCalls).toHaveLength(1);
      expect(interaction._updateCalls[0]).toMatchObject({
        content:
          "**Sorry!** You must be 18 or older to apply for this position. Please try again when you meet the age requirement.",
        components: [],
      });
    });
  });

  // =========================================================================
  // cancel_application button
  // =========================================================================

  describe("cancel_application button", () => {
    it("should reply with cancelled message", async () => {
      const interaction = makeButtonInteraction("cancel_application");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "Application creation cancelled.",
        flags: [MessageFlags.Ephemeral],
      });
    });
  });

  // =========================================================================
  // close_application button
  // =========================================================================

  describe("close_application button", () => {
    it("should reply with confirmation prompt and two buttons in one row", async () => {
      const interaction = makeButtonInteraction("close_application");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      const call = interaction._replyCalls[0] as {
        content: string;
        components: unknown[];
        flags: number[];
      };
      expect(call.content).toBe(
        "Are you sure you want to close this application?",
      );
      expect(call.components).toHaveLength(1);
      expect(call.flags).toContain(MessageFlags.Ephemeral);
    });
  });

  // =========================================================================
  // cancel_close_application button
  // =========================================================================

  describe("cancel_close_application button", () => {
    it("should update with cancel message and clear components", async () => {
      const interaction = makeButtonInteraction("cancel_close_application");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._updateCalls).toHaveLength(1);
      expect(interaction._updateCalls[0]).toMatchObject({
        content: "Application close cancelled",
        components: [],
      });
    });
  });

  // =========================================================================
  // confirm_close_application button
  // =========================================================================

  describe("confirm_close_application button", () => {
    it("should update with closing message then call applicationCloseEvent", async () => {
      const interaction = makeButtonInteraction("confirm_close_application");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._updateCalls).toHaveLength(1);
      expect(interaction._updateCalls[0]).toMatchObject({
        content: "Closing application...",
        components: [],
      });
      expect(mockApplicationCloseEvent).toHaveBeenCalledTimes(1);
      expect(mockApplicationCloseEvent).toHaveBeenCalledWith(
        mockClient,
        interaction,
      );
    });
  });

  // =========================================================================
  // application_modal_ submit — guard clauses
  // =========================================================================

  describe("application_modal_ submit — guard clauses", () => {
    it("should reply with cmdGuildNotFound when guild is null", async () => {
      const interaction = makeModalInteraction(
        "application_modal_1",
        {},
        { guild: null },
      );

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "❌ This command can only be used in a server!",
        flags: [MessageFlags.Ephemeral],
      });
    });

    it("should reply with applicationCategoryNotFound when config has no categoryId", async () => {
      findOneBySpy.mockResolvedValue({
        guildId: "guild-123",
        categoryId: undefined,
      } as never);
      const interaction = makeModalInteraction("application_modal_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "❌ Application Category does not exist!",
        flags: [MessageFlags.Ephemeral],
      });
    });

    it("should reply with applicationCategoryNotFound when applicationConfig is null", async () => {
      findOneBySpy.mockResolvedValue(null as never);
      const interaction = makeModalInteraction("application_modal_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "❌ Application Category does not exist!",
        flags: [MessageFlags.Ephemeral],
      });
    });

    it("should reply with notAvailable when position does not exist", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeModalInteraction("application_modal_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "❌ This position is no longer available.",
        flags: [MessageFlags.Ephemeral],
      });
    });

    it("should reply with rate limit message when rate limit is exceeded", async () => {
      findOneSpy.mockResolvedValue(makePosition() as never);
      rateLimiterCheckSpy.mockReturnValue({
        allowed: false,
        message: "Too many applications. Try again later.",
      } as never);
      const interaction = makeModalInteraction("application_modal_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: "Too many applications. Try again later.",
        flags: [MessageFlags.Ephemeral],
      });
    });
  });

  // =========================================================================
  // application_modal_ submit — default field (no custom fields)
  // =========================================================================

  describe("application_modal_ submit — default field (no custom fields)", () => {
    beforeEach(() => {
      findOneSpy.mockResolvedValue(
        makePosition({ customFields: null }) as never,
      );
    });

    it("should create a text channel and reply with confirmation", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        default_about: "I love moderation!",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      const call = interaction._replyCalls[0] as {
        content: string;
        flags: number[];
      };
      expect(call.content).toContain("Your application has been submitted");
      expect(call.flags).toContain(MessageFlags.Ephemeral);
    });

    it("should read the default_about field from the modal", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        default_about: "My application text.",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction.fields._getCalls).toContain("default_about");
    });

    it("should not read any custom field ids when customFields is null", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        default_about: "text",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      // Only the single default field should have been read
      expect(interaction.fields._getCalls).toEqual(["default_about"]);
    });

    it("should send the welcome message and field messages to the created channel", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        default_about: "Hello world.",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      // The new channel should have received at least the welcome + header + one field message
      expect(interaction._newChannel._sendCalls.length).toBeGreaterThanOrEqual(
        3,
      );
    });

    it("should leave saved admin roles that no longer exist out of the channel overwrites", async () => {
      // v3.16.11: a role deleted while the bot was offline used to make
      // guild.channels.create throw for every application in the guild.
      const KEPT = "123456789012345678";
      const DELETED = "223456789012345678";
      DEFAULT_QUERY_BUILDER.getRawMany.mockResolvedValue([
        { role: KEPT },
        { role: `<@&${DELETED}>` },
      ]);
      const interaction = makeModalInteraction("application_modal_1", {
        default_about: "text",
      });
      const guild = interaction.guild as {
        roles: { cache: Map<string, unknown> };
        channels: { _createCalls: { permissionOverwrites: { id: string }[] }[] };
      };
      guild.roles.cache = new Map([[KEPT, {}]]);

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(guild.channels._createCalls).toHaveLength(1);
      const ids = guild.channels._createCalls[0].permissionOverwrites.map(
        (o) => o.id,
      );
      expect(ids).toEqual(["guild-123", "user-456", KEPT]);
    });
  });

  // =========================================================================
  // application_modal_ submit — custom fields
  // =========================================================================

  describe("application_modal_ submit — custom fields", () => {
    const customFields: CustomField[] = [
      {
        id: "field_why",
        label: "Why do you want to join?",
        style: "paragraph",
        required: true,
      },
      { id: "field_age", label: "Your age", style: "short", required: true },
    ];

    beforeEach(() => {
      findOneSpy.mockResolvedValue(makePosition({ customFields }) as never);
    });

    it("should read each custom field value from the modal submission", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_why: "Because I care.",
        field_age: "25",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction.fields._getCalls).toContain("field_why");
      expect(interaction.fields._getCalls).toContain("field_age");
    });

    it("should not read the default_about field when custom fields are configured", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_why: "Because I care.",
        field_age: "25",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction.fields._getCalls).not.toContain("default_about");
    });

    it("should reply with submission confirmation when custom fields are present", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_why: "Because I care.",
        field_age: "25",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls).toHaveLength(1);
      expect(interaction._replyCalls[0]).toMatchObject({
        content: expect.stringContaining("Your application has been submitted"),
      });
    });

    it("should send one message per custom field to the channel", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_why: "Because I care.",
        field_age: "25",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      // welcome message + header message + one message per field (2)
      expect(interaction._newChannel._sendCalls.length).toBeGreaterThanOrEqual(
        4,
      );
    });
  });

  // =========================================================================
  // application_modal_ submit — long answers, pings, rate limit (v3.16.32)
  // =========================================================================

  describe("application_modal_ submit — long answers, pings, rate limit", () => {
    // No "x" anywhere in the welcome, header or label, so counting x's counts the answer.
    const customFields: CustomField[] = [
      { id: "field_about", label: "Tell us about yourself", style: "paragraph", required: true },
    ];
    let deleteSpy: SpyFn;
    let resetSpy: SpyFn;

    beforeEach(() => {
      findOneSpy.mockResolvedValue(makePosition({ customFields }) as never);
      deleteSpy = jest
        .spyOn(Repository.prototype, "delete")
        .mockResolvedValue({ affected: 1 } as never);
      resetSpy = jest.spyOn(rateLimiter, "reset");
    });

    afterEach(() => {
      deleteSpy.mockRestore();
      resetSpy.mockRestore();
    });

    const sentContents = (interaction: ReturnType<typeof makeModalInteraction>) =>
      (interaction._newChannel._sendCalls as { content: string }[]).map((c) => c.content);

    it("splits a 4000-char answer into messages of at most 2000 chars without losing any of it", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_about: "x".repeat(4000),
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      const contents = sentContents(interaction);
      for (const content of contents) expect(content.length).toBeLessThanOrEqual(2000);
      expect(contents.join("").split("x").length - 1).toBe(4000);
    });

    it("splits long answers between words and keeps the label with the first part", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_about: "word ".repeat(600).trim(),
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      const answer = sentContents(interaction).filter((c) => c.includes("word"));
      expect(answer.length).toBe(2);
      expect(answer[0].startsWith("**Tell us about yourself:**\nword")).toBe(true);
      for (const part of answer) {
        expect(part.length).toBeLessThanOrEqual(2000);
        expect(part.endsWith("word")).toBe(true);
      }
      expect(answer[1].startsWith("word")).toBe(true);
    });

    it("stores the channel before posting anything, so a failed send still leaves a findable application", async () => {
      const interaction = makeModalInteraction("application_modal_1", { field_about: "short" });
      const sendsAtFirstUpdate: number[] = [];
      updateSpy.mockImplementation((async () => {
        sendsAtFirstUpdate.push(interaction._newChannel._sendCalls.length);
        return { affected: 1 };
      }) as never);

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(updateSpy.mock.calls[0]).toEqual([
        { id: 42, guildId: "guild-123" },
        { channelId: "new-channel-999", status: "opened" },
      ]);
      expect(sendsAtFirstUpdate[0]).toBe(0);
    });

    it("posts every message with pings turned off", async () => {
      const interaction = makeModalInteraction("application_modal_1", {
        field_about: "@everyone <@&123456789012345678>",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      const sends = interaction._newChannel._sendCalls as { allowedMentions?: unknown }[];
      expect(sends.length).toBeGreaterThanOrEqual(3);
      for (const send of sends) expect(send.allowedMentions).toEqual({ parse: [] });
    });

    it("counts the rate limit per server", async () => {
      const interaction = makeModalInteraction("application_modal_1", { field_about: "short" });

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(rateLimiterCheckSpy.mock.calls[0][0]).toBe("user:user-456:guild:guild-123:application-create");
    });

    it("removes the row and gives the attempt back when the channel can't be created", async () => {
      const interaction = makeModalInteraction("application_modal_1", { field_about: "short" });
      (interaction.guild as { channels: { create: () => Promise<never> } }).channels.create = async () => {
        throw new Error("Missing Permissions");
      };

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(deleteSpy).toHaveBeenCalledWith({ id: 42, guildId: "guild-123" });
      expect(resetSpy).toHaveBeenCalledWith("user:user-456:guild:guild-123:application-create");
      expect((interaction._replyCalls[0] as { content: string }).content).toContain("Could not create application");
    });

    it("stores the channel even when the interaction expired before the reply", async () => {
      const interaction = makeModalInteraction("application_modal_1", { field_about: "short" });
      interaction.reply = async () => {
        throw Object.assign(new Error("Unknown interaction"), { code: 10062 });
      };

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(updateSpy.mock.calls[0][1]).toEqual({ channelId: "new-channel-999", status: "opened" });
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("keeps the row when the channel exists and a later send fails", async () => {
      const interaction = makeModalInteraction("application_modal_1", { field_about: "short" });
      interaction._newChannel.send = async () => {
        throw new Error("Cannot send messages");
      };

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(updateSpy.mock.calls[0][1]).toEqual({ channelId: "new-channel-999", status: "opened" });
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(resetSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // showModal — modal structure
  // =========================================================================

  describe("showModal — modal structure", () => {
    it("should include the position title in the modal title", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({
          title: "Senior Developer",
          emoji: "💻",
          ageGateEnabled: false,
          customFields: null,
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      const modal = interaction._showModalCalls[0] as {
        data: { title: string };
      };
      expect(modal.data.title).toContain("Senior Developer");
    });

    it("should fall back to the 📝 emoji when position.emoji is null", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({
          emoji: null,
          ageGateEnabled: false,
          customFields: null,
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      const modal = interaction._showModalCalls[0] as {
        data: { title: string };
      };
      expect(modal.data.title).toContain("📝");
    });

    it("should cap the modal title at 45 characters", async () => {
      const longTitle = "A".repeat(50);
      findOneSpy.mockResolvedValue(
        makePosition({
          title: longTitle,
          emoji: "📌",
          ageGateEnabled: false,
          customFields: null,
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      const modal = interaction._showModalCalls[0] as {
        data: { title: string };
      };
      expect(modal.data.title.length).toBeLessThanOrEqual(45);
    });

    it("should add one ActionRow per custom field", async () => {
      const customFields: CustomField[] = [
        { id: "f1", label: "Q1", style: "short", required: true },
        { id: "f2", label: "Q2", style: "paragraph", required: false },
        { id: "f3", label: "Q3", style: "short", required: true },
      ];
      findOneSpy.mockResolvedValue(
        makePosition({
          ageGateEnabled: false,
          customFields,
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      // ModalBuilder stores components on the instance `.components` property, not `.data.components`
      const modal = interaction._showModalCalls[0] as { components: unknown[] };
      expect(modal.components).toHaveLength(3);
    });

    it("should add a single default ActionRow when there are no custom fields", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({
          ageGateEnabled: false,
          customFields: null,
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      const modal = interaction._showModalCalls[0] as { components: unknown[] };
      expect(modal.components).toHaveLength(1);
    });

    it("should add a single default ActionRow when customFields is an empty array", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({
          ageGateEnabled: false,
          customFields: [],
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      const modal = interaction._showModalCalls[0] as { components: unknown[] };
      expect(modal.components).toHaveLength(1);
    });

    it("should set the modal customId to application_modal_<positionId>", async () => {
      findOneSpy.mockResolvedValue(
        makePosition({
          id: 7,
          ageGateEnabled: false,
          customFields: null,
        }) as never,
      );
      const interaction = makeButtonInteraction("apply_7");

      await handleApplicationInteraction(mockClient, interaction as never);

      const modal = interaction._showModalCalls[0] as {
        data: { custom_id: string };
      };
      expect(modal.data.custom_id).toBe("application_modal_7");
    });
  });

  // =========================================================================
  // Guild isolation — guildId scoped repository queries
  // =========================================================================

  describe("guild isolation", () => {
    it("should look up applicationConfig scoped to the interaction guildId on every call", async () => {
      // The handler calls applicationConfigRepo.findOneBy({ guildId }) at the top.
      // We verify by giving a different guildId and checking the config is resolved correctly.
      findOneBySpy.mockResolvedValue({
        guildId: "other-guild",
        categoryId: "cat-222",
      } as never);
      const interaction = makeButtonInteraction("cancel_application", {
        guildId: "other-guild",
      });

      await handleApplicationInteraction(mockClient, interaction as never);

      // Interaction should still have fired — just verifying no cross-guild error occurs
      expect(interaction._replyCalls).toHaveLength(1);
    });

    it("should reply with notAvailable on modal submit when the looked-up position has a different guildId", async () => {
      // Simulate: config exists, but position query returns null (no position for this guild)
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeModalInteraction("application_modal_1");

      await handleApplicationInteraction(mockClient, interaction as never);

      expect(interaction._replyCalls[0]).toMatchObject({
        content: "❌ This position is no longer available.",
      });
    });
  });
});

// v3.16.32: answers over Discord's 2000-character limit are split.
describe("splitAnswer", () => {
  const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("never returns a blank part (Discord rejects an empty message)", () => {
    expect(splitAnswer(`${"x".repeat(2000)} `)).toEqual(["x".repeat(2000)]);
    const parts = splitAnswer(`${"x".repeat(1999)}\n \n  `);
    expect(parts).toHaveLength(1);
    expect(parts[0].trim()).toBe("x".repeat(1999));
  });

  it("never cuts an emoji in half", () => {
    const text = `a${"😀".repeat(1100)}`;
    const parts = splitAnswer(text);
    expect(parts.length).toBe(2);
    expect(parts.join("")).toBe(text);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(2000);
      expect(loneSurrogate.test(part)).toBe(false);
    }
  });
});
