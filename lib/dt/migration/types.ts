export type MigrationOptions = {
  dryRun: boolean;
  sendInvites: boolean;
  orgFilter: string | null;
  apply: boolean;
};

export type OrgMapEntry = {
  legacyClient: string;
  organisationId: string;
  organisationName: string;
  created: boolean;
};

export type MigrationCounts = {
  orgConfigs: number;
  agents: number;
  seoTasks: number;
  chats: number;
  messages: number;
  reports: number;
  sitePages: number;
  archived: number;
  invites: number;
};

export type VerificationMismatch = {
  legacyClient: string;
  organisationId: string;
  oldMessages: number;
  newMessages: number;
};
