/**
 * Type definitions for all language/translation strings in the bot
 * This provides type-safe access to all translation strings with autocomplete support
 */

export interface LangGeneral {
  presenceMessages: string[];
  descriptionMsg: string;
  fatalError: string;
  channelNotFound: string;
  cmdTicketNotFound: string;
  cmdGuildNotFound: string;
  welcome: {
    title: string;
    description: string;
    features: {
      title: string;
      value: string;
    };
    quickStart: {
      title: string;
      value: string;
    };
    commands: {
      title: string;
      value: string;
    };
    privacy: {
      title: string;
      value: string;
    };
    needHelp: {
      title: string;
      value: string;
    };
    footer: string;
  };
  buttons: {
    cancel: string;
    done: string;
    confirm: string;
    delete: string;
    cancelSetup: string;
    addAnother: string;
    addAnotherRole: string;
    save: string;
    edit: string;
    preview: string;
    yes: string;
    no: string;
    continue: string;
    addField: string;
    deleteField: string;
    reorder: string;
    createTicket: string;
    adminOnly: string;
    closeTicket: string;
  };
  fieldManager: {
    modalTitle: string;
    fieldIdLabel: string;
    fieldIdPlaceholder: string;
    fieldLabelLabel: string;
    fieldLabelPlaceholder: string;
    fieldStyleLabel: string;
    fieldStylePlaceholder: string;
    fieldRequiredLabel: string;
    fieldRequiredPlaceholder: string;
    fieldPlaceholderLabel: string;
    fieldPlaceholderPlaceholder: string;
    selectFieldToDelete: string;
    selectFieldToEdit: string;
    selectFieldPlaceholder: string;
    reorderTitle: string;
    currentOrder: string;
    reorderHint: string;
    noFieldsToPreview: string;
    invalidFieldIndex: string;
    cannotMoveField: string;
    selectionError: string;
  };
  ping: {
    cmdDescrp: string;
    calculating: string;
    title: string;
    wsLatency: string;
    apiLatency: string;
    uptime: string;
  };
  coffee: {
    cmdDescrp: string;
    title: string;
    description: string;
    footer: string;
  };
  server: {
    cmdDescrp: string;
    title: string;
    description: string;
    buttonLabel: string;
  };
  dashboard: {
    cmdDescrp: string;
    title: string;
    description: string;
    buttonLabel: string;
    footer: string;
  };
  contextMenu: {
    baitManagerUnavailable: string;
    userNotMember: string;
    ticketNotConfigured: string;
    noTicketTypes: string;
    selectRoleAndChannel: string;
  };
  setup: {
    noSystemsSelected: string;
    saveError: string;
  };
}

export interface LangMain {
  usingDev: string;
  usingProd: string;
  ready: string;
  error: string;
  foundConfigs: string;
  noFoundConfigs: string;
  regCmdsSuccess: string;
  regCmdsFail: string;
  line: string;
  invalidRelease: string;
  missingDevCreds: string;
  missingProdCreds: string;
  addToEnv: string;
  envSeparator: string;
  envLabel: string;
  envDev: string;
  envProd: string;
  botLabel: string;
  clientIdLabel: string;
  baitChannelInit: string;
  apiConnected: string;
  apiConnectFailed: string;
  apiContinueWarning: string;
  apiSkipDev: string;
  shuttingDown: string;
}

export interface LangConsole {
  createTicketAttempt: string;
  cancelTicketRequest: string;
  createApplicationAttempt: string;
  cancelApplicationRequest: string;
  modalSubmit: string;
  creatTicketSuccess: string;
  createApplicationSuccess: string;
  adminOnlyAttempt: string;
  adminOnlyConfirm: string;
  adminOnlyCancel: string;
  closeTicketAttempt: string;
  closeTicketConfirm: string;
  closeTicketCancel: string;
  closeApplicationAttempt: string;
  closeApplicationConfirm: string;
  closeApplicationCancel: string;
  transcriptSaved: string;
  attachmentsSaved: string;
  baitChannelPost: string;
  postedInBait: string;
  bannedUser: string;
  kickedUser: string;
  timedOutUser: string;
  loggedUser: string;
  noActionTaken: string;
  unknownActionType: string;
  failedAction: string;
  errorSavingBotConfig: string;
  errorUpdatingBotConfig: string;
}

export interface LangBotConfig {
  notFound: string;
  noStaffRole: string;
}

