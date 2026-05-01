import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type Interaction,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import {
  enhancedLogger,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  showAndAwaitModal,
} from '../../../utils';
import { buildTypeConfirmationEmbed } from './typeAdd';
import { buildTypeEditModal, parseTypeEditSubmit } from './typeEdit';

const tl = lang.ticket.customTypes.typeList;
const COLLECTOR_TIMEOUT_MS = 5 * 60_000;

// customId namespace for the interactive list view. The :<typeId> suffix
// carries the currently-selected type without us needing to track state
// across collector callbacks.
const CID_SELECT = 'tt_list_select';
const CID_BACK = 'tt_list_back';
const CID_TOGGLE = 'tt_list_toggle:'; // + typeId
const CID_DEFAULT = 'tt_list_default:'; // + typeId
const CID_EDIT = 'tt_list_edit:'; // + typeId

/**
 * Handler for /ticket type list command.
 *
 * Renders an interactive view of all configured custom ticket types.
 *  - Initial: a summary embed listing all types + a select menu.
 *  - On select: rich embed for the picked type + per-type action buttons
 *    (Toggle Active, Set Default, Edit) with a Back button.
 *  - The collector lives 5 minutes and only the invoking admin can interact.
 *
 * The Edit button reuses the same modal as `/ticket type edit` (same handler
 * exports `buildTypeEditModal` + `parseTypeEditSubmit`).
 */
