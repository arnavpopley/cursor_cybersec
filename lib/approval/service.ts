import { tryCreateServiceClient, type KeyringSupabase } from "@/lib/supabase";
import type {
  CardRow,
  GrantRow,
  PendingRequestRow,
  RequestKind,
} from "@/lib/supabase/types";
import { markExpired } from "@/lib/expiry";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { applySuggestedFixToRaw } from "./apply-fix";
import {
  getAccountSnapshot,
  memoryAddTap,
  memoryGetCard,
  memoryInsertAudit,
  memoryInsertGrant,
  memoryInsertPending,
  memoryListPending,
  memoryOldestPending,
  memoryTapsForRequest,
  memoryUpdatePending,
  resolveCardId,
  setAccountSnapshot,
  SEED_CARDS,
} from "./store";

export type CreateRequestInput = {
  kind: RequestKind;
  payload: Record<string, unknown>;
  requested_by: string;
  reason: string;
  dual_control?: boolean;
};

export type TapOutcome =
  | {
      ok: true;
      status: "approved" | "waiting";
      request: PendingRequestRow;
      taps: number;
      required: number;
      message: string;
      grant?: GrantRow;
      account?: {
        raw: string;
        account_id: string;
        finding_ids: string[];
        findings?: unknown[];
      };
    }
  | {
      ok: false;
      status: "error" | "expired" | "rejected";
      message: string;
    };

async function writeAudit(
  supabase: KeyringSupabase | null,
  actor: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  memoryInsertAudit(actor, action, detail);
  if (!supabase) return;
  await supabase.from("audit").insert({ actor, action, detail });
}

export async function createPendingRequest(
  input: CreateRequestInput,
): Promise<{ mode: "supabase" | "local"; request: PendingRequestRow }> {
  const dual_control = input.dual_control ?? false;
  const supabase = tryCreateServiceClient();

  if (!supabase) {
    const request = memoryInsertPending({
      kind: input.kind,
      payload: input.payload,
      requested_by: input.requested_by,
      reason: input.reason,
      dual_control,
    });
    await writeAudit(null, input.requested_by, "request.created", {
      request_id: request.id,
      kind: request.kind,
      dual_control: request.dual_control,
      reason: request.reason,
    });
    return { mode: "local", request };
  }

  const { data, error } = await supabase
    .from("pending_requests")
    .insert({
      kind: input.kind,
      payload: input.payload,
      requested_by: input.requested_by,
      reason: input.reason,
      dual_control,
    })
    .select("*")
    .single();

  if (error || !data) {
    // Fall back to local so the demo still works if Supabase insert fails.
    const request = memoryInsertPending({
      kind: input.kind,
      payload: input.payload,
      requested_by: input.requested_by,
      reason: input.reason,
      dual_control,
    });
    await writeAudit(supabase, input.requested_by, "request.created", {
      request_id: request.id,
      kind: request.kind,
      dual_control: request.dual_control,
      reason: request.reason,
      supabase_error: error?.message,
      mode: "local_fallback",
    });
    return { mode: "local", request };
  }

  await writeAudit(supabase, input.requested_by, "request.created", {
    request_id: data.id,
    kind: data.kind,
    dual_control: data.dual_control,
    reason: data.reason,
  });

  // Mirror into memory so demo shortcut/tap works even if Realtime lags.
  memoryInsertPending(data);

  return { mode: "supabase", request: data };
}

async function loadCard(
  supabase: KeyringSupabase | null,
  cardId: string,
): Promise<CardRow | null> {
  const local = memoryGetCard(cardId) ?? SEED_CARDS.find((c) => c.id === cardId);
  if (!supabase) return local ?? null;
  const { data } = await supabase
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .maybeSingle();
  return data ?? local ?? null;
}

async function oldestPending(
  supabase: KeyringSupabase | null,
): Promise<PendingRequestRow | null> {
  if (!supabase) return memoryOldestPending();

  await markExpired(supabase);
  const { data } = await supabase
    .from("pending_requests")
    .select("*")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  return data?.[0] ?? memoryOldestPending();
}

async function recordTap(
  supabase: KeyringSupabase | null,
  cardId: string,
  requestId: string,
): Promise<{ taps: number; distinct: number }> {
  memoryAddTap(cardId, requestId);
  if (supabase) {
    await supabase.from("taps").upsert(
      { card_id: cardId, request_id: requestId },
      { onConflict: "request_id,card_id", ignoreDuplicates: true },
    );
    const { data } = await supabase
      .from("taps")
      .select("card_id")
      .eq("request_id", requestId);
    const cards = new Set((data ?? []).map((t) => t.card_id));
    return { taps: data?.length ?? 0, distinct: cards.size };
  }
  const taps = memoryTapsForRequest(requestId);
  return {
    taps: taps.length,
    distinct: new Set(taps.map((t) => t.card_id)).size,
  };
}