export interface LangBotSetup {
  cmdDescrp: string;
  errors: {
    general: string;
    timeout: string;
    timeoutInactivity: string;
    failedToUpdate: string;
    noRoleSelected: string;
    noChannelSelected: string;
    noCategorySelected: string;
    noForumSelected: string;
    noActionSelected: string;
    noGracePeriodSelected: string;
    everyoneNotAllowed: string;
    everyoneNotAllowedGeneric: string;
    serverOnly: string;
    roleSelectTimeout: string;
    savingBotConfig: string;
    savingTicketConfig: string;
    savingApplicationConfig: string;
    savingAnnouncementConfig: string;
    savingBaitChannelConfig: string;
    savingRoles: string;
    roleAddError: string;
  };
  rateLimit: {
    exceeded: string;
  };
  welcome: {
    title: string;
    description: string;
    gettingStarted: string;
    clickToStart: string;
    continueTitle: string;
    continueDescription: string;
    alreadyConfigured: string;
    toBeConfigured: string;
    continueCTA: string;
    systemConfiguredSkip: string;
  };
  staffRole: {
    title: string;
    description: string;
    step: string;
    question: string;
    selectTitle: string;
    selectDescription: string;
    selectPlaceholder: string;
    selectStep: string;
  };
  ticket: {
    title: string;
    description: string;
    channelSelectTitle: string;
    channelSelectDescription: string;
    channelSelectPlaceholder: string;
    categorySelectTitle: string;
    categorySelectDescription: string;
    categorySelectPlaceholder: string;
    archiveSelectTitle: string;
    archiveSelectDescription: string;
    archiveSelectPlaceholder: string;
    archiveMsg: string;
  };
  application: {
    title: string;
    description: string;
    channelSelectTitle: string;
    channelSelectDescription: string;
    channelSelectPlaceholder: string;
    categorySelectTitle: string;
    categorySelectDescription: string;
    categorySelectPlaceholder: string;
    archiveSelectTitle: string;
    archiveSelectDescription: string;
    archiveSelectPlaceholder: string;
    buttonMsg: string;
    archiveMsg: string;
  };
  announcement: {
    title: string;
    description: string;
    roleSelectTitle: string;
    roleSelectDescription: string;
    roleSelectPlaceholder: string;
    channelSelectTitle: string;
    channelSelectDescription: string;
    channelSelectPlaceholder: string;
  };
  baitChannel: {
    title: string;
    description: string;
    channelSelectTitle: string;
    channelSelectDescription: string;
    channelSelectPlaceholder: string;
    actionSelectTitle: string;
    actionSelectDescription: string;
    actionSelectPlaceholder: string;
    gracePeriodTitle: string;
    gracePeriodDescription: string;
    gracePeriodPlaceholder: string;
    logChannelTitle: string;
    logChannelDescription: string;
    logChannelPlaceholder: string;
    actionBan: string;
    actionBanDescription: string;
    actionKick: string;
    actionKickDescription: string;
    actionTimeout: string;
    actionTimeoutDescription: string;
    actionLogOnly: string;
    actionLogOnlyDescription: string;
    graceInstant: string;
    graceInstantDescription: string;
    grace5: string;
    grace5Description: string;
    grace10: string;
    grace10Description: string;
    grace30: string;
    grace30Description: string;
    grace60: string;
    grace60Description: string;
    logSkipButton: string;
    setupEmbedTitle: string;
    setupEmbedDescription: string;
    setupEmbedConfig: string;
    setupEmbedConfigValue: string;
    setupEmbedWarning: string;
    setupEmbedWarningValue: string;
  };
  role: {
    title: string;
    description: string;
    typeSelectTitle: string;
    typeSelectDescription: string;
    typeSelectPlaceholder: string;
    selectTitle: string;
    selectDescription: string;
    selectPlaceholder: string;
    aliasModalTitle: string;
    aliasLabel: string;
    aliasPlaceholder: string;
    addMoreTitle: string;
    addMoreDescription: string;
    addMoreRoleItem: string;
    staffRoleLabel: string;
    staffRoleDescription: string;
    adminRoleLabel: string;
    adminRoleDescription: string;
    addMoreQuestion: string;
    rolesSoFar: string;
    staffRolesHeader: string;
    adminRolesHeader: string;
  };
  update: {
    title: string;
    currentConfig: string;
    staffRoleConfigured: string;
    staffRoleNotConfigured: string;
    ticketConfigured: string;
    ticketNotConfigured: string;
    applicationConfigured: string;
    applicationNotConfigured: string;
    announcementConfigured: string;
    announcementNotConfigured: string;
    baitChannelConfigured: string;
    baitChannelNotConfigured: string;
    question: string;
    staffRoleUpdated: string;
    staffRoleDisabled: string;
    configUpdated: string;
  };
  summary: {
    title: string;
    description: string;
    alreadyConfigured: string;
    newlyConfigured: string;
    systemsConfigured: string;
    whatsNext: string;
    whatsNextValue: string;
    footer: string;
    globalStaffRole: string;
    ticketSystem: string;
    applicationSystem: string;
    announcementSystem: string;
    baitChannelSystem: string;
    rolesAdded: string;
  };
  buttons: {
    startSetup: string;
    continueSetup: string;
    cancel: string;
    cancelSetup: string;
    enableStaffRole: string;
    skipStaffRole: string;
    skip: string;
    configureTicket: string;
    configureApplication: string;
    configureAnnouncement: string;
    configureBaitChannel: string;
    enable: string;
    disableStaffRole: string;
    reconfigureAll: string;
    addMissing: string;
    updateStaffRole: string;
    enableRoles: string;
    skipRoles: string;
    addMoreRoles: string;
    doneAddingRoles: string;
    confirm: string;
    restart: string;
  };
  cancel: {
    title: string;
    message: string;
  };
  logs: {
    couldNotPin: string;
    baitChannelSaved: string;
    baitChannelCacheCleared: string;
    couldNotEditOnTimeout: string;
    rateLimit: string;
    errorUpdatingBotConfig: string;
  };
}

export interface LangTicketSetup {
  cmdDescrp: string;
  options: {
    channel: string;
    archive: string;
    category: string;
  };
  createTicket: string;
  archiveInitialMsg: string;
  fail: string;
  failArchive: string;
  failCategory: string;
  statusTitle: string;
  missingChannel: string;
  missingArchive: string;
  missingCategory: string;
}