export async function typeListHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'use');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    enhancedLogger.debug('Command: /ticket type list', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
    });

    const typeRepo = AppDataSource.getRepository(CustomTicketType);
    let types = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'ASC' },
    });

    if (types.length === 0) {
      await interaction.reply({
        content: tl.noTypes,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.reply({
      embeds: [buildSummaryEmbed(types)],
      components: buildSummaryComponents(types),
      flags: [MessageFlags.Ephemeral],
    });
    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      time: COLLECTOR_TIMEOUT_MS,
      filter: (i: Interaction) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async i => {
      try {
        // Manage permission required for any mutation. View-only stays at 'use'.
        const isMutation =
          i.isButton() &&
          (i.customId.startsWith(CID_TOGGLE) || i.customId.startsWith(CID_DEFAULT) || i.customId.startsWith(CID_EDIT));
        if (isMutation) {
          const mutGuard = await guardFeatureAccess(i, 'tickets', 'manage');
          if (!mutGuard.allowed) return;
        }

        // Refresh types from DB on every interaction so concurrent edits don't
        // leave the view stale.
        types = await typeRepo.find({
          where: { guildId },
          order: { sortOrder: 'ASC' },
        });

        if (i.isStringSelectMenu() && i.customId === CID_SELECT) {
          await renderDetail(i as StringSelectMenuInteraction, types, i.values[0]);
          return;
        }

        if (i.isButton()) {
          if (i.customId === CID_BACK) {
            await i.update({
              embeds: [buildSummaryEmbed(types)],
              components: buildSummaryComponents(types),
            });
            return;
          }

          if (i.customId.startsWith(CID_TOGGLE)) {
            const typeId = i.customId.slice(CID_TOGGLE.length);
            const target = types.find(t => t.typeId === typeId);
            if (!target) {
              await i.update({
                embeds: [buildSummaryEmbed(types)],
                components: buildSummaryComponents(types),
              });
              return;
            }
            target.isActive = !target.isActive;
            await typeRepo.save(target);
            enhancedLogger.info(
              `Type list: toggled '${typeId}' active=${target.isActive} in guild ${guildId}`,
              LogCategory.COMMAND_EXECUTION,
            );
            const fresh = await typeRepo.find({
              where: { guildId },
              order: { sortOrder: 'ASC' },
            });
            await i.update({
              embeds: [buildDetailEmbed(target)],
              components: buildDetailComponents(target),
            });
            types = fresh;
            return;
          }

          if (i.customId.startsWith(CID_DEFAULT)) {
            const typeId = i.customId.slice(CID_DEFAULT.length);
            const target = types.find(t => t.typeId === typeId);
            if (!target) {
              await i.update({
                embeds: [buildSummaryEmbed(types)],
                components: buildSummaryComponents(types),
              });
              return;
            }
            // Set this one as default, clear default on the others (single-default invariant)
            for (const t of types) {
              const shouldBeDefault = t.typeId === typeId;
              if (t.isDefault !== shouldBeDefault) {
                t.isDefault = shouldBeDefault;
                await typeRepo.save(t);
              }
            }
            enhancedLogger.info(
              `Type list: set '${typeId}' as default in guild ${guildId}`,
              LogCategory.COMMAND_EXECUTION,
            );
            const fresh = await typeRepo.find({
              where: { guildId },
              order: { sortOrder: 'ASC' },
            });
            const refreshed = fresh.find(t => t.typeId === typeId)!;
            await i.update({
              embeds: [buildDetailEmbed(refreshed)],
              components: buildDetailComponents(refreshed),
            });
            types = fresh;
            return;
          }

          if (i.customId.startsWith(CID_EDIT)) {
            const typeId = i.customId.slice(CID_EDIT.length);
            const target = types.find(t => t.typeId === typeId);
            if (!target) {
              await i.update({
                embeds: [buildSummaryEmbed(types)],
                components: buildSummaryComponents(types),
              });
              return;
            }
            const submit = await showAndAwaitModal(i, buildTypeEditModal(target));
            if (!submit) return;

            const parsed = parseTypeEditSubmit(submit);
            if ('error' in parsed) {
              await submit.reply({
                content: parsed.error,
                flags: [MessageFlags.Ephemeral],
              });
              return;
            }

            const reload = await typeRepo.findOne({
              where: { guildId, typeId },
            });
            if (!reload) {
              await submit.reply({
                content: lang.ticket.customTypes.typeEdit.notFound,
                flags: [MessageFlags.Ephemeral],
              });
              return;
            }
            reload.displayName = parsed.fields.displayName;
            reload.emoji = parsed.fields.emoji;
            reload.embedColor = parsed.fields.embedColor;
            reload.description = parsed.fields.description;
            reload.pingStaffOnCreate = parsed.fields.pingStaffOnCreate;
            await typeRepo.save(reload);
            enhancedLogger.info(`Type list: edited '${typeId}' in guild ${guildId}`, LogCategory.COMMAND_EXECUTION);

            // The original list message owns the components — update IT so the
            // user lands back on the refreshed detail view, then ack the modal
            // submission separately so Discord doesn't mark it as failed.
            await submit.deferUpdate();
            await interaction.editReply({
              embeds: [buildDetailEmbed(reload)],
              components: buildDetailComponents(reload),
            });
            types = await typeRepo.find({
              where: { guildId },
              order: { sortOrder: 'ASC' },
            });
            return;
          }
        }
      } catch (err) {
        enhancedLogger.error('typeList collector handler failed', err as Error, LogCategory.COMMAND_EXECUTION, {
          guildId,
          userId: i.user.id,
        });
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // Message may have been deleted or the interaction expired.
      }
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeListHandler');
  }
}

function buildSummaryEmbed(types: CustomTicketType[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(tl.title).setColor('#0099ff');
  for (const type of types) {
    const status = type.isActive ? tl.activeLabel : tl.inactiveLabel;
    const defaultTag = type.isDefault ? tl.defaultLabel : '';
    const ping = type.pingStaffOnCreate ? '🔔' : '🔕';
    const desc = type.description ? `\n*${type.description}*` : '';
    embed.addFields({
      name: `${type.emoji || '❓'} ${type.displayName}${defaultTag}`,
      value: `**ID:** \`${type.typeId}\` · **Status:** ${status} · **Ping:** ${ping}${desc}`,
      inline: false,
    });
  }
  embed.setFooter({ text: 'Pick a type below to manage it' });
  return embed;
}

function buildSummaryComponents(types: CustomTicketType[]): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(CID_SELECT)
    .setPlaceholder('Select a ticket type to manage…')
    .addOptions(
      // Discord caps select-menu options at 25 — typeIds beyond 25 fall off
      // the picker; admins can still hit them via /ticket type edit.
      types.slice(0, 25).map(type => ({
        label: type.displayName.slice(0, 100),
        value: type.typeId,
        description: type.typeId.slice(0, 100),
        emoji: type.emoji ? { name: type.emoji } : undefined,
      })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildDetailEmbed(type: CustomTicketType): EmbedBuilder {
  return buildTypeConfirmationEmbed(type, false);
}

function buildDetailComponents(type: CustomTicketType): ActionRowBuilder<ButtonBuilder>[] {
  const toggleLabel = type.isActive ? 'Deactivate' : 'Activate';
  const toggleStyle = type.isActive ? ButtonStyle.Danger : ButtonStyle.Success;
  const toggleEmoji = type.isActive ? '🔴' : '🟢';

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${CID_TOGGLE}${type.typeId}`)
      .setLabel(toggleLabel)
      .setStyle(toggleStyle)
      .setEmoji(toggleEmoji),
    new ButtonBuilder()
      .setCustomId(`${CID_DEFAULT}${type.typeId}`)
      .setLabel(type.isDefault ? 'Already Default' : 'Set as Default')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⭐')
      .setDisabled(type.isDefault),
    new ButtonBuilder()
      .setCustomId(`${CID_EDIT}${type.typeId}`)
      .setLabel('Edit')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️'),
    new ButtonBuilder().setCustomId(CID_BACK).setLabel('Back to list').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
  ];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
}

async function renderDetail(i: StringSelectMenuInteraction, types: CustomTicketType[], typeId: string): Promise<void> {
  const target = types.find(t => t.typeId === typeId);
  if (!target) {
    await i.update({
      embeds: [buildSummaryEmbed(types)],
      components: buildSummaryComponents(types),
    });
    return;
  }
  await i.update({
    embeds: [buildDetailEmbed(target)],
    components: buildDetailComponents(target),
  });
}

// Keep ComponentType referenced so tree-shakers don't yank the import — used
// transitively by the collector's typed message.create call signature.
void ComponentType.Button;