async function finalizeApproval(
  supabase: KeyringSupabase | null,
  request: PendingRequestRow,
  cardId: string,
): Promise<{
  grant?: GrantRow;
  account?: {
    raw: string;
    account_id: string;
    finding_ids: string[];
    findings?: unknown[];
  };
}> {
  if (supabase) {
    await supabase
      .from("pending_requests")
      .update({ status: "approved" })
      .eq("id", request.id);
  }
  memoryUpdatePending(request.id, { status: "approved" });

  await writeAudit(supabase, `card:${cardId}`, "request.approved", {
    request_id: request.id,
    kind: request.kind,
    dual_control: request.dual_control,
  });

  if (request.kind === "grant_admin") {
    const payload = request.payload;
    const subject_id = String(payload.subject_id ?? "u-unknown");
    const role = String(payload.role ?? "Administrator");
    const target = String(payload.target ?? "account");
    const expires_at = new Date(Date.now() + 15 * 60_000).toISOString();

    let grant: GrantRow;
    if (supabase) {
      const { data } = await supabase
        .from("grants")
        .insert({ subject_id, role, target, expires_at })
        .select("*")
        .single();
      grant =
        data ??
        memoryInsertGrant({ subject_id, role, target, expires_at });
      if (data) memoryInsertGrant(data);
    } else {
      grant = memoryInsertGrant({ subject_id, role, target, expires_at });
    }

    await writeAudit(supabase, `card:${cardId}`, "grant.created", {
      grant_id: grant.id,
      subject_id,
      role,
      target,
      expires_at,
      request_id: request.id,
    });
    return { grant };
  }

  // apply_fix
  const snapshot = getAccountSnapshot();
  const suggestedFix = (request.payload.suggestedFix ??
    request.payload.suggested_fix) as Record<string, unknown> | undefined;
  const findingId = String(request.payload.finding_id ?? "");

  if (!snapshot?.raw || !suggestedFix) {
    await writeAudit(supabase, `card:${cardId}`, "fix.apply_failed", {
      request_id: request.id,
      reason: "missing account snapshot or suggestedFix",
    });
    return {};
  }

  const nextRaw = applySuggestedFixToRaw(
    snapshot.raw,
    suggestedFix,
    findingId,
  );
  const parsed = parseAccountJson(nextRaw);
  if (!parsed.ok) {
    await writeAudit(supabase, `card:${cardId}`, "fix.apply_failed", {
      request_id: request.id,
      errors: parsed.errors,
    });
    return {};
  }

  const findings = createQueryEngine(parsed.data).listFindings();
  const account = {
    raw: nextRaw,
    account_id: parsed.data.account_id,
    finding_ids: findings.map((f) => f.id),
    findings,
  };
  setAccountSnapshot({
    raw: account.raw,
    account_id: account.account_id,
    finding_ids: account.finding_ids,
    updated_at: new Date().toISOString(),
  });

  await writeAudit(supabase, `card:${cardId}`, "fix.applied", {
    request_id: request.id,
    finding_id: findingId,
    account_id: account.account_id,
    finding_count: findings.length,
    removed_finding: findingId,
  });

  return { account };
}

/**
 * Process an NFC tap (or demo shortcut approval).
 * Approves the oldest pending request the card may act on.
 */
export async function processCardTap(
  cardInput: string,
  options?: { forceApprove?: boolean },
): Promise<TapOutcome> {
  const supabase = tryCreateServiceClient();
  const cardId = resolveCardId(cardInput);
  if (!cardId) {
    return { ok: false, status: "rejected", message: "Unknown card." };
  }

  const card = await loadCard(supabase, cardId);
  if (!card || !card.active) {
    await writeAudit(supabase, `card:${cardId}`, "tap.rejected", {
      reason: "inactive_or_unknown_card",
    });
    return {
      ok: false,
      status: "rejected",
      message: "This card is not active.",
    };
  }

  const request = await oldestPending(supabase);
  if (!request) {
    await writeAudit(supabase, `card:${cardId}`, "tap.no_request", {
      card_label: card.label,
    });
    return {
      ok: false,
      status: "error",
      message: "No pending request to approve.",
    };
  }

  if (new Date(request.expires_at).getTime() <= Date.now()) {
    if (supabase) {
      await supabase
        .from("pending_requests")
        .update({ status: "expired" })
        .eq("id", request.id);
    }
    memoryUpdatePending(request.id, { status: "expired" });
    await writeAudit(supabase, `card:${cardId}`, "request.expired", {
      request_id: request.id,
    });
    return {
      ok: false,
      status: "expired",
      message: "That request expired. Create a new one from Keyring.",
    };
  }

  const { distinct } = await recordTap(supabase, cardId, request.id);
  await writeAudit(supabase, `card:${cardId}`, "tap.recorded", {
    request_id: request.id,
    card_label: card.label,
    distinct_cards: distinct,
    dual_control: request.dual_control,
  });

  const required = request.dual_control ? 2 : 1;
  if (!options?.forceApprove && distinct < required) {
    return {
      ok: true,
      status: "waiting",
      request,
      taps: distinct,
      required,
      message: `Tap recorded from ${card.holder_name}. Waiting for a second distinct card (${distinct}/${required}).`,
    };
  }

  const finalized = await finalizeApproval(supabase, request, cardId);
  return {
    ok: true,
    status: "approved",
    request: { ...request, status: "approved" },
    taps: Math.max(distinct, required),
    required,
    message:
      request.kind === "grant_admin"
        ? "Approved. Elevated grant is live for 15 minutes."
        : "Approved. Fix applied — findings will refresh.",
    grant: finalized.grant,
    account: finalized.account,
  };
}

/** Demo fallback: approve oldest pending without a physical card. */
export async function demoApproveOldest(): Promise<TapOutcome> {
  const pending = memoryListPending().find((r) => r.status === "pending");
  const supabase = tryCreateServiceClient();
  const request = pending ?? (await oldestPending(supabase));
  if (!request) {
    return {
      ok: false,
      status: "error",
      message: "No pending request to approve.",
    };
  }
  // Use Card A as the demo actor; forceApprove skips dual-control wait.
  return processCardTap(SEED_CARDS[0]!.id, { forceApprove: true });
}

export function syncAccountFromAnalyze(input: {
  raw: string;
  account_id: string;
  finding_ids: string[];
}): void {
  setAccountSnapshot({
    raw: input.raw,
    account_id: input.account_id,
    finding_ids: input.finding_ids,
    updated_at: new Date().toISOString(),
  });
}