export interface LangTicket {
  error: string;
  ticketConfigNotFound: string;
  ticketCategoryNotFound: string;
  archiveTicketConfigNotFound: string;
  selectTicketType: string;
  created: string;
  welcomeMsg: string;
  cancelled: string;
  adminOnly: {
    confirm: string;
    changing: string;
    cancel: string;
    request: string;
  };
  close: {
    confirm: string;
    closing: string;
    cancel: string;
    byUser: string;
    transcriptCreate: {
      success: string;
      error: string;
      attachmentFound: string;
      attachmentNotFound: string;
    };
    transcriptDelete: {
      error1: string;
      error2: string;
      attachmentError: string;
    };
  };
  customTypes: {
    typeAdd: {
      cmdDescrp: string;
      modalTitle: string;
      typeIdLabel: string;
      typeIdPlaceholder: string;
      displayNameLabel: string;
      displayNamePlaceholder: string;
      emojiLabel: string;
      emojiPlaceholder: string;
      colorLabel: string;
      colorPlaceholder: string;
      descriptionLabel: string;
      descriptionPlaceholder: string;
      success: string;
      error: string;
      duplicate: string;
      invalidTypeId: string;
      invalidColor: string;
      pingToggleEnable: string;
      pingToggleDisable: string;
    };
    confirmEmbed: {
      typeId: string;
      displayName: string;
      color: string;
      status: string;
      pingStaff: string;
      description: string;
      pingEnabled: string;
      pingDisabled: string;
    };
    typeEdit: {
      cmdDescrp: string;
      optionDescrp: string;
      modalTitle: string;
      success: string;
      error: string;
      notFound: string;
      noTypes: string;
    };
    typeList: {
      cmdDescrp: string;
      title: string;
      noTypes: string;
      activeLabel: string;
      inactiveLabel: string;
      defaultLabel: string;
      fieldValue: string;
    };
    typeToggle: {
      cmdDescrp: string;
      optionDescrp: string;
      activated: string;
      deactivated: string;
      error: string;
      notFound: string;
      noTypes: string;
    };
    typeDefault: {
      cmdDescrp: string;
      optionDescrp: string;
      success: string;
      error: string;
      notFound: string;
      noTypes: string;
      mustBeActive: string;
    };
    typeRemove: {
      cmdDescrp: string;
      optionDescrp: string;
      confirmTitle: string;
      confirmMessage: string;
      success: string;
      error: string;
      notFound: string;
      noTypes: string;
      cancelled: string;
    };
    emailImport: {
      cmdDescrp: string;
      modalTitle: string;
      senderEmailLabel: string;
      senderEmailPlaceholder: string;
      senderNameLabel: string;
      senderNamePlaceholder: string;
      subjectLabel: string;
      subjectPlaceholder: string;
      bodyLabel: string;
      bodyPlaceholder: string;
      attachmentsLabel: string;
      attachmentsPlaceholder: string;
      success: string;
      error: string;
      invalidEmail: string;
      bodyTooLong: string;
      tooManyUrls: string;
      invalidUrl: string;
      urlTooLong: string;
      permissionError: string;
      apiError: string;
    };
    userRestrict: {
      cmdDescrp: string;
      optionUser: string;
      optionType: string;
      title: string;
      description: string;
      noTypes: string;
      canCreate: string;
      restricted: string;
      confirmRestrict: string;
      confirmAllow: string;
      successRestrict: string;
      successAllow: string;
      alreadyRestricted: string;
      notRestricted: string;
      error: string;
      cancelled: string;
      noRestrictions: string;
      currentRestrictions: string;
      notYourInteraction: string;
      saved: string;
      footer: string;
    };
  };
  settings: {
    cmdDescrp: string;
    settingOption: string;
    enabledOption: string;
    typeOption: string;
    updated: string;
    adminOnlyMentionEnabled: string;
    adminOnlyMentionDisabled: string;
    pingOnCreateEnabled: string;
    pingOnCreateDisabled: string;
    typeRequired: string;
    typeNotFound: string;
  };
  workflow: {
    notEnabled: string;
    statusChanged: string;
    assigned: string;
    unassigned: string;
    notInTicket: string;
    ticketNotFound: string;
    sameStatus: string;
    invalidStatus: string;
    noAssignment: string;
    autoCloseWarning: string;
    autoClosed: string;
    enabled: string;
    disabled: string;
    alreadyEnabled: string;
    alreadyDisabled: string;
    statusAdded: string;
    statusRemoved: string;
    statusInUse: string;
    cannotRemoveRequired: string;
    statusExists: string;
    maxStatuses: string;
    invalidStatusId: string;
    autoCloseEnabled: string;
    autoCloseDisabled: string;
    autoCloseAlreadyEnabled: string;
    autoCloseAlreadyDisabled: string;
    autoCloseRequiresWorkflow: string;
  };
  sla: {
    enabled: string;
    enabledNoChannel: string;
    disabled: string;
    alreadyEnabled: string;
    alreadyDisabled: string;
    requiresWorkflow: string;
    perTypeSet: string;
    perTypeRemoved: string;
    perTypeNotFound: string;
    breachAlert: string;
    breachAlertTitle: string;
    statsTitle: string;
    statsAvgResponse: string;
    statsComplianceRate: string;
    statsBreachCount: string;
    statsTotalTickets: string;
    statsNoData: string;
    statsMinutes: string;
    statsPercent: string;
  };
  routing: {
    requiresWorkflow: string;
    notEnabled: string;
    enabled: string;
    disabled: string;
    alreadyEnabled: string;
    alreadyDisabled: string;
    ruleAdded: string;
    ruleRemoved: string;
    ruleNotFound: string;
    ruleDuplicate: string;
    maxRules: string;
    strategySet: string;
    invalidStrategy: string;
    noRules: string;
    noOnlineStaff: string;
    allAtCapacity: string;
    autoAssigned: string;
    statsTitle: string;
    statsStrategy: string;
    statsOpenTickets: string;
    statsAssigned: string;
    statsRules: string;
    statsWorkload: string;
  };
  info: {
    title: string;
    createdBy: string;
    status: string;
    assignedTo: string;
    lastActivity: string;
    ticketType: string;
    history: string;
    noHistory: string;
    unassigned: string;
  };
  builder: {
    status: {
      descrp: string;
      statusOption: string;
    };
    assign: {
      descrp: string;
      userOption: string;
    };
    unassign: {
      descrp: string;
    };
    info: {
      descrp: string;
    };
    workflowEnable: string;
    workflowDisable: string;
    statusAdd: string;
    statusRemove: string;
    statusIdOption: string;
    statusLabelOption: string;
    statusEmojiOption: string;
    statusSelectOption: string;
    autoCloseEnable: string;
    autoCloseDisable: string;
    autoCloseDaysOption: string;
    autoCloseWarningOption: string;
    autoCloseStatusOption: string;
    routingEnable: string;
    routingDisable: string;
    routingRuleAdd: string;
    routingRuleRemove: string;
    routingStrategy: string;
    routingStats: string;
    routingTypeOption: string;
    routingRoleOption: string;
    routingMaxOpenOption: string;
    routingStrategyOption: string;
    slaEnable: string;
    slaDisable: string;
    slaPerType: string;
    slaStats: string;
    slaTargetOption: string;
    slaBreachChannelOption: string;
    slaTypeOption: string;
    slaMinutesOption: string;
    slaDaysOption: string;
  };
}

