/**
 * Type definitions for all language/translation strings in the bot
 * This provides type-safe access to all translation strings with autocomplete support
 */

export interface LangGeneral {
    presenceMsg: string;
    descriptionMsg: string;
    fatalError: string;
    channelNotFound: string;
    cmdTicketNotFound: string;
    cmdGuildNotFound: string;
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
    error: string;
    timeout: string;
    fail: string;
    select1: string;
    select2: string;
    select3: string;
    noRoleSelected: string;
    roleSelectTimeout: string;
    ticketArchiveMsg: string;
    applicationButtonMsg: string;
    applicationArchiveMsg: string;
}

export interface LangTicketSetup {
    cmdDescrp: string;
    subcmdDescrp: {
        channel: string;
        category: string;
        archive: string;
        option: string;
        catset: string;
    };
    createTicket: string;
    fail: string;
    successSet: string;
    successUpdate: string;
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
    ageVerify: {
        dobLabel: string;
        header: string;
        dob: string;
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
}

export interface LangTicketReply {
    cmdDescrp: string;
    subcmdGroupDescrp: {
        bapple: string;
    };
    subcmdDescrp: {
        approve: string;
        deny: string;
    };
    bapple: {
        approve: string;
        approveSent: string;
        deny: string;
        denySent: string;
    };
}

export interface LangApplication {
    error: string;
    failCreate: string;
    setup: {
        cmdDescrp: string;
        subcmdDescrp: {
            channel: string;
            channelSet: string;
            category: string;
            catSet: string;
            archive: string;
            archiveSet: string;
        };
        fail: string;
        successSet: string;
        successUpdate: string;
    };
    archiveSetup: {
        initialMsg: string;
        fail: string;
        successSet: string;
        successUpdate: string;
    };
    categorySetup: {
        setChannelFirst: string;
        success: string;
        fail: string;
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
            remove: string;
            'remove-id': string;
            toggle: string;
            'toggle-id': string;
            list: string;
            refresh: string;
        };
        notAvailable: string;
        ageVerifyYes: string;
        ageVerifyNo: string;
        ageVerifyNoReply: string;
        modal: {
            name: string;
            experience: string;
            experienceP: string;
            why: string;
            whyP: string;
            location: string;
            locationP: string;
            availability: string;
            availabilityP: string;
        };
        noneFound: string;
        noneAvailable: string;
        available: string;
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
}

export interface LangBaitChannel {
	notConfigured: string;
	setupFirst: string;
	specifyRoleOrUser: string;
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
		days: string;
		minutes: string;
		yes: string;
		no: string;
	};
	error: {
		fetchStatus: string;
		toggle: string;
		setup: string;
		fetchStats: string;
		updateWhitelist: string;
		updateDetection: string;
	};
}

export interface LangDataExport {
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
    archiveSetup: {
        initialMsg: string;
        fail: string;
    };
    categorySetup: {
        setChannelFirst: string;
        success: string;
        fail: string;
    };
    ticket: LangTicket;
    ticketReply: LangTicketReply;
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
}
