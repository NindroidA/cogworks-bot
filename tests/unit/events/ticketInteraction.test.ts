/**
 * handleTicketInteraction Unit Tests
 *
 * Covers the branching logic in src/events/ticketInteraction.ts:
 *   - close_ticket / confirm_close_ticket / cancel_close_ticket buttons
 *   - ticket_modal_<type> modal submission (guild-check, category-check, rate-limit, creation)
 *   - ticket_type_select string-select menu (none, restricted, legacy, custom)
 *   - Custom field modal construction (with fields vs. default field, field cap at 5)
 *   - create_ticket button (config check, message ID match, fallback on error)
 *   - cancel_ticket button
 *   - admin_only_ticket / confirm / cancel buttons
 *   - ticket_type_ping_toggle button (toggle, guild-scope, not found)
 *   - Routing of typeAdd / typeEdit / emailImport modals
 *   - Guild-scope enforcement on all DB queries
 *   - Rate limit check enforcement before ticket creation
 *
 * Strategy: Bun's test runner does not support jest.mock() hoisting, and the
 * module-level TypeORM repository constants in ticketInteraction.ts are bound
 * at import time. We therefore spy on TypeORM's Repository.prototype so that
 * every repository instance's findOneBy / findOne / create / save / update /
 * createQueryBuilder is intercepted. Sub-event handlers (close, adminOnly, etc.)
 * are replaced via Bun's mock.module() before the handler is imported.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { MessageFlags } from "discord.js";
import { Repository } from "typeorm";

// ---------------------------------------------------------------------------
// Sub-event handlers — replaced before the module under test is evaluated
// ---------------------------------------------------------------------------

const mockTicketCloseEvent = jest.fn().mockResolvedValue(undefined);
const mockTicketAdminOnlyEvent = jest.fn().mockResolvedValue(undefined);
const mockTypeAddModalHandler = jest.fn().mockResolvedValue(undefined);
const mockTypeEditModalHandler = jest.fn().mockResolvedValue(undefined);
const mockEmailImportModalHandler = jest.fn().mockResolvedValue(undefined);

mock.module("../../../src/events/ticket/close", () => ({
  ticketCloseEvent: (...args: unknown[]) => mockTicketCloseEvent(...args),
}));

mock.module("../../../src/events/ticket/adminOnly", () => ({
  ticketAdminOnlyEvent: (...args: unknown[]) =>
    mockTicketAdminOnlyEvent(...args),
}));

mock.module("../../../src/commands/handlers/ticket/typeAdd", () => ({
  typeAddModalHandler: (...args: unknown[]) => mockTypeAddModalHandler(...args),
  buildTypeConfirmationEmbed: jest.fn().mockReturnValue({}),
}));

mock.module("../../../src/commands/handlers/ticket/typeEdit", () => ({
  typeEditModalHandler: (...args: unknown[]) =>
    mockTypeEditModalHandler(...args),
}));

mock.module("../../../src/commands/handlers/ticket/emailImport", () => ({
  emailImportModalHandler: (...args: unknown[]) =>
    mockEmailImportModalHandler(...args),
}));

// Legacy ticket modal builders — pass-through so the modal object is returned
mock.module("../../../src/events/ticket/ageVerify", () => ({
  ageVerifyModal: jest
    .fn()
    .mockImplementation((m: unknown) => Promise.resolve(m)),
  ageVerifyMessage: jest.fn().mockResolvedValue("age verify description"),
}));
mock.module("../../../src/events/ticket/banAppeal", () => ({
  banAppealModal: jest
    .fn()
    .mockImplementation((m: unknown) => Promise.resolve(m)),
  banAppealMessage: jest.fn().mockResolvedValue("ban appeal description"),
}));
mock.module("../../../src/events/ticket/bugReport", () => ({
  bugReportModal: jest
    .fn()
    .mockImplementation((m: unknown) => Promise.resolve(m)),
  bugReportMessage: jest.fn().mockResolvedValue("bug report description"),
}));
mock.module("../../../src/events/ticket/playerReport", () => ({
  playerReportModal: jest
    .fn()
    .mockImplementation((m: unknown) => Promise.resolve(m)),
  playerReportMessage: jest.fn().mockResolvedValue("player report description"),
}));
mock.module("../../../src/events/ticket/other", () => ({
  otherModal: jest.fn().mockImplementation((m: unknown) => Promise.resolve(m)),
  otherMessage: jest.fn().mockResolvedValue("other description"),
}));

// customTicketOptions / ticketOptions helpers
const mockCustomTicketOptions = jest
  .fn()
  .mockResolvedValue({ type: "selectMenu" });
const mockTicketOptions = jest.fn().mockReturnValue({ type: "legacyButtons" });
mock.module("../../../src/events/ticket", () => ({
  customTicketOptions: (...args: unknown[]) => mockCustomTicketOptions(...args),
  ticketOptions: (...args: unknown[]) => mockTicketOptions(...args),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mock.module() calls
// ---------------------------------------------------------------------------
import { handleTicketInteraction } from "../../../src/events/ticketInteraction";
import {
  rateLimiter,
  createRateLimitKey,
} from "../../../src/utils/security/rateLimiter";

// ---------------------------------------------------------------------------
// Prototype-level spies — intercept every TypeORM Repository instance
// ---------------------------------------------------------------------------
// Because ticketInteraction.ts captures repo references as module-level
// constants, spying on Repository.prototype is the only reliable approach
// without modifying production code.

type SpyFn = ReturnType<typeof jest.spyOn>;

let findOneBySpy: SpyFn;
let findOneSpy: SpyFn;
let createSpy: SpyFn;
let saveSpy: SpyFn;
let updateSpy: SpyFn;
let createQueryBuilderSpy: SpyFn;
let rateLimiterCheckSpy: SpyFn;
let rateLimitKeyUserSpy: SpyFn;

// Default mock implementations reset before each test
const DEFAULT_QUERY_BUILDER = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
};

// ---------------------------------------------------------------------------
// Interaction factory helpers
// ---------------------------------------------------------------------------

function baseInteractionProps(overrides: Record<string, unknown> = {}) {
  return {
    guildId: "guild123",
    user: { id: "user123" },
    guild: null as unknown,
    member: { id: "user123", user: { id: "user123", username: "testuser" } },
    channelId: "channel123",
    channel: null as unknown,
    message: { id: "msg123", delete: jest.fn() },
    replied: false,
    deferred: false,
    isButton: jest.fn().mockReturnValue(false),
    isModalSubmit: jest.fn().mockReturnValue(false),
    isStringSelectMenu: jest.fn().mockReturnValue(false),
    reply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeButtonInteraction(
  customId: string,
  extras: Record<string, unknown> = {},
) {
  return {
    ...baseInteractionProps(extras),
    isButton: jest.fn().mockReturnValue(true),
    customId,
  };
}

function makeModalInteraction(
  customId: string,
  extras: Record<string, unknown> = {},
) {
  return {
    ...baseInteractionProps(extras),
    isModalSubmit: jest.fn().mockReturnValue(true),
    customId,
  };
}

function makeSelectMenuInteraction(
  customId: string,
  values: string[],
  extras: Record<string, unknown> = {},
) {
  return {
    ...baseInteractionProps(extras),
    isStringSelectMenu: jest.fn().mockReturnValue(true),
    customId,
    values,
  };
}

function makeGuild() {
  const mockChannel = {
    id: "new-channel-id",
    send: jest.fn().mockResolvedValue({ id: "welcome-msg-id" }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  return {
    id: "guild123",
    channels: {
      create: jest.fn().mockResolvedValue(mockChannel),
    },
    _channel: mockChannel,
  };
}

function makeTicketConfig(overrides: Record<string, unknown> = {}) {
  return {
    guildId: "guild123",
    messageId: "msg123",
    categoryId: "category456",
    pingStaffOnBanAppeal: false,
    pingStaffOn18Verify: false,
    pingStaffOnPlayerReport: false,
    pingStaffOnBugReport: false,
    pingStaffOnOther: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleTicketInteraction", () => {
  const mockClient = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the default query builder mock functions
    DEFAULT_QUERY_BUILDER.select.mockReturnThis();
    DEFAULT_QUERY_BUILDER.where.mockReturnThis();
    DEFAULT_QUERY_BUILDER.getRawMany.mockResolvedValue([]);

    // Spy on TypeORM Repository.prototype methods
    findOneBySpy = jest
      .spyOn(Repository.prototype, "findOneBy")
      .mockResolvedValue(null as never);

    findOneSpy = jest
      .spyOn(Repository.prototype, "findOne")
      .mockResolvedValue(null as never);

    createSpy = jest
      .spyOn(Repository.prototype, "create")
      .mockReturnValue({} as never);

    saveSpy = jest
      .spyOn(Repository.prototype, "save")
      .mockResolvedValue({} as never);

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

    rateLimitKeyUserSpy = jest
      .spyOn(createRateLimitKey, "user")
      .mockReturnValue("user:ticket-create:user123");
  });

  afterEach(() => {
    findOneBySpy.mockRestore();
    findOneSpy.mockRestore();
    createSpy.mockRestore();
    saveSpy.mockRestore();
    updateSpy.mockRestore();
    createQueryBuilderSpy.mockRestore();
    rateLimiterCheckSpy.mockRestore();
    rateLimitKeyUserSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // close_ticket button — shows confirmation row
  // -------------------------------------------------------------------------
  describe("close_ticket button", () => {
    test("should reply ephemerally with a confirmation row", async () => {
      const interaction = makeButtonInteraction("close_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should not call ticketCloseEvent on the initial close_ticket button", async () => {
      const interaction = makeButtonInteraction("close_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(mockTicketCloseEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // confirm_close_ticket — delegates to ticketCloseEvent
  // -------------------------------------------------------------------------
  describe("confirm_close_ticket button", () => {
    test("should call interaction.update then delegate to ticketCloseEvent", async () => {
      const interaction = makeButtonInteraction("confirm_close_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ components: [] }),
      );
      expect(mockTicketCloseEvent).toHaveBeenCalledWith(
        mockClient,
        interaction,
      );
    });
  });

  // -------------------------------------------------------------------------
  // cancel_close_ticket
  // -------------------------------------------------------------------------
  describe("cancel_close_ticket button", () => {
    test("should call interaction.update with empty components and not invoke close event", async () => {
      const interaction = makeButtonInteraction("cancel_close_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ components: [] }),
      );
      expect(mockTicketCloseEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // admin_only_ticket button
  // -------------------------------------------------------------------------
  describe("admin_only_ticket button", () => {
    test("should reply ephemerally with a confirmation row", async () => {
      const interaction = makeButtonInteraction("admin_only_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
      expect(mockTicketAdminOnlyEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // confirm_admin_only_ticket — delegates to ticketAdminOnlyEvent
  // -------------------------------------------------------------------------
  describe("confirm_admin_only_ticket button", () => {
    test("should call interaction.update and delegate to ticketAdminOnlyEvent", async () => {
      const interaction = makeButtonInteraction("confirm_admin_only_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ components: [] }),
      );
      expect(mockTicketAdminOnlyEvent).toHaveBeenCalledWith(
        mockClient,
        interaction,
      );
    });
  });

  // -------------------------------------------------------------------------
  // cancel_admin_only_ticket
  // -------------------------------------------------------------------------
  describe("cancel_admin_only_ticket button", () => {
    test("should call interaction.update with empty components and not invoke admin event", async () => {
      const interaction = makeButtonInteraction("cancel_admin_only_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ components: [] }),
      );
      expect(mockTicketAdminOnlyEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // create_ticket button
  // -------------------------------------------------------------------------
  describe("create_ticket button", () => {
    test("should return early without replying when no ticketConfig exists", async () => {
      findOneBySpy.mockResolvedValue(null as never);
      const interaction = makeButtonInteraction("create_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    test("should reply with a select menu when ticketConfig.messageId matches interaction.message.id", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      const interaction = makeButtonInteraction("create_ticket", {
        message: { id: "msg123", delete: jest.fn() },
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should not reply when ticketConfig.messageId does not match interaction.message.id", async () => {
      findOneBySpy.mockResolvedValue(
        makeTicketConfig({ messageId: "other-msg" }) as never,
      );
      const interaction = makeButtonInteraction("create_ticket", {
        message: { id: "msg123", delete: jest.fn() },
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
    });

    test("should fall back to legacy ticketOptions when customTicketOptions throws", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      mockCustomTicketOptions.mockRejectedValueOnce(
        new Error("DB unavailable"),
      );
      const interaction = makeButtonInteraction("create_ticket", {
        message: { id: "msg123", delete: jest.fn() },
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(mockTicketOptions).toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cancel_ticket button
  // -------------------------------------------------------------------------
  describe("cancel_ticket button", () => {
    test("should call interaction.update with empty components", async () => {
      const interaction = makeButtonInteraction("cancel_ticket");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ components: [] }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // ticket_type_select — custom string select menu
  // -------------------------------------------------------------------------
  describe("ticket_type_select string select menu", () => {
    test('should reply with no-access message when "none" is selected', async () => {
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "none",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
          content: expect.stringContaining("do not have access"),
        }),
      );
    });

    test("should reply with a restriction message when user is restricted from the selected type", async () => {
      findOneSpy.mockResolvedValue({
        guildId: "guild123",
        userId: "user123",
        typeId: "support",
      } as never);
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "support",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
          content: expect.stringContaining("not allowed"),
        }),
      );
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    test("should scope the user restriction lookup to the interaction guildId", async () => {
      // No restriction found → custom type also not found → error reply
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "support",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      // The UserTicketRestriction findOne call must have included guildId
      const restrictionCall = findOneSpy.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { where?: { userId?: string } })?.where?.userId ===
          "user123",
      );
      expect(restrictionCall).toBeDefined();
      expect(
        (restrictionCall![0] as { where: Record<string, unknown> }).where
          .guildId,
      ).toBe("guild123");
    });

    test("should show a legacy modal for a legacy type without an extra custom-type DB lookup", async () => {
      findOneSpy.mockResolvedValue(null as never); // no restriction
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "ban_appeal",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.showModal).toHaveBeenCalled();
      // The only findOne call should be the UserTicketRestriction check (has userId).
      // There must NOT be a second findOne that targets the CustomTicketType entity
      // (which would have guildId + typeId but no userId in its where clause).
      const customTypeRepoLookup = findOneSpy.mock.calls.find(
        (call: unknown[]) => {
          const where =
            (call[0] as { where?: Record<string, unknown> })?.where ?? {};
          // CustomTicketType queries have guildId and typeId but NOT userId
          return where.typeId !== undefined && where.userId === undefined;
        },
      );
      expect(customTypeRepoLookup).toBeUndefined();
    });

    test("should reply with an error message when the custom ticket type is not in the database", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "unknown-type",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
          content: expect.stringContaining("not found"),
        }),
      );
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    test("should show a modal with one default description field when customFields is null", async () => {
      findOneSpy
        .mockResolvedValueOnce(null as never) // UserTicketRestriction check
        .mockResolvedValueOnce({
          // CustomTicketType lookup
          typeId: "billing",
          displayName: "Billing",
          emoji: "💳",
          customFields: null,
          description: "Billing questions",
        } as never);
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "billing",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.showModal).toHaveBeenCalled();
      const modal = (interaction.showModal as ReturnType<typeof jest.fn>).mock
        .calls[0][0] as { components: unknown[] };
      expect(modal.components).toHaveLength(1);
    });

    test("should show a modal with one ActionRow per custom field", async () => {
      findOneSpy.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
        typeId: "event",
        displayName: "Event Request",
        emoji: "🎉",
        customFields: [
          { id: "f1", label: "Event Name", style: "short", required: true },
          { id: "f2", label: "Date", style: "short", required: true },
          { id: "f3", label: "Details", style: "paragraph", required: false },
        ],
        description: null,
      } as never);
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "event",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.showModal).toHaveBeenCalled();
      const modal = (interaction.showModal as ReturnType<typeof jest.fn>).mock
        .calls[0][0] as { components: unknown[] };
      expect(modal.components).toHaveLength(3);
    });

    test("should cap custom fields at 5 even when more are configured", async () => {
      findOneSpy.mockResolvedValueOnce(null as never).mockResolvedValueOnce({
        typeId: "verbose",
        displayName: "Verbose Type",
        emoji: null,
        customFields: Array.from({ length: 6 }, (_, i) => ({
          id: `field_${i}`,
          label: `Field ${i}`,
          style: "short",
          required: true,
        })),
        description: null,
      } as never);
      const interaction = makeSelectMenuInteraction("ticket_type_select", [
        "verbose",
      ]);

      await handleTicketInteraction(mockClient, interaction as never);

      const modal = (interaction.showModal as ReturnType<typeof jest.fn>).mock
        .calls[0][0] as { components: unknown[] };
      expect(modal.components).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // ticket_modal_<type> modal submission — core ticket creation flow
  // -------------------------------------------------------------------------
  describe("ticket_modal_<type> modal submission", () => {
    function makeModalSubmitWithGuild(
      ticketType: string,
      fieldValue = "some input",
    ) {
      const guild = makeGuild();
      return makeModalInteraction(`ticket_modal_${ticketType}`, {
        guild,
        member: {
          id: "user123",
          user: { id: "user123", username: "testuser" },
        },
        fields: {
          getTextInputValue: jest.fn().mockReturnValue(fieldValue),
        },
      });
    }

    test("should reply ephemerally when guild is null", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      const interaction = makeModalInteraction("ticket_modal_ban_appeal", {
        guild: null,
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should reply ephemerally when ticketConfig has no categoryId", async () => {
      findOneBySpy.mockResolvedValue(
        makeTicketConfig({ categoryId: undefined }) as never,
      );
      const interaction = makeModalInteraction("ticket_modal_ban_appeal", {
        guild: makeGuild(),
        fields: { getTextInputValue: jest.fn().mockReturnValue("") },
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should reply with the rate-limit message and not save a ticket when rate limit is exceeded", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      rateLimiterCheckSpy.mockReturnValue({
        allowed: false,
        message: "You are doing that too fast.",
      } as never);
      const interaction = makeModalSubmitWithGuild("ban_appeal");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "You are doing that too fast.",
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
      expect(saveSpy).not.toHaveBeenCalled();
    });

    test("should check the rate limit with a user-scoped key before creating a ticket", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      createSpy.mockReturnValue({ id: 42 } as never);
      saveSpy.mockResolvedValue({ id: 42 } as never);
      const interaction = makeModalSubmitWithGuild("ban_appeal");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(rateLimitKeyUserSpy).toHaveBeenCalledWith(
        "user123",
        "ticket-create",
      );
      expect(rateLimiterCheckSpy).toHaveBeenCalled();
    });

    test("should create a ticket with the correct guildId for a legacy ticket type", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      createSpy.mockReturnValue({ id: 1 } as never);
      saveSpy.mockResolvedValue({ id: 1 } as never);
      const interaction = makeModalSubmitWithGuild("other");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild123" }),
      );
    });

    test("should not set customTypeId on legacy ticket types", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      createSpy.mockReturnValue({ id: 5 } as never);
      saveSpy.mockResolvedValue({ id: 5 } as never);
      const interaction = makeModalSubmitWithGuild("bug_report");

      await handleTicketInteraction(mockClient, interaction as never);

      const createArg = createSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.customTypeId).toBeUndefined();
    });

    test("should set customTypeId on custom ticket types", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      findOneSpy.mockResolvedValue({
        typeId: "vip",
        displayName: "VIP Support",
        customFields: null,
      } as never);
      createSpy.mockReturnValue({ id: 10 } as never);
      saveSpy.mockResolvedValue({ id: 10 } as never);
      const interaction = makeModalSubmitWithGuild("vip");

      await handleTicketInteraction(mockClient, interaction as never);

      const createArg = createSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(createArg.customTypeId).toBe("vip");
    });

    test("should reply ephemerally when custom ticket type config is not found at submission time", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeModalSubmitWithGuild("ghost-type");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
          content: expect.stringContaining("not found"),
        }),
      );
      expect(saveSpy).not.toHaveBeenCalled();
    });

    test("should reply with an error message when an exception occurs during ticket creation", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      createSpy.mockReturnValue({ id: 99 } as never);
      saveSpy.mockRejectedValue(new Error("DB write failed") as never);
      const interaction = makeModalSubmitWithGuild("other");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should reply confirming channel creation after a successful legacy ticket creation", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      createSpy.mockReturnValue({ id: 7 } as never);
      saveSpy.mockResolvedValue({ id: 7 } as never);
      const interaction = makeModalSubmitWithGuild("18_verify");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should build description from custom field responses without throwing", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      findOneSpy.mockResolvedValue({
        typeId: "support",
        displayName: "Support",
        customFields: [
          { id: "issue", label: "Issue", style: "paragraph", required: true },
          {
            id: "os",
            label: "Operating System",
            style: "short",
            required: false,
          },
        ],
      } as never);
      createSpy.mockReturnValue({ id: 20 } as never);
      saveSpy.mockResolvedValue({ id: 20 } as never);
      const interaction = makeModalSubmitWithGuild("support", "Windows 11");

      await handleTicketInteraction(mockClient, interaction as never);

      // Proof that description building succeeded: guild.channels.create was reached
      const guild = (
        interaction as unknown as { guild: ReturnType<typeof makeGuild> }
      ).guild;
      expect(guild.channels.create).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ticket_type_ping_toggle button
  // -------------------------------------------------------------------------
  describe("ticket_type_ping_toggle button", () => {
    test("should reply ephemerally when guildId is empty", async () => {
      const interaction = makeButtonInteraction(
        "ticket_type_ping_toggle:type123",
        {
          guildId: "",
        },
      );

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should reply ephemerally when the ticket type is not found", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeButtonInteraction(
        "ticket_type_ping_toggle:missing-type",
      );

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          flags: expect.arrayContaining([MessageFlags.Ephemeral]),
        }),
      );
    });

    test("should toggle pingStaffOnCreate from false to true and call interaction.update", async () => {
      const mockType = {
        typeId: "support",
        guildId: "guild123",
        pingStaffOnCreate: false,
        displayName: "Support",
        emoji: "🎫",
        embedColor: "#0099ff",
        isActive: true,
        isDefault: false,
        sortOrder: 0,
        customFields: null,
        description: null,
      };
      findOneSpy.mockResolvedValue(mockType as never);
      saveSpy.mockResolvedValue({
        ...mockType,
        pingStaffOnCreate: true,
      } as never);
      const interaction = makeButtonInteraction(
        "ticket_type_ping_toggle:support",
      );

      await handleTicketInteraction(mockClient, interaction as never);

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pingStaffOnCreate: true }),
      );
      expect(interaction.update).toHaveBeenCalled();
    });

    test("should toggle pingStaffOnCreate from true to false", async () => {
      const mockType = {
        typeId: "support",
        guildId: "guild123",
        pingStaffOnCreate: true,
        displayName: "Support",
        emoji: null,
        embedColor: "#0099ff",
        isActive: true,
        isDefault: false,
        sortOrder: 0,
        customFields: null,
        description: null,
      };
      findOneSpy.mockResolvedValue(mockType as never);
      saveSpy.mockResolvedValue({
        ...mockType,
        pingStaffOnCreate: false,
      } as never);
      const interaction = makeButtonInteraction(
        "ticket_type_ping_toggle:support",
      );

      await handleTicketInteraction(mockClient, interaction as never);

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ pingStaffOnCreate: false }),
      );
    });

    test("should scope the type lookup to the interaction guildId", async () => {
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeButtonInteraction(
        "ticket_type_ping_toggle:my-type",
        {
          guildId: "guild-abc",
        },
      );

      await handleTicketInteraction(mockClient, interaction as never);

      expect(findOneSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ guildId: "guild-abc" }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Admin / setup modal routing
  // -------------------------------------------------------------------------
  describe("modal routing — typeAdd / typeEdit / emailImport", () => {
    test("should route ticket-type-add-modal to typeAddModalHandler", async () => {
      const interaction = makeModalInteraction("ticket-type-add-modal");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(mockTypeAddModalHandler).toHaveBeenCalledWith(interaction);
    });

    test("should route ticket-type-edit-modal:<id> to typeEditModalHandler with the extracted typeId", async () => {
      const interaction = makeModalInteraction(
        "ticket-type-edit-modal:abc-123",
      );

      await handleTicketInteraction(mockClient, interaction as never);

      expect(mockTypeEditModalHandler).toHaveBeenCalledWith(
        interaction,
        "abc-123",
      );
    });

    test("should route ticket-email-import-modal to emailImportModalHandler", async () => {
      const interaction = makeModalInteraction("ticket-email-import-modal");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(mockEmailImportModalHandler).toHaveBeenCalledWith(interaction);
    });
  });

  // -------------------------------------------------------------------------
  // Legacy ticket_ option buttons
  // -------------------------------------------------------------------------
  describe("legacy ticket_ option buttons", () => {
    const legacyTypes = [
      "18_verify",
      "ban_appeal",
      "player_report",
      "bug_report",
      "other",
    ];

    for (const ticketType of legacyTypes) {
      test(`should show a modal for ticket_${ticketType} button`, async () => {
        const interaction = makeButtonInteraction(`ticket_${ticketType}`);

        await handleTicketInteraction(mockClient, interaction as never);

        expect(interaction.showModal).toHaveBeenCalled();
      });
    }

    test("should silently ignore unrecognised ticket_ buttons such as ticket_skip", async () => {
      const interaction = makeButtonInteraction("ticket_skip");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.showModal).not.toHaveBeenCalled();
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    test("should silently ignore ticket_enable without replying or showing a modal", async () => {
      const interaction = makeButtonInteraction("ticket_enable");

      await handleTicketInteraction(mockClient, interaction as never);

      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.showModal).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Guild scope enforcement — all DB queries must carry guildId
  // -------------------------------------------------------------------------
  describe("guild scope enforcement", () => {
    test("ticket modal submission queries ticketConfig by guildId", async () => {
      // guild: null causes an early return but the findOneBy call still happens first
      const interaction = makeModalInteraction("ticket_modal_ban_appeal", {
        guild: null,
        fields: { getTextInputValue: jest.fn().mockReturnValue("") },
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(findOneBySpy).toHaveBeenCalledWith(
        expect.objectContaining({ guildId: "guild123" }),
      );
    });

    test("custom type lookup on modal submission includes guildId", async () => {
      findOneBySpy.mockResolvedValue(makeTicketConfig() as never);
      findOneSpy.mockResolvedValue(null as never);
      const interaction = makeModalInteraction("ticket_modal_custom-type", {
        guild: makeGuild(),
        fields: { getTextInputValue: jest.fn().mockReturnValue("test") },
      });

      await handleTicketInteraction(mockClient, interaction as never);

      expect(findOneSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ guildId: "guild123" }),
        }),
      );
    });
  });
});
