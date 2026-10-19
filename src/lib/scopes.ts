// Delegated scopes only. Mail.Send is deliberately never requested, even though the Entra app may hold consent for it.
export const GRAPH_SCOPES = [
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Files.ReadWrite",
  "https://graph.microsoft.com/Contacts.Read",
  "https://graph.microsoft.com/People.Read",
  "offline_access",
].join(" ");

export const SIGN_IN_SCOPES = `openid profile email ${GRAPH_SCOPES}`;
