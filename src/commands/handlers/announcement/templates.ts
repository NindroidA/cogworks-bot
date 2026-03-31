/**
 * Announcement Template CRUD Commands
 *
 * Handles: create, edit, delete, list, preview, reset
 */

import {
  ActionRowBuilder,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementTemplate } from '../../../typeorm/entities/announcement/AnnouncementTemplate';
import {
  awaitConfirmation,
  enhancedLogger,
  guardAdmin,
  lang,
  sanitizeUserInput,
  showAndAwaitModal,
} from '../../../utils';
import { DEFAULT_ANNOUNCEMENT_TEMPLATES } from '../../../utils/announcement/defaultTemplates';
import { detectDynamicPlaceholders, renderPreview } from '../../../utils/announcement/templateEngine';
import { validateHexColor } from '../../../utils/api/helpers';
import { MAX } from '../../../utils/constants';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const templateRepo = lazyRepo(AnnouncementTemplate);
const configRepo = lazyRepo(AnnouncementConfig);

const TEMPLATE_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Seed default templates for a guild if none exist.
 */
export async function seedDefaultTemplates(guildId: string): Promise<number> {
  const count = await templateRepo.count({ where: { guildId } });
  if (count > 0) return 0;

  const templates = DEFAULT_ANNOUNCEMENT_TEMPLATES.map(t => templateRepo.create({ ...t, guildId }));
  await templateRepo.save(templates);
  return templates.length;
}

/**
 * Main template subcommand router.
 */
