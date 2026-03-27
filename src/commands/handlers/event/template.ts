/**
 * Event Template CRUD Handlers
 *
 * Handles: create, edit, delete, list
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import eventLang from '../../../lang/event.json';
import { EventTemplate } from '../../../typeorm/entities/event/EventTemplate';
import { enhancedLogger, LogCategory, lang, notifyModalTimeout, requireAdmin, sanitizeUserInput } from '../../../utils';
import { MAX } from '../../../utils/constants';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const templateRepo = lazyRepo(EventTemplate);

const TEMPLATE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_EVENT_TEMPLATES = MAX.ANNOUNCEMENT_TEMPLATES; // reuse 25 limit

const tl = eventLang.template;

/**
 * Main template subcommand router.
 */
export async function eventTemplateHandler(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  switch (subcommand) {
    case 'create':
      await handleCreate(interaction, guildId);
      break;
    case 'edit':
      await handleEdit(interaction, guildId);
      break;
    case 'delete':
      await handleDelete(interaction, guildId);
      break;
    case 'list':
      await handleList(interaction, guildId);
      break;
    default:
      await interaction.reply({
        content: lang.errors.unknownSubcommand,
        flags: [MessageFlags.Ephemeral],
      });
  }
}

// ============================================================================
// Create
// ============================================================================

