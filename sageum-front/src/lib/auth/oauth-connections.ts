export type OAuthConnectionSummary = {
  clientId: string;
  clientName: string;
  clientUri: string;
  scopes: string[];
  canUpload: boolean;
  grantedAt: string;
};

export type OAuthConnectionsState = {
  connections: OAuthConnectionSummary[];
  error: boolean;
};
