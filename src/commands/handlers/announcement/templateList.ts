/**
 * Interactive announcement template manager — `/announcement template list`.
 *
 * Mirrors the `/ticket type list` pattern (typeList.ts): a summary embed with a
 * select menu of templates, and a per-template detail view with Edit / Preview
 * / Delete / Back buttons. Reuses the same edit modal + apply logic as the
 * `/announcement template edit` subcommand (buildTemplateEditModal /
 * applyTemplateEditSubmit) so the two stay behaviorally identical.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type Interaction,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementTemplate } from '../../../typeorm/entities/announcement/AnnouncementTemplate';
import {
  awaitConfirmation,
  buildErrorMessage,
  enhancedLogger,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  showAndAwaitModal,
} from '../../../utils';
import { detectDynamicPlaceholders, renderPreview } from '../../../utils/announcement/templateEngine';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { applyTemplateEditSubmit, buildTemplateEditModal } from './templates';

const templateRepo = lazyRepo(AnnouncementTemplate);
const configRepo = lazyRepo(AnnouncementConfig);

const COLLECTOR_TIMEOUT_MS = 5 * 60_000;

// Collector-scoped customIds — separate namespace so clicks here never route
// through any global dispatcher.
const CID_SELECT = 'ann_tpl_select';
const CID_BACK = 'ann_tpl_back';
const CID_EDIT = 'ann_tpl_edit:'; // + name
const CID_PREVIEW = 'ann_tpl_preview:'; // + name
const CID_DELETE = 'ann_tpl_delete:'; // + name

/** Handler for `/announcement template list`. */
export async function templateListHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'announcements', 'use');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    let templates = await loadTemplates(guildId);

    if (templates.length === 0) {
      await interaction.reply({
        content: lang.announcement.template.list.empty,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.reply({
      embeds: [buildSummaryEmbed(templates)],
      components: buildSummaryComponents(templates),
      flags: [MessageFlags.Ephemeral],
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      time: COLLECTOR_TIMEOUT_MS,
      filter: (i: Interaction) => i.user.id === interaction.user.id,
    });

    collector.on('collect', async i => {
      try {
        // Any mutation (edit/delete) requires manage; view/preview stays at use.
        const isMutation = i.isButton() && (i.customId.startsWith(CID_EDIT) || i.customId.startsWith(CID_DELETE));
        if (isMutation) {
          const mutGuard = await guardFeatureAccess(i, 'announcements', 'manage');
          if (!mutGuard.allowed) return;
        }

        // Refresh from DB each interaction so concurrent edits don't go stale.
        templates = await loadTemplates(guildId);

        if (i.isStringSelectMenu() && i.customId === CID_SELECT) {
          const target = templates.find(t => t.name === i.values[0]);
          if (!target) {
            await i.update({ embeds: [buildSummaryEmbed(templates)], components: buildSummaryComponents(templates) });
            return;
          }
          await i.update({ embeds: [buildDetailEmbed(target)], components: buildDetailComponents(target) });
          return;
        }

        if (!i.isButton()) return;

        if (i.customId === CID_BACK) {
          await i.update({ embeds: [buildSummaryEmbed(templates)], components: buildSummaryComponents(templates) });
          return;
        }

        if (i.customId.startsWith(CID_PREVIEW)) {
          const name = i.customId.slice(CID_PREVIEW.length);
          const target = templates.find(t => t.name === name);
          if (!target) return;
          const config = await configRepo.findOneBy({ guildId });
          const preview = renderPreview(target, i.guild, i.user, config?.defaultRoleId);
          await i.reply({
            content: `**Preview of \`${target.name}\`** (example values)`,
            embeds: preview.embeds,
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        if (i.customId.startsWith(CID_EDIT)) {
          const name = i.customId.slice(CID_EDIT.length);
          const target = templates.find(t => t.name === name);
          if (!target) {
            await i.update({ embeds: [buildSummaryEmbed(templates)], components: buildSummaryComponents(templates) });
            return;
          }
          const submit = await showAndAwaitModal(i, buildTemplateEditModal(target));
          if (!submit) return;

          const reload = await templateRepo.findOneBy({ guildId, name });
          if (!reload) {
            await submit.reply({ content: lang.announcement.template.edit.notFound, flags: [MessageFlags.Ephemeral] });
            return;
          }
          const result = await applyTemplateEditSubmit(reload, submit.fields);
          if ('error' in result) {
            await submit.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
            return;
          }
          enhancedLogger.command(`Template '${name}' edited (list view)`, i.user.id, guildId);

          // Ack the modal, then update the original list message to the refreshed detail.
          await submit.deferUpdate();
          await interaction.editReply({
            embeds: [buildDetailEmbed(result.template)],
            components: buildDetailComponents(result.template),
          });
          return;
        }

        if (i.customId.startsWith(CID_DELETE)) {
          const name = i.customId.slice(CID_DELETE.length);
          const target = templates.find(t => t.name === name);
          if (!target) {
            await i.update({ embeds: [buildSummaryEmbed(templates)], components: buildSummaryComponents(templates) });
            return;
          }
          if (target.isDefault) {
            await i.reply({ content: lang.announcement.template.delete.isDefault, flags: [MessageFlags.Ephemeral] });
            return;
          }
          const confirm = await awaitConfirmation(i, {
            message: `Delete template **${target.displayName}** (\`${target.name}\`)? This cannot be undone.`,
            confirmStyle: ButtonStyle.Danger,
            timeout: 60_000,
            idPrefix: 'ann_tpl_del',
          });
          if (!confirm) return;

          await templateRepo.remove(target);
          enhancedLogger.command(`Template '${name}' deleted (list view)`, i.user.id, guildId);

          const remaining = await loadTemplates(guildId);
          if (remaining.length === 0) {
            await confirm.interaction.editReply({
              content: lang.announcement.template.delete.success,
              embeds: [],
              components: [],
            });
            collector.stop();
            return;
          }
          await confirm.interaction.editReply({
            content: lang.announcement.template.delete.success,
            embeds: [buildSummaryEmbed(remaining)],
            components: buildSummaryComponents(remaining),
          });
          return;
        }
      } catch (err) {
        enhancedLogger.error('templateList collector failed', err as Error, LogCategory.COMMAND_EXECUTION, {
          guildId,
          userId: i.user.id,
        });
        if (!i.replied && !i.deferred) {
          await i
            .reply({
              content: buildErrorMessage('Something went wrong while managing templates.'),
              flags: [MessageFlags.Ephemeral],
            })
            .catch(() => undefined);
        }
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch {
        // Message deleted or interaction expired — nothing to clean up.
      }
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'templateListHandler');
  }
}

function loadTemplates(guildId: string): Promise<AnnouncementTemplate[]> {
  return templateRepo.find({ where: { guildId }, order: { isDefault: 'DESC', name: 'ASC' } });
}

function buildSummaryEmbed(templates: AnnouncementTemplate[]): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(lang.announcement.template.list.title)
    .setColor(0x5865f2)
    .setDescription('Pick a template below to preview, edit, or delete it.');
  for (const t of templates.slice(0, 25)) {
    const placeholders = detectDynamicPlaceholders(t);
    const ph = placeholders.length > 0 ? placeholders.map(p => `\`{${p.name}}\``).join(', ') : 'None';
    embed.addFields({
      name: `${t.displayName}${t.isDefault ? ' (default)' : ''}`,
      value: `Name: \`${t.name}\` · Color: ${t.color} · Inputs: ${ph}`,
      inline: false,
    });
  }
  return embed;
}

function buildSummaryComponents(templates: AnnouncementTemplate[]): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(CID_SELECT)
    .setPlaceholder('Select a template to manage…')
    .addOptions(
      // Discord caps select options at 25; beyond that, use /announcement template edit.
      templates.slice(0, 25).map(t => ({
        label: t.displayName.slice(0, 100),
        value: t.name,
        description: t.name.slice(0, 100),
      })),
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildDetailEmbed(template: AnnouncementTemplate): EmbedBuilder {
  const ph = detectDynamicPlaceholders(template);
  return new EmbedBuilder()
    .setTitle(`${template.displayName}${template.isDefault ? ' (default)' : ''}`)
    .setColor(Number.parseInt(template.color.replace('#', ''), 16) || 0x5865f2)
    .addFields(
      { name: 'Name', value: `\`${template.name}\``, inline: true },
      { name: 'Color', value: template.color, inline: true },
      {
        name: 'Inputs needed',
        value: ph.length > 0 ? ph.map(p => `\`{${p.name}}\``).join(', ') : 'None',
        inline: true,
      },
      { name: 'Embed Title', value: template.title.slice(0, 1024) },
      { name: 'Body', value: template.body.slice(0, 1024) },
    );
}

function buildDetailComponents(template: AnnouncementTemplate): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${CID_EDIT}${template.name}`)
      .setLabel('Edit')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✏️'),
    new ButtonBuilder()
      .setCustomId(`${CID_PREVIEW}${template.name}`)
      .setLabel('Preview')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👁️'),
    new ButtonBuilder()
      .setCustomId(`${CID_DELETE}${template.name}`)
      .setLabel(template.isDefault ? 'Default (protected)' : 'Delete')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
      .setDisabled(template.isDefault),
    new ButtonBuilder().setCustomId(CID_BACK).setLabel('Back to list').setStyle(ButtonStyle.Secondary).setEmoji('◀️'),
  ];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
}