export interface LangApplication {
  error: string;
  failCreate: string;
  setup: {
    cmdDescrp: string;
    options: {
      channel: string;
      archive: string;
      category: string;
    };
    archiveInitialMsg: string;
    fail: string;
    failArchive: string;
    failCategory: string;
    statusTitle: string;
    missingChannel: string;
    missingArchive: string;
    missingCategory: string;
  };
  applicationConfigNotFound: string;
  applicationCategoryNotFound: string;
  archiveApplicationConfigNotFound: string;
  selectApplicationType: string;
  created: string;
  welcomeMsg: string;
  cancelled: string;
  close: {
    confirm: string;
    closing: string;
    closingL: string;
    cancel: string;
    cancelL: string;
    byUser: string;
    transcriptCreate: {
      success: string;
      error: string;
      attachmentFound: string;
      attachmentNotFound: string;
    };
    transcriptDelete: {
      error1: string;
      error2: string;
      attachmentError: string;
    };
  };
  position: {
    cmdDescrp: string;
    subcmdDescrp: {
      add: string;
      'add-template': string;
      'add-title': string;
      'add-description': string;
      'add-emoji': string;
      remove: string;
      'remove-position': string;
      toggle: string;
      'toggle-position': string;
      edit: string;
      'edit-position': string;
      fields: string;
      'fields-position': string;
      list: string;
      refresh: string;
      reindex: string;
    };
    notAvailable: string;
    ageVerifyYes: string;
    ageVerifyNo: string;
    ageVerifyNoReply: string;
    modal: {
      defaultField: string;
    };
    noneFound: string;
    noneAvailable: string;
    available: string;
    templateApplied: string;
    templateNotFound: string;
    provideEither: string;
    notFound: string;
    failAdd: string;
    failRemove: string;
    failToggle: string;
    failList: string;
    failRefresh: string;
    failUpdate: string;
    successRefresh: string;
    reindex: string;
    failReindex: string;
    sessionExpired: string;
    sessionCompleted: string;
    addedInactive: string;
    edit: {
      title: string;
      success: string;
      notFound: string;
      titleLabel: string;
      descriptionLabel: string;
      emojiLabel: string;
      ageGateLabel: string;
    };
    fields: {
      title: string;
      noFields: string;
      maxReached: string;
      added: string;
      removed: string;
      reordered: string;
      complete: string;
      previewNote: string;
      notFound: string;
      duplicateId: string;
      invalidId: string;
      invalidStyle: string;
    };
    ageGateEnabled: string;
    ageGateDisabled: string;
    autocomplete: {
      noPositions: string;
    };
  };
  workflow: {
    notEnabled: string;
    notInApplication: string;
    applicationNotFound: string;
    statusChanged: string;
    sameStatus: string;
    invalidStatus: string;
    claimed: string;
    alreadyClaimed: string;
    noteAdded: string;
    noteTooLong: string;
    noNotes: string;
    enabled: string;
    disabled: string;
    alreadyEnabled: string;
    alreadyDisabled: string;
    statusAdded: string;
    statusRemoved: string;
    statusInUse: string;
    cannotRemoveRequired: string;
    statusExists: string;
    maxStatuses: string;
    invalidStatusId: string;
    checkNoApplication: string;
    checkTitle: string;
    checkPosition: string;
    checkStatus: string;
    checkSubmittedAt: string;
    checkReviewedBy: string;
    checkUnassigned: string;
  };
  workflowInfo: {
    title: string;
    createdBy: string;
    status: string;
    reviewer: string;
    position: string;
    history: string;
    noHistory: string;
    unassigned: string;
    notesTitle: string;
    noteEntry: string;
  };
  workflowBuilder: {
    status: {
      descrp: string;
      statusOption: string;
    };
    note: {
      descrp: string;
      textOption: string;
    };
    claim: {
      descrp: string;
    };
    info: {
      descrp: string;
    };
    check: {
      descrp: string;
    };
    workflowEnable: string;
    workflowDisable: string;
    statusAdd: string;
    statusRemove: string;
    statusIdOption: string;
    statusLabelOption: string;
    statusEmojiOption: string;
    statusSelectOption: string;
  };
}

export interface LangRoles {
  addRole: {
    cmdDescrp: string;
    subcmdDescrp: {
      staff: string;
      admin: string;
      roleid: string;
      alias: string;
    };
    successStaff: string;
    successAdmin: string;
    fail: string;
    alreadyAdded: string;
  };
  removeRole: {
    cmdDescrp: string;
    subcmdDescrp: {
      staff: string;
      admin: string;
      roleid: string;
    };
    successStaff: string;
    successAdmin: string;
    fail: string;
    noType: string;
    dne: string;
  };
  getRoles: {
    cmdDescrp: string;
    fail: string;
    noGuild: string;
  };
}

