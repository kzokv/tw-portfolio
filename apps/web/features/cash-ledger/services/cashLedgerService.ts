import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountType,
} from "@tw-portfolio/shared-types";
import { getJson, postJson } from "../../../lib/api";
import type { CashLedgerListResponse, CashLedgerQuery } from "../types";

/**
 * KZO-179: request body for `POST /accounts`. Mirrors the Zod schema in
 * `apps/api/src/routes/registerRoutes.ts`. `feeProfileId` is optional —
 * the route resolves it via the cascade in scope-todo D5 when omitted.
 */
export interface CreateAccountInput {
  name: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType: AccountType;
  feeProfileId?: string;
}

export async function fetchCashLedgerEntries(
  query: CashLedgerQuery = {},
): Promise<CashLedgerListResponse> {
  const params = new URLSearchParams();

  if (query.fromEntryDate) params.set("fromEntryDate", query.fromEntryDate);
  if (query.toEntryDate) params.set("toEntryDate", query.toEntryDate);
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.entryType) {
    for (const t of query.entryType) {
      params.append("entryType", t);
    }
  }
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);

  const qs = params.toString();
  return getJson<CashLedgerListResponse>(`/portfolio/cash-ledger${qs ? `?${qs}` : ""}`);
}

/**
 * KZO-167: fetch the user's accounts so the dropdown and summary chips can
 * render `name (currency · type)` instead of the raw account ID. Falls back
 * to the raw ID rendering until this resolves.
 */
export async function fetchAccounts(): Promise<AccountDto[]> {
  return getJson<AccountDto[]>("/accounts");
}

/**
 * KZO-179: create a new account via `POST /accounts`. Returns the bare
 * `AccountDto` (per scope-todo D7). The route validates name uniqueness
 * (per-user, case-sensitive) and resolves the fee profile when omitted.
 *
 * Caller is expected to surface inline errors:
 * - 409 `account_name_in_use` → "An account with that name already exists."
 * - 500 / generic → "Could not create account. Please try again."
 *
 * The shared `postJson` helper throws `ApiError` for non-2xx responses;
 * callers should `.catch` and read `error.code` / `error.status`.
 */
export async function createAccount(input: CreateAccountInput): Promise<AccountDto> {
  return postJson<AccountDto>("/accounts", input);
}