export async function templateHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;
  const _tl = lang.announcement;

  // Permission check
  const guard = await guardAdmin(interaction);
  if (!guard.allowed) return;

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
    case 'preview':
      await handlePreview(client, interaction, guildId);
      break;
    case 'reset':
      await handleReset(interaction, guildId);
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
  const tl = lang.announcement.template;

  // Check limit
  const count = await templateRepo.count({ where: { guildId } });
  if (count >= MAX.ANNOUNCEMENT_TEMPLATES) {
    await interaction.reply({
      content: tl.create.limitReached,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`announcement_tpl_create_${Date.now()}`)
    .setTitle('Create Announcement Template')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Template Name (lowercase, hyphens)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(50)
          .setRequired(true)
          .setPlaceholder('e.g., weekly-update'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('display_name')
          .setLabel('Display Name')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setPlaceholder('e.g., Weekly Update'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Embed Title')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(true)
          .setPlaceholder('e.g., Weekly Server Update'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('body')
          .setLabel('Embed Body (supports {placeholders})')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true)
          .setPlaceholder('Use {version}, {time}, {duration}, {user}, {role}, {server}, {channel}'),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Color (hex, e.g., #5865F2)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(7)
          .setRequired(false)
          .setPlaceholder('#5865F2'),
      ),
    );

  const modalInteraction = await showAndAwaitModal(interaction, modal);
  if (!modalInteraction) return;

  const name = modalInteraction.fields.getTextInputValue('name').toLowerCase().trim();
  const displayName = sanitizeUserInput(modalInteraction.fields.getTextInputValue('display_name'));
  const title = sanitizeUserInput(modalInteraction.fields.getTextInputValue('title'));
  const body = sanitizeUserInput(modalInteraction.fields.getTextInputValue('body'));
  const colorInput = modalInteraction.fields.getTextInputValue('color').trim() || '#5865F2';

  // Validate name
  if (!TEMPLATE_NAME_RE.test(name)) {
    await modalInteraction.reply({
      content: tl.create.invalidName,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Validate color
  const colorCheck = validateHexColor(colorInput);
  if (!colorCheck.valid) {
    await modalInteraction.reply({
      content: tl.create.invalidColor,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check for duplicate name
  const existing = await templateRepo.findOneBy({ guildId, name });
  if (existing) {
    await modalInteraction.reply({
      content: tl.create.duplicate,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const template = templateRepo.create({
    guildId,
    name,
    displayName,
    title,
    body,
    color: colorInput.toUpperCase(),
    isDefault: false,
    createdBy: interaction.user.id,
  });

  await templateRepo.save(template);

  // Show preview of the created template
  const preview = renderPreview(template, interaction.guild, interaction.user);

  await modalInteraction.reply({
    content: tl.create.success,
    embeds: preview.embeds,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command(`Template '${name}' created`, interaction.user.id, guildId);
}

// ============================================================================
// Edit
// ============================================================================

async function handleEdit(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const tl = lang.announcement.template;
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
    .setCustomId(`announcement_tpl_edit_${Date.now()}`)
    .setTitle(`Edit: ${template.displayName}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('display_name')
          .setLabel('Display Name')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true)
          .setValue(template.displayName),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Embed Title')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(256)
          .setRequired(true)
          .setValue(template.title),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('body')
          .setLabel('Embed Body (supports {placeholders})')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true)
          .setValue(template.body),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('color')
          .setLabel('Color (hex, e.g., #5865F2)')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(7)
          .setRequired(false)
          .setValue(template.color),
      ),
    );

  const modalInteraction = await showAndAwaitModal(interaction, modal);
  if (!modalInteraction) return;

  const displayName = sanitizeUserInput(modalInteraction.fields.getTextInputValue('display_name'));
  const title = sanitizeUserInput(modalInteraction.fields.getTextInputValue('title'));
  const body = sanitizeUserInput(modalInteraction.fields.getTextInputValue('body'));
  const colorInput = modalInteraction.fields.getTextInputValue('color').trim() || template.color;

  // Validate color
  const colorCheck = validateHexColor(colorInput);
  if (!colorCheck.valid) {
    await modalInteraction.reply({
      content: tl.create.invalidColor,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  template.displayName = displayName;
  template.title = title;
  template.body = body;
  template.color = colorInput.toUpperCase();

  await templateRepo.save(template);

  const preview = renderPreview(template, interaction.guild, interaction.user);

  await modalInteraction.reply({
    content: tl.edit.success,
    embeds: preview.embeds,
    flags: [MessageFlags.Ephemeral],
  });

  enhancedLogger.command(`Template '${templateName}' edited`, interaction.user.id, guildId);
}

// ============================================================================
// Delete
// ============================================================================

async function handleDelete(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const tl = lang.announcement.template;
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

  if (template.isDefault) {
    await interaction.reply({
      content: tl.delete.isDefault,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const result = await awaitConfirmation(interaction, {
    message: `Are you sure you want to delete template **${template.displayName}** (\`${template.name}\`)?`,
    confirmStyle: ButtonStyle.Danger,
    timeout: 60_000,
  });
  if (!result) return;

  await templateRepo.remove(template);

  await result.interaction.editReply({ content: tl.delete.success });

  enhancedLogger.command(`Template '${templateName}' deleted`, interaction.user.id, guildId);
}

// ============================================================================
// List
// ============================================================================

async function handleList(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const tl = lang.announcement.template;

  const templates = await templateRepo.find({
    where: { guildId },
    order: { isDefault: 'DESC', name: 'ASC' },
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
    const placeholders = detectDynamicPlaceholders(tmpl);
    const placeholderText = placeholders.length > 0 ? placeholders.map(p => `\`{${p.name}}\``).join(', ') : 'None';
    const defaultBadge = tmpl.isDefault ? ' (default)' : '';

    embed.addFields({
      name: `${tmpl.displayName}${defaultBadge}`,
      value: `Name: \`${tmpl.name}\` | Color: ${tmpl.color} | Placeholders: ${placeholderText}`,
      inline: false,
    });
  }

  embed.setFooter({
    text: `${templates.length}/${MAX.ANNOUNCEMENT_TEMPLATES} templates`,
  });

  await interaction.reply({
    embeds: [embed],
    flags: [MessageFlags.Ephemeral],
  });
}

// ============================================================================
// Preview
// ============================================================================

async function handlePreview(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  guildId: string,
): Promise<void> {
  const tl = lang.announcement.template;
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

  // Get role for preview
  const config = await configRepo.findOneBy({ guildId });
  const roleId = config?.defaultRoleId;

  const preview = renderPreview(template, interaction.guild, interaction.user, roleId);

  await interaction.reply({
    content: `**Preview of \`${template.name}\`** (placeholders filled with example values)`,
    embeds: preview.embeds,
    flags: [MessageFlags.Ephemeral],
  });
}

// ============================================================================
// Reset
// ============================================================================

async function handleReset(interaction: ChatInputCommandInteraction<CacheType>, guildId: string): Promise<void> {
  const tl = lang.announcement.template;

  const result = await awaitConfirmation(interaction, {
    message: tl.reset.confirm,
    confirmStyle: ButtonStyle.Danger,
    timeout: 60_000,
  });
  if (!result) return;

  // Delete all templates for this guild
  await templateRepo.delete({ guildId });

  // Re-seed defaults
  const seeded = await seedDefaultTemplates(guildId);

  await result.interaction.editReply({
    content: `${tl.reset.success} ${seeded} templates seeded.`,
  });

  enhancedLogger.command('Templates reset to defaults', interaction.user.id, guildId);
}

/**
 * Autocomplete handler for template name selection.
 */
export async function templateAutocomplete(
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
    order: { isDefault: 'DESC', name: 'ASC' },
  });

  const filtered = templates
    .filter(t => t.name.includes(focused) || t.displayName.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(t => ({
      name: `${t.displayName}${t.isDefault ? ' (default)' : ''}`,
      value: t.name,
    }));

  await respond(filtered);
}