async function handleCreate(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const count = await templateRepo.count({ where: { guildId } });
  if (count >= MAX_EVENT_TEMPLATES) {
    await interaction.reply({
      content: tl.create.limitReached,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`event_tpl_create_${Date.now()}`)
    .setTitle('Create Event Template')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Template Name (lowercase, hyphens)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(50)
          .setRequired(true)
          .setPlaceholder('e.g., game-night'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Event Title')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setPlaceholder('e.g., Weekly Game Night'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Event Description')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false)
          .setPlaceholder('Describe the event...'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('type')
          .setLabel('Type: voice, stage, or external')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(10)
          .setRequired(false)
          .setPlaceholder('external'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Default Duration (minutes)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(false)
          .setPlaceholder('60'),
      ),
    );

  await interaction.showModal(modal);

  const modalInteraction = await interaction.awaitModalSubmit({ time: 300_000 }).catch(async () => {
    await notifyModalTimeout(interaction);
    return null;
  });
  if (!modalInteraction) return;

  const name = modalInteraction.fields.getTextInputValue('name').toLowerCase().trim();
  const title = sanitizeUserInput(modalInteraction.fields.getTextInputValue('title'));
  const description = modalInteraction.fields.getTextInputValue('description').trim() || null;
  const typeInput = modalInteraction.fields.getTextInputValue('type').trim().toLowerCase() || 'external';
  const durationInput = modalInteraction.fields.getTextInputValue('duration').trim() || '60';

  // Validate name
  if (!TEMPLATE_NAME_RE.test(name)) {
    await modalInteraction.reply({
      content: tl.create.invalidName,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Validate type
  const validTypes = ['voice', 'stage', 'external'];
  const entityType = validTypes.includes(typeInput) ? typeInput : 'external';

  // Validate duration
  const duration = Number.parseInt(durationInput, 10);
  const defaultDurationMinutes = Number.isNaN(duration) || duration < 1 || duration > 1440 ? 60 : duration;

  // Check duplicate
  const existing = await templateRepo.findOneBy({ guildId, name });
  if (existing) {
    await modalInteraction.reply({
      content: tl.create.duplicate,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const template = templateRepo.create({
      guildId,
      name,
      title,
      description: description ? sanitizeUserInput(description) : null,
      entityType: entityType as EventTemplate['entityType'],
      defaultDurationMinutes,
      createdBy: interaction.user.id,
    });

    await templateRepo.save(template);

    await modalInteraction.reply({
      content: `${tl.create.success.replace('{0}', name)}\n\n**Title:** ${title}\n**Type:** ${entityType}\n**Duration:** ${defaultDurationMinutes} minutes`,
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command(`Event template '${name}' created`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Event template create failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await modalInteraction.reply({
      content: tl.create.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ============================================================================
// Edit
// ============================================================================

async function handleEdit(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const templateName = interaction.options.getString('template', true);
  const template = await templateRepo.findOneBy({
    guildId,
    name: templateName,
  });

  if (!template) {
    await interaction.reply({
      content: tl.edit.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`event_tpl_edit_${Date.now()}`)
    .setTitle(`Edit: ${template.title}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Event Title')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setValue(template.title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel('Event Description')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(false)
          .setValue(template.description || ''),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('type')
          .setLabel('Type: voice, stage, or external')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(10)
          .setRequired(false)
          .setValue(template.entityType),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Default Duration (minutes)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(false)
          .setValue(template.defaultDurationMinutes.toString()),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('location')
          .setLabel('Location (for external events)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(false)
          .setValue(template.location || ''),
      ),
    );

  await interaction.showModal(modal);

  const modalInteraction = await interaction.awaitModalSubmit({ time: 300_000 }).catch(async () => {
    await notifyModalTimeout(interaction);
    return null;
  });
  if (!modalInteraction) return;

  try {
    const title = sanitizeUserInput(modalInteraction.fields.getTextInputValue('title'));
    const description = modalInteraction.fields.getTextInputValue('description').trim() || null;
    const typeInput = modalInteraction.fields.getTextInputValue('type').trim().toLowerCase();
    const durationInput = modalInteraction.fields.getTextInputValue('duration').trim();
    const location = modalInteraction.fields.getTextInputValue('location').trim() || null;

    const validTypes = ['voice', 'stage', 'external'];
    if (typeInput && validTypes.includes(typeInput)) {
      template.entityType = typeInput as EventTemplate['entityType'];
    }

    const duration = Number.parseInt(durationInput, 10);
    if (!Number.isNaN(duration) && duration >= 1 && duration <= 1440) {
      template.defaultDurationMinutes = duration;
    }

    template.title = title;
    template.description = description ? sanitizeUserInput(description) : null;
    template.location = location ? sanitizeUserInput(location) : null;

    await templateRepo.save(template);

    await modalInteraction.reply({
      content: tl.edit.success.replace('{0}', templateName),
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.command(`Event template '${templateName}' edited`, interaction.user.id, guildId);
  } catch (error) {
    enhancedLogger.error('Event template edit failed', error as Error, LogCategory.COMMAND_EXECUTION, {
      guildId,
    });
    await modalInteraction.reply({
      content: tl.edit.error,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

// ============================================================================
// Delete
// ============================================================================

async function handleDelete(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const templateName = interaction.options.getString('template', true);
  const template = await templateRepo.findOneBy({
    guildId,
    name: templateName,
  });

  if (!template) {
    await interaction.reply({
      content: tl.delete.notFound,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('event_tpl_delete_confirm')
      .setLabel(lang.general.buttons.confirm)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('event_tpl_delete_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({
    content: tl.delete.confirmMessage.replace('{0}', template.title),
    components: [buttons],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const btn = await interaction.channel?.awaitMessageComponent({
      filter: (i: ButtonInteraction) =>
        i.user.id === interaction.user.id &&
        (i.customId === 'event_tpl_delete_confirm' || i.customId === 'event_tpl_delete_cancel'),
      componentType: ComponentType.Button,
      time: 60_000,
    });

    if (!btn || btn.customId === 'event_tpl_delete_cancel') {
      if (btn) {
        await btn.update({ content: tl.delete.cancelled, components: [] });
      }
      return;
    }

    await templateRepo.remove(template);

    await btn.update({
      content: tl.delete.success.replace('{0}', templateName),
      components: [],
    });

    enhancedLogger.command(`Event template '${templateName}' deleted`, interaction.user.id, guildId);
  } catch {
    // Timeout
  }
}

// ============================================================================
// List
// ============================================================================

async function handleList(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const templates = await templateRepo.find({
    where: { guildId },
    order: { name: 'ASC' },
  });

  if (templates.length === 0) {
    await interaction.reply({
      content: tl.list.empty,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder().setTitle(tl.list.title).setColor(0x5865f2);

  for (const tmpl of templates.slice(0, 25)) {
    const recurringBadge = tmpl.isRecurring ? ` (recurring: ${tmpl.recurringPattern})` : '';
    embed.addFields({
      name: tmpl.title,
      value: `Name: \`${tmpl.name}\` | Type: ${tmpl.entityType} | Duration: ${tmpl.defaultDurationMinutes}m${recurringBadge}`,
      inline: false,
    });
  }

  embed.setFooter({
    text: tl.list.footer.replace('{0}', templates.length.toString()),
  });

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * Autocomplete handler for event template name selection.
 */
export async function eventTemplateAutocomplete(
  interaction: {
    guildId: string | null;
    options: { getFocused: () => string };
  },
  respond: (choices: Array<{ name: string; value: string }>) => Promise<void>,
): Promise<void> {
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const focused = interaction.options.getFocused().toLowerCase();

  const templates = await templateRepo.find({
    where: { guildId },
    order: { name: 'ASC' },
  });

  const filtered = templates
    .filter(t => t.name.includes(focused) || t.title.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(t => ({
      name: `${t.title} (${t.entityType})`,
      value: t.name,
    }));

  await respond(filtered);
}