export interface LangAnnouncement {
  cmdDescrp: string;
  channel: string;
  invalidTime: string;
  setup: {
    cmdDescrp: string;
    mcRole: string;
    announcementRole: string;
    defaultChannel: string;
    success: string;
    configured: string;
    error: string;
    fail: string;
    notConfigured: string;
    invalidChannel: string;
  };
  maintenance: {
    cmdDescrp: string;
    duration: {
      cmdDescrp: string;
      short: {
        name: string;
        value: string;
        msg: string;
      };
      long: {
        name: string;
        value: string;
        msg: string;
      };
    };
    scheduled: {
      cmdDescrp: string;
      short: string;
      long: string;
      version: {
        cmdDescrp: string;
      };
      time: {
        cmdDescrp: string;
      };
    };
  };
  'back-online': {
    cmdDescrp: string;
    success: string;
  };
  'update-scheduled': {
    cmdDescrp: string;
    version: {
      cmdDescrp: string;
    };
    time: {
      cmdDescrp: string;
    };
    msg: string;
  };
  'update-complete': {
    cmdDescrp: string;
    version: {
      cmdDescrp: string;
    };
    msg: string;
  };
  publish: {
    success: string;
    fail: string;
  };
  success: string;
  error: string;
  fail: string;
  template: {
    create: {
      success: string;
      limitReached: string;
      duplicate: string;
      invalidName: string;
      invalidColor: string;
    };
    edit: {
      success: string;
      notFound: string;
    };
    delete: {
      success: string;
      notFound: string;
      isDefault: string;
    };
    list: {
      title: string;
      empty: string;
      footer: string;
    };
    preview: {
      title: string;
    };
    reset: {
      confirm: string;
      success: string;
    };
  };
  send: {
    templateNotFound: string;
    noTemplates: string;
  };
  templates: {
    maintenanceTitle: string;
    scheduledMaintenanceTitle: string;
    backOnlineTitle: string;
    updateScheduledTitle: string;
    updateCompleteTitle: string;
    durationShort: string;
    durationLong: string;
    scheduledDefaultMsg: string;
    expectedDuration: string;
    starting: string;
    startingValue: string;
    scheduledTime: string;
    relativeTime: string;
    status: string;
    statusOnline: string;
    downtimeComplete: string;
    version: string;
    newVersion: string;
    updated: string;
    timezoneFooter: string;
    sendButton: string;
    cancelButton: string;
  };
}

export interface LangBaitChannel {
  notConfigured: string;
  setupFirst: string;
  specifyRoleOrUser: string;
  builder: {
    cmdDescrp: string;
    setup: {
      descrp: string;
      channel: string;
      gracePeriod: string;
      action: string;
      actionBan: string;
      actionKick: string;
      actionTimeout: string;
      actionLogOnly: string;
      logChannel: string;
    };
    detection: {
      descrp: string;
      enabled: string;
      minAccountAge: string;
      minMembership: string;
      minMessages: string;
      requireVerification: string;
      disableAdminWhitelist: string;
      threshold: string;
      joinVelocityThreshold: string;
      joinVelocityWindow: string;
    };
    whitelist: {
      descrp: string;
      action: string;
      actionAdd: string;
      actionRemove: string;
      actionList: string;
      role: string;
      user: string;
    };
    status: {
      descrp: string;
    };
    stats: {
      descrp: string;
      days: string;
    };
    toggle: {
      descrp: string;
      enabled: string;
    };
    escalation: {
      enableDescrp: string;
      disableDescrp: string;
      thresholdsDescrp: string;
      logOption: string;
      timeoutOption: string;
      kickOption: string;
      banOption: string;
    };
    dmNotify: {
      enableDescrp: string;
      disableDescrp: string;
      appealDescrp: string;
      appealTextOption: string;
      clearAppealDescrp: string;
    };
    keywords: {
      descrp: string;
      action: string;
      keyword: string;
      weight: string;
    };
    override: {
      descrp: string;
      user: string;
    };
    addChannel: {
      descrp: string;
      channel: string;
    };
    removeChannel: {
      descrp: string;
      channel: string;
    };
    testMode: {
      descrp: string;
      enabled: string;
    };
    summary: {
      descrp: string;
      enabled: string;
      channel: string;
    };
    settings: {
      descrp: string;
    };
  };
  status: {
    title: string;
    statusEnabled: string;
    statusDisabled: string;
    channelNotFound: string;
    smartOn: string;
    smartOff: string;
    logNone: string;
    detectionSettings: string;
    minAccountAge: string;
    minMembership: string;
    minMessages: string;
    requireVerification: string;
    actionThreshold: string;
    whitelist: string;
    whitelistRoles: string;
    whitelistUsers: string;
    yes: string;
    no: string;
  };
  toggle: {
    enabled: string;
    disabled: string;
  };
  setup: {
    title: string;
    titleUpdated: string;
    footer: string;
  };
  stats: {
    title: string;
    description: string;
    totalTriggers: string;
    banned: string;
    kicked: string;
    deletedInTime: string;
    whitelisted: string;
    avgSuspicion: string;
    recentDetections: string;
    none: string;
    overrideRate: string;
    scoreDistribution: string;
    topFlags: string;
    timedOut: string;
    loggedOnly: string;
    overridden: string;
  };
  override: {
    title: string;
    success: string;
    noEntry: string;
    alreadyOverridden: string;
    logOnlyCannotOverride: string;
    user: string;
    action: string;
    score: string;
    overriddenBy: string;
    detectedAt: string;
    error: string;
  };
  whitelist: {
    added: string;
    removed: string;
    alreadyAdded: string;
    notInList: string;
    title: string;
    empty: string;
    role: string;
    user: string;
  };
  detection: {
    title: string;
    enabled: string;
    minAccountAge: string;
    minMembership: string;
    minMessages: string;
    requireVerification: string;
    threshold: string;
    joinVelocityThreshold: string;
    joinVelocityWindow: string;
    days: string;
    minutes: string;
    yes: string;
    no: string;
    reasons: {
      defaultAvatar: string;
      emptyProfile: string;
      suspiciousUsername: string;
      noRoles: string;
      discordInvite: string;
      phishingUrl: string;
      attachmentOnly: string;
      joinBurst: string;
      coordinatedRaid: string;
    };
  };
  escalation: {
    enabled: string;
    enabledDescription: string;
    disabled: string;
    thresholdsUpdated: string;
    invalidThresholds: string;
    currentThresholds: string;
  };
  dmNotify: {
    enabled: string;
    disabled: string;
    appealSet: string;
    appealCleared: string;
    appealTooLong: string;
    dmTitle: string;
    dmDescription: string;
  };
  keywords: {
    add: {
      title: string;
      success: string;
      duplicate: string;
      limitReached: string;
      invalidLength: string;
      missingKeyword: string;
    };
    remove: {
      success: string;
      notFound: string;
      missingKeyword: string;
    };
    list: {
      title: string;
      empty: string;
      footer: string;
    };
    reset: {
      confirm: string;
      success: string;
      cancelled: string;
    };
  };
  testMode: {
    enabled: string;
    disabled: string;
    title: string;
    logPrefix: string;
    gracePeriodNote: string;
  };
  multiChannel: {
    added: string;
    removed: string;
    maxReached: string;
    alreadyAdded: string;
    notInList: string;
    mustKeepOne: string;
    title: string;
    channelsLabel: string;
  };
  weeklySummary: {
    title: string;
    enabled: string;
    disabled: string;
    channelLabel: string;
  };
  error: {
    fetchStatus: string;
    toggle: string;
    setup: string;
    fetchStats: string;
    updateWhitelist: string;
    updateDetection: string;
    keywords: string;
    override: string;
    testMode: string;
    addChannel: string;
    removeChannel: string;
    weeklySummary: string;
  };
}

