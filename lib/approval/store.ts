import type { AuditRow, CardRow, GrantRow, PendingRequestRow, TapRow } from "@/lib/supabase/types";

export const CARD_A_ID = "11111111-1111-1111-1111-111111111111";
export const CARD_B_ID = "22222222-2222-2222-2222-222222222222";

export const SEED_CARDS: CardRow[] = [
  {
    id: CARD_A_ID,
    label: "Card A",
    holder_name: "Priya Raman",
    active: true,
  },
  {
    id: CARD_B_ID,
    label: "Card B",
    holder_name: "Alex Rivera",
    active: true,
  },
];

export type AccountSnapshot = {
  raw: string;
  account_id: string;
  finding_ids: string[];
  updated_at: string;
};

type MemoryState = {
  cards: CardRow[];
  pending: PendingRequestRow[];
  taps: TapRow[];
  grants: GrantRow[];
  audit: AuditRow[];
  account: AccountSnapshot | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __keyringMemory: MemoryState | undefined;
}

function state(): MemoryState {
  if (!globalThis.__keyringMemory) {
    globalThis.__keyringMemory = {
      cards: [...SEED_CARDS],
      pending: [],
      taps: [],
      grants: [],
      audit: [],
      account: null,
    };
  }
  return globalThis.__keyringMemory;
}

export function resolveCardId(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "a" || raw === "card-a" || raw === CARD_A_ID) return CARD_A_ID;
  if (raw === "b" || raw === "card-b" || raw === CARD_B_ID) return CARD_B_ID;
  const hit = state().cards.find((c) => c.id.toLowerCase() === raw);
  return hit?.id ?? (raw.includes("-") ? input.trim() : null);
}

export function getMemoryState(): MemoryState {
  return state();
}

export function setAccountSnapshot(snapshot: AccountSnapshot): void {
  state().account = snapshot;
}

export function getAccountSnapshot(): AccountSnapshot | null {
  return state().account;
}

export function memoryInsertAudit(
  actor: string,
  action: string,
  detail: Record<string, unknown>,
): AuditRow {
  const row: AuditRow = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  };
  state().audit.unshift(row);
  state().audit = state().audit.slice(0, 100);
  return row;
}

export function memoryInsertPending(
  row: Omit<PendingRequestRow, "id" | "created_at" | "expires_at" | "status"> & {
    id?: string;
    created_at?: string;
    expires_at?: string;
    status?: PendingRequestRow["status"];
  },
): PendingRequestRow {
  const created_at = row.created_at ?? new Date().toISOString();
  const expires_at =
    row.expires_at ??
    new Date(new Date(created_at).getTime() + 60_000).toISOString();
  const full: PendingRequestRow = {
    id: row.id ?? crypto.randomUUID(),
    kind: row.kind,
    payload: row.payload,
    requested_by: row.requested_by,
    reason: row.reason,
    dual_control: row.dual_control,
    created_at,
    expires_at,
    status: row.status ?? "pending",
  };
  state().pending.unshift(full);
  return full;
}

export function memoryMarkExpired(now = new Date()): void {
  const iso = now.toISOString();
  for (const req of state().pending) {
    if (req.status === "pending" && req.expires_at < iso) {
      req.status = "expired";
    }
  }
  for (const grant of state().grants) {
    if (!grant.revoked_at && grant.expires_at < iso) {
      grant.revoked_at = iso;
    }
  }
}

export function memoryOldestPending(): PendingRequestRow | null {
  memoryMarkExpired();
  const pending = state()
    .pending.filter((r) => r.status === "pending")
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  return pending[0] ?? null;
}

export function memoryGetCard(cardId: string): CardRow | null {
  return state().cards.find((c) => c.id === cardId) ?? null;
}

export function memoryAddTap(cardId: string, requestId: string): TapRow {
  const existing = state().taps.find(
    (t) => t.request_id === requestId && t.card_id === cardId,
  );
  if (existing) return existing;
  const tap: TapRow = {
    id: crypto.randomUUID(),
    card_id: cardId,
    request_id: requestId,
    created_at: new Date().toISOString(),
  };
  state().taps.push(tap);
  return tap;
}

export function memoryTapsForRequest(requestId: string): TapRow[] {
  return state().taps.filter((t) => t.request_id === requestId);
}

export function memoryUpdatePending(
  id: string,
  patch: Partial<PendingRequestRow>,
): PendingRequestRow | null {
  const row = state().pending.find((r) => r.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  return row;
}

export function memoryInsertGrant(
  grant: Omit<GrantRow, "id" | "granted_at" | "revoked_at"> & {
    id?: string;
    granted_at?: string;
    revoked_at?: string | null;
  },
): GrantRow {
  const row: GrantRow = {
    id: grant.id ?? crypto.randomUUID(),
    subject_id: grant.subject_id,
    role: grant.role,
    target: grant.target,
    granted_at: grant.granted_at ?? new Date().toISOString(),
    expires_at: grant.expires_at,
    revoked_at: grant.revoked_at ?? null,
  };
  state().grants.unshift(row);
  return row;
}

export function memoryListAudit(): AuditRow[] {
  return [...state().audit];
}

export function memoryListGrants(): GrantRow[] {
  memoryMarkExpired();
  return [...state().grants];
}

export function memoryListPending(): PendingRequestRow[] {
  memoryMarkExpired();
  return [...state().pending];
}
