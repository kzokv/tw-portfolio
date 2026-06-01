import type { AiConnectorScope } from "@vakwen/shared-types";

export const AI_CONNECTOR_SCOPE_LABELS: Record<AiConnectorScope, string> = {
  "portfolio:mcp_read": "Read portfolio data",
  "account:manage": "Manage accounts",
  "transaction_draft:create": "Create transaction drafts",
  "transaction_draft:edit": "Edit transaction drafts",
  "transaction_draft:archive": "Archive transaction drafts",
  "transaction_draft:delete": "Delete transaction drafts",
  "transaction:write": "Post confirmed transactions",
};
