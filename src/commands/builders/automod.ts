import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from 'discord.js';
import { lang } from '../../utils';

const tl = lang.automod.builder;

/* =========================================================================
 * Rule subcommand group: create, edit, delete, list
 * ========================================================================= */

const ruleGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('rule')
  .setDescription(tl.rule.descrp)
  .addSubcommand(sub =>
    sub
      .setName('create')
      .setDescription(tl.rule.create.descrp)
      .addStringOption(option =>
        option
          .setName('name')
          .setDescription(tl.rule.create.name)
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription(tl.rule.create.type)
          .setRequired(true)
          .addChoices(
            { name: tl.rule.create.typeKeyword, value: 'keyword' },
            { name: tl.rule.create.typeMentionSpam, value: 'mention-spam' },
            { name: tl.rule.create.typeSpam, value: 'spam' },
          ),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('edit')
      .setDescription(tl.rule.edit.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.rule.edit.rule)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('delete')
      .setDescription(tl.rule.delete.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.rule.delete.rule)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub => sub.setName('list').setDescription(tl.rule.list.descrp));

/* =========================================================================
 * Template subcommand group: apply
 * ========================================================================= */

const templateGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('template')
  .setDescription(tl.template.descrp)
  .addSubcommand(sub =>
    sub
      .setName('apply')
      .setDescription(tl.template.apply.descrp)
      .addStringOption(option =>
        option
          .setName('template')
          .setDescription(tl.template.apply.template)
          .setRequired(true)
          .addChoices(
            { name: 'Anti-Spam', value: 'anti-spam' },
            { name: 'Anti-Phishing', value: 'anti-phishing' },
            { name: 'Family-Friendly', value: 'family-friendly' },
            { name: 'Gaming', value: 'gaming' },
          ),
      ),
  );

/* =========================================================================
 * Backup subcommand group: backup, restore
 * ========================================================================= */

const backupGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('backup')
  .setDescription(tl.backup.descrp)
  .addSubcommand(sub => sub.setName('export').setDescription(tl.backup.backup.descrp))
  .addSubcommand(sub =>
    sub
      .setName('restore')
      .setDescription(tl.backup.restore.descrp)
      .addAttachmentOption(option =>
        option.setName('file').setDescription(tl.backup.restore.file).setRequired(true),
      ),
  );

/* =========================================================================
 * Keyword subcommand group: add, remove
 * ========================================================================= */

const keywordGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('keyword')
  .setDescription(tl.keyword.descrp)
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription(tl.keyword.add.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.keyword.add.rule)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption(option =>
        option
          .setName('keyword')
          .setDescription(tl.keyword.add.keyword)
          .setRequired(true)
          .setMaxLength(100),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription(tl.keyword.remove.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.keyword.remove.rule)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption(option =>
        option
          .setName('keyword')
          .setDescription(tl.keyword.remove.keyword)
          .setRequired(true)
          .setMaxLength(100),
      ),
  );

/* =========================================================================
 * Regex subcommand group: add, remove
 * ========================================================================= */

const regexGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('regex')
  .setDescription(tl.regex.descrp)
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription(tl.regex.add.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.regex.add.rule)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption(option =>
        option
          .setName('pattern')
          .setDescription(tl.regex.add.pattern)
          .setRequired(true)
          .setMaxLength(75),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription(tl.regex.remove.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.regex.remove.rule)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption(option =>
        option
          .setName('pattern')
          .setDescription(tl.regex.remove.pattern)
          .setRequired(true)
          .setMaxLength(75),
      ),
  );

/* =========================================================================
 * Exempt subcommand group: add, remove
 * ========================================================================= */

const exemptGroup = new SlashCommandSubcommandGroupBuilder()
  .setName('exempt')
  .setDescription(tl.exempt.descrp)
  .addSubcommand(sub =>
    sub
      .setName('add')
      .setDescription(tl.exempt.add.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.exempt.add.rule)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addRoleOption(option =>
        option.setName('role').setDescription(tl.exempt.add.role).setRequired(false),
      )
      .addChannelOption(option =>
        option.setName('channel').setDescription(tl.exempt.add.channel).setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('remove')
      .setDescription(tl.exempt.remove.descrp)
      .addStringOption(option =>
        option
          .setName('rule')
          .setDescription(tl.exempt.remove.rule)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addRoleOption(option =>
        option.setName('role').setDescription(tl.exempt.remove.role).setRequired(false),
      )
      .addChannelOption(option =>
        option.setName('channel').setDescription(tl.exempt.remove.channel).setRequired(false),
      ),
  );

/* =========================================================================
 * Main /automod command
 * ========================================================================= */

export const automodCommand = new SlashCommandBuilder()
  .setName('automod')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup(ruleGroup)
  .addSubcommandGroup(templateGroup)
  .addSubcommandGroup(backupGroup)
  .addSubcommandGroup(keywordGroup)
  .addSubcommandGroup(regexGroup)
  .addSubcommandGroup(exemptGroup);