export interface LangDataExport {
  cmdDescrp: string;
  guildOnly: string;
  exportTitle: string;
  exportDescription: string;
  totalRecords: string;
  tables: string;
  exportedAt: string;
  footer: string;
  dmSuccess: string;
  dmFailed: string;
  error: string;
  starting: string;
  completed: string;
  dmFailedLog: string;
}

export interface LangErrors {
  unknownSubcommand: string;
  unknownTemplate: string;
  invalidParameters: string;
  cancelled: string;
  genericError: string;
  rateLimit: string;
  timeout: string;
  notYourInteraction: string;
}

export interface LangMemory {
  builder: {
    cmdDescrp: string;
    add: {
      descrp: string;
      title: string;
      category: string;
      status: string;
    };
    capture: {
      descrp: string;
      messageOption: string;
    };
    update: {
      descrp: string;
    };
    delete: {
      descrp: string;
    };
    updateStatus: {
      descrp: string;
      threadOption: string;
      statusOption: string;
    };
    updateTags: {
      descrp: string;
      threadOption: string;
    };
    tags: {
      descrp: string;
      action: string;
      actionAdd: string;
      actionEdit: string;
      actionRemove: string;
      actionList: string;
    };
  };
  setup: {
    cmdDescrp: string;
    channelOption: string;
    channelNameOption: string;
    title: string;
    description: string;
    selectChannel: string;
    channelPlaceholder: string;
    createNew: string;
    creatingForum: string;
    forumCreated: string;
    configSaved: string;
    configUpdated: string;
    forumName: string;
    forumTopic: string;
    tagsCreated: string;
    error: string;
    alreadyConfigured: string;
    currentConfig: string;
    forumChannel: string;
    welcomeTitle: string;
    welcomeDescription: string;
    addChannel: string;
    addChannelDescrp: string;
    removeChannel: string;
    removeChannelDescrp: string;
    maxChannelsReached: string;
    channelAlreadyUsed: string;
    channelAdded: string;
    channelRemoved: string;
    selectChannelToRemove: string;
    removeConfirm: string;
    removeLastWarning: string;
    viewTitle: string;
    viewNoChannels: string;
    channelNameLabel: string;
  };
  channelPicker: {
    title: string;
    description: string;
    placeholder: string;
  };
  tagSelection: {
    categoryField: string;
    statusField: string;
    notSelected: string;
  };
  add: {
    modalTitle: string;
    titleLabel: string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    success: string;
    error: string;
    viewThread: string;
    selectCategory: string;
    selectStatus: string;
    noTagsConfigured: string;
  };
  capture: {
    modalTitle: string;
    titleLabel: string;
    titlePlaceholder: string;
    success: string;
    error: string;
    invalidInput: string;
    invalidLink: string;
    messageNotFound: string;
    messageNotFoundHint: string;
    messageDeleted: string;
    channelNoAccess: string;
    channelNoPermission: string;
    messageWrongGuild: string;
    noReplyOrLink: string;
    sourceLabel: string;
  };
  update: {
    title: string;
    selectStatus: string;
    success: string;
    error: string;
    notInForum: string;
    notAThread: string;
    itemNotFound: string;
    confirmTitle: string;
    confirmMessage: string;
  };
  quickUpdate: {
    noItems: string;
    itemNotFound: string;
    threadNotFound: string;
    statusSuccess: string;
    statusError: string;
    tagsSuccess: string;
    tagsError: string;
  };
  delete: {
    success: string;
    error: string;
    notInForum: string;
    notAThread: string;
    cannotDeleteWelcome: string;
    confirmMessage: string;
  };
  tags: {
    title: string;
    description: string;
    selectAction: string;
    categoryTags: string;
    statusTags: string;
    noTags: string;
    add: {
      modalTitle: string;
      nameLabel: string;
      namePlaceholder: string;
      emojiLabel: string;
      emojiPlaceholder: string;
      typeLabel: string;
      typePlaceholder: string;
      typeInvalid: string;
      success: string;
      error: string;
      duplicate: string;
    };
    edit: {
      selectTag: string;
      modalTitle: string;
      success: string;
      error: string;
      tagNotFound: string;
    };
    remove: {
      selectTag: string;
      confirmTitle: string;
      confirmMessage: string;
      success: string;
      error: string;
      cancelled: string;
      cannotRemoveDefault: string;
    };
    list: {
      title: string;
      empty: string;
      default: string;
    };
  };
  manageTags: {
    add: {
      success: string;
      limitReached: string;
      duplicate: string;
      discordLimit: string;
    };
    remove: {
      success: string;
      isDefault: string;
      notFound: string;
    };
    edit: {
      success: string;
      notFound: string;
      noChanges: string;
    };
    list: {
      title: string;
      empty: string;
      footer: string;
    };
    reset: {
      confirm: string;
      success: string;
    };
    selectChannel: string;
    noCustomTags: string;
    autocomplete: {
      noTags: string;
    };
  };
  setupBuilder: {
    tagAdd: string;
    tagRemove: string;
    tagEdit: string;
    tagList: string;
    tagReset: string;
    tagName: string;
    tagType: string;
    tagEmoji: string;
    tagOption: string;
    tagNewName: string;
    channelOption: string;
  };
  defaultTags: {
    category: {
      bug: string;
      feature: string;
      suggestion: string;
      reminder: string;
      note: string;
    };
    status: {
      open: string;
      inProgress: string;
      onHold: string;
      completed: string;
    };
  };
  closeNotice: {
    title: string;
    description: string;
  };
  errors: {
    notConfigured: string;
    forumNotFound: string;
    tagSyncFailed: string;
  };
}

