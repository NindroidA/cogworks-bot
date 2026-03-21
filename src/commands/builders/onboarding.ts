import { PermissionsBitField, SlashCommandBuilder } from 'discord.js';
import onboardingLang from '../../lang/onboarding.json';

const tl = onboardingLang.builder;

export const onboarding = new SlashCommandBuilder()
  .setName('onboarding')
  .setDescription(tl.cmdDescrp)
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
  .addSubcommand(sub => sub.setName('enable').setDescription(tl.setup.enableDescrp))
  .addSubcommand(sub => sub.setName('disable').setDescription(tl.setup.disableDescrp))
  .addSubcommand(sub =>
    sub
      .setName('welcome-message')
      .setDescription(tl.config.welcomeMessage)
      .addStringOption(option =>
        option
          .setName('message')
          .setDescription(tl.config.welcomeMessage)
          .setRequired(true)
          .setMaxLength(2000),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('completion-role')
      .setDescription(tl.config.completionRole)
      .addRoleOption(option =>
        option.setName('role').setDescription(tl.config.completionRole).setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('step-add')
      .setDescription(tl.step.addDescrp)
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription(tl.step.typeOption)
          .setRequired(true)
          .addChoices(
            { name: 'Message', value: 'message' },
            { name: 'Role Select', value: 'role-select' },
            { name: 'Channel Suggest', value: 'channel-suggest' },
            { name: 'Rules Accept', value: 'rules-accept' },
            { name: 'Custom Question', value: 'custom-question' },
          ),
      )
      .addStringOption(option =>
        option
          .setName('title')
          .setDescription(tl.step.titleOption)
          .setRequired(true)
          .setMaxLength(256),
      )
      .addStringOption(option =>
        option
          .setName('description')
          .setDescription(tl.step.descriptionOption)
          .setRequired(true)
          .setMaxLength(4000),
      )
      .addBooleanOption(option =>
        option.setName('required').setDescription(tl.step.requiredOption).setRequired(false),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('step-remove')
      .setDescription(tl.step.removeDescrp)
      .addStringOption(option =>
        option
          .setName('step')
          .setDescription(tl.step.stepOption)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand(sub => sub.setName('step-list').setDescription(tl.step.listDescrp))
  .addSubcommand(sub => sub.setName('stats').setDescription(tl.stats.descrp))
  .addSubcommand(sub => sub.setName('preview').setDescription(tl.preview.descrp))
  .addSubcommand(sub =>
    sub
      .setName('resend')
      .setDescription(tl.resend.descrp)
      .addUserOption(option =>
        option.setName('user').setDescription(tl.resend.userOption).setRequired(true),
      ),
  )
  .toJSON();