export interface LangDev {
  builder: {
    cmdDescrp: string;
    bulkCloseTickets: string;
    deleteArchivedTicket: {
      descrp: string;
      user: string;
    };
    deleteAllArchivedTickets: string;
    deleteArchivedApplication: {
      descrp: string;
      user: string;
    };
    deleteAllArchivedApplications: string;
  };
  migrate: {
    cmdDescrp: string;
    ticketTags: string;
    applicationTags: string;
  };
  bulkCloseTickets: {
    noTickets: string;
    complete: string;
    totalTickets: string;
    successfullyClosed: string;
    failed: string;
  };
  deleteArchivedTicket: {
    notFound: string;
    successWithPost: string;
    successNoPost: string;
  };
  deleteAllArchivedTickets: {
    complete: string;
    results: string;
    dbRecordsDeleted: string;
    forumPostsDeleted: string;
    forumPostsFailed: string;
  };
  deleteArchivedApplication: {
    notFound: string;
    successWithPost: string;
    successNoPost: string;
  };
  deleteAllArchivedApplications: {
    complete: string;
    results: string;
    dbRecordsDeleted: string;
    forumPostsDeleted: string;
    forumPostsFailed: string;
  };
}

export interface LangReactionRole {
  builder: {
    cmdDescrp: string;
    create: {
      descrp: string;
      channel: string;
      name: string;
      description: string;
      mode: string;
    };
    add: {
      descrp: string;
      menuId: string;
      emoji: string;
      role: string;
      description: string;
    };
    remove: {
      descrp: string;
      menuId: string;
      emoji: string;
    };
    edit: {
      descrp: string;
      menuId: string;
      name: string;
      description: string;
      mode: string;
    };
    delete: {
      descrp: string;
      menuId: string;
    };
    list: {
      descrp: string;
    };
    validate: {
      descrp: string;
    };
  };
  create: {
    success: string;
    error: string;
    maxMenus: string;
    invalidMode: string;
  };
  add: {
    success: string;
    error: string;
    duplicateEmoji: string;
    duplicateRole: string;
    maxOptions: string;
    roleTooHigh: string;
    cannotUseEveryone: string;
    cannotUseManagedRole: string;
    invalidEmoji: string;
  };
  remove: {
    success: string;
    error: string;
    notFound: string;
  };
  edit: {
    success: string;
    error: string;
    noChanges: string;
  };
  delete: {
    success: string;
    error: string;
    confirmTitle: string;
    confirmMessage: string;
  };
  list: {
    title: string;
    empty: string;
    error: string;
    menuEntry: string;
    optionEntry: string;
    channelLabel: string;
    modeLabel: string;
    optionsLabel: string;
    roleDeletedWarning: string;
  };
  menu: {
    embedFooter: string;
    modeNormal: string;
    modeUnique: string;
    modeLock: string;
    noOptions: string;
  };
  reaction: {
    roleAssigned: string;
    roleRemoved: string;
    roleNotFound: string;
    assignError: string;
    removeError: string;
    lockModeIgnore: string;
  };
  errors: {
    menuNotFound: string;
    messageNotFound: string;
    channelNotFound: string;
    noPermission: string;
  };
  validate: {
    title: string;
    checking: string;
    allValid: string;
    issuesFound: string;
    menuValid: string;
    menuMissing: string;
    channelMissing: string;
    roleMissing: string;
    error: string;
  };
  autocomplete: {
    noMenus: string;
  };
}

export interface LangStatus {
  builder: {
    cmdDescrp: string;
    set: {
      descrp: string;
      level: string;
      message: string;
      systems: string;
    };
    clear: {
      descrp: string;
      message: string;
    };
    view: {
      descrp: string;
    };
    history: {
      descrp: string;
      days: string;
    };
    subscribe: {
      descrp: string;
      channel: string;
    };
    unsubscribe: {
      descrp: string;
    };
    monitor: {
      descrp: string;
      set: {
        descrp: string;
        url: string;
      };
    };
  };
  ownerOnly: string;
  set: {
    success: string;
    error: string;
    rateLimit: string;
  };
  clear: {
    success: string;
    error: string;
    alreadyOperational: string;
  };
  view: {
    title: string;
    level: string;
    message: string;
    systems: string;
    startedAt: string;
    updatedBy: string;
    manualOverride: string;
    overrideExpires: string;
    operational: string;
    noMessage: string;
    noSystems: string;
    active: string;
    inactive: string;
  };
  levels: {
    operational: string;
    degraded: string;
    'partial-outage': string;
    'major-outage': string;
    maintenance: string;
  };
  presence: {
    degraded: string;
    'partial-outage': string;
    'major-outage': string;
    maintenance: string;
  };
  channel: {
    statusUpdate: string;
    resolved: string;
    resolvedMessage: string;
  };
  history: {
    title: string;
    noIncidents: string;
    incidentEntry: string;
    started: string;
    resolved: string;
    resolvedBy: string;
    duration: string;
    ongoing: string;
    error: string;
  };
  subscribe: {
    success: string;
    removed: string;
    notSubscribed: string;
    error: string;
  };
  monitor: {
    set: string;
    cleared: string;
    invalid: string;
    error: string;
  };
  banner: {
    warning: string;
  };
}

export interface LangRulesSetup {
  builder: {
    cmdDescrp: string;
    setup: {
      descrp: string;
      channel: string;
      role: string;
      message: string;
      emoji: string;
    };
    view: {
      descrp: string;
    };
    remove: {
      descrp: string;
    };
  };
  setup: {
    success: string;
    updated: string;
    error: string;
    roleTooHigh: string;
    cannotUseEveryone: string;
    cannotUseManagedRole: string;
    defaultMessage: string;
    invalidEmoji: string;
  };
  view: {
    title: string;
    notConfigured: string;
    channel: string;
    role: string;
    emoji: string;
    customMessage: string;
    defaultLabel: string;
  };
  remove: {
    success: string;
    notConfigured: string;
    error: string;
    messageDeleteFailed: string;
  };
  reaction: {
    roleAssigned: string;
    roleRemoved: string;
    roleNotFound: string;
    assignError: string;
    removeError: string;
  };
}

export interface LangStarboard {
  setup: {
    success: string;
    disabled: string;
    enabled: string;
    alreadyEnabled: string;
    notConfigured: string;
    channelRequired: string;
    thresholdRange: string;
    configUpdated: string;
  };
  ignore: {
    added: string;
    removed: string;
    notIgnored: string;
  };
  stats: {
    title: string;
    totalStarred: string;
    topMessage: string;
    noEntries: string;
  };
  random: {
    noEntries: string;
    title: string;
  };
  errors: {
    selfStar: string;
    botMessage: string;
    nsfwChannel: string;
  };
  builder: {
    cmdDescrp: string;
    setup: {
      descrp: string;
      channel: string;
      emoji: string;
      threshold: string;
    };
    config: {
      descrp: string;
      setting: string;
      value: string;
    };
    ignore: {
      descrp: string;
      channel: string;
    };
    unignore: {
      descrp: string;
      channel: string;
    };
    stats: {
      descrp: string;
    };
    toggle: {
      descrp: string;
    };
    random: {
      descrp: string;
    };
  };
}

/**
 * Main language interface combining all modules
 */
export interface Language {
  general: LangGeneral;
  main: LangMain;
  console: LangConsole;
  botConfig: LangBotConfig;
  botSetup: LangBotSetup;
  ticketSetup: LangTicketSetup;
  ticket: LangTicket;
  application: LangApplication;
  addRole: LangRoles['addRole'];
  removeRole: LangRoles['removeRole'];
  getRoles: LangRoles['getRoles'];
  cogdeck: {
    cmdDescrp: string;
  };
  announcement: LangAnnouncement;
  baitChannel: LangBaitChannel;
  dataExport: LangDataExport;
  errors: LangErrors;
  dev: LangDev;
  memory: LangMemory;
  rules: LangRulesSetup;
  reactionRole: LangReactionRole;
  starboard: LangStarboard;
  status: LangStatus;
  import: LangImport;
  xp: LangXP;
  onboarding: LangOnboarding;
  automod: LangAutomod;
  event: LangEvent;
  analytics: LangAnalytics;
}

// New feature lang types — loosely typed to avoid maintaining duplicate type definitions
// These match arbitrary JSON structures from lang files
export type LangXP = Record<string, any>;
export type LangOnboarding = Record<string, any>;
export type LangAutomod = Record<string, any>;
export type LangEvent = Record<string, any>;
export type LangAnalytics = Record<string, any>;

export interface LangImport {
  commands: {
    importStarted: string;
    importComplete: string;
    importFailed: string;
    importCancelled: string;
    importAlreadyRunning: string;
    importCooldown: string;
    noImportRunning: string;
    dryRunComplete: string;
    csvRequired: string;
    csvInvalidFormat: string;
    mee6LeaderboardNotPublic: string;
    statusTitle: string;
    historyTitle: string;
    noHistory: string;
    cmdDescrp: string;
    mee6Descrp: string;
    csvDescrp: string;
    statusDescrp: string;
    historyDescrp: string;
    cancelDescrp: string;
    overwriteOption: string;
    dryRunOption: string;
    attachmentOption: string;
  };
}
