import { tryCreateServiceClient } from "@/lib/supabase";
import {
  getAccountSnapshot,
  memoryInsertAudit,
  memoryOldestPending,
  memoryListPending,
} from "@/lib/approval/store";
import { markExpired } from "@/lib/expiry";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { phraseEngineResult } from "@/lib/ai/ask";
import type { PendingRequestRow } from "@/lib/supabase/types";

/** Hard-coded: the voice agent must never approve. */
export const VOICE_NO_APPROVAL =
  "I cannot approve anything. Approval requires a physical NFC tap on a Keyring card. Software — including this voice agent — cannot approve.";

export async function writeVoiceAudit(
  actor: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  memoryInsertAudit(actor, action, detail);
  const supabase = tryCreateServiceClient();
  if (!supabase) return;
  await supabase.from("audit").insert({ actor, action, detail });
}

export async function getOldestPendingRequest(): Promise<PendingRequestRow | null> {
  const supabase = tryCreateServiceClient();
  if (supabase) {
    await markExpired(supabase);
    const { data } = await supabase
      .from("pending_requests")
      .select("*")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return memoryOldestPending();
}

/**
 * Engine-backed explanation of what approving the pending request unlocks.
 * The LLM/voice agent never decides permissions — this uses the graph engine.
 */
export function explainWhatUnlocks(request: PendingRequestRow): {
  question: string;
  answer: string;
  toolCalled: string;
  args: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
} {
  const snapshot = getAccountSnapshot();
  const payload = request.payload ?? {};

  if (request.kind === "grant_admin") {
    const subjectId = String(payload.subject_id ?? "unknown");
    const role = String(payload.role ?? "Administrator");
    const target = String(payload.target ?? "account");
    const question = `what does this unlock`;
    if (!snapshot?.raw) {
      return {
        question,
        answer: `Approving grants ${subjectId} temporary ${role} on ${target} for 15 minutes. The account file is not loaded, so path details are unavailable.`,
        toolCalled: "none",
        args: { subjectId, role, target },
        confidence: "medium",
      };
    }
    const parsed = parseAccountJson(snapshot.raw);
    if (!parsed.ok) {
      return {
        question,
        answer: `Approving would create a 15-minute ${role} grant for ${subjectId} on ${target}.`,
        toolCalled: "none",
        args: { subjectId, role, target },
        confidence: "medium",
      };
    }
    const engine = createQueryEngine(parsed.data);
    const args = { subjectId, target };
    const result = engine.pathsBetween(subjectId, target);
    return {
      question,
      answer: `${phraseEngineResult("pathsBetween", result)} Approving this request also creates a standing elevated grant of ${role} on ${target} for 15 minutes.`,
      toolCalled: "pathsBetween",
      args,
      confidence: result.length > 0 ? "high" : "medium",
    };
  }

  // apply_fix
  const findingId = String(payload.finding_id ?? "");
  const suggestedFix = (payload.suggestedFix ?? {}) as Record<string, unknown>;
  const question = `what does this unlock`;

  if (!snapshot?.raw) {
    return {
      question,
      answer: `Approving applies the suggested fix for ${findingId || "the finding"} and re-runs analysis so that finding should disappear.`,
      toolCalled: "none",
      args: { findingId },
      confidence: "medium",
    };
  }

  const parsed = parseAccountJson(snapshot.raw);
  if (!parsed.ok) {
    return {
      question,
      answer: `Approving applies the corrected policy for ${findingId}.`,
      toolCalled: "none",
      args: { findingId },
      confidence: "low",
    };
  }

  const engine = createQueryEngine(parsed.data);
  const findings = engine.listFindings();
  const finding = findings.find((f) => f.id === findingId);
  const fixSummary = summarizeFix(suggestedFix);

  // Prefer paths for escalation-style findings
  if (findingId.includes("escalation") || finding?.severity === "CRITICAL") {
    const subjectMatch = findingId.match(/finding-escalation-(.+)$/);
    const subjectId = subjectMatch?.[1] ?? "u-dev-marco";
    const target = "databases-for-postgresql/production";
    const result = engine.pathsBetween(subjectId, target);
    return {
      question,
      answer: `This unlocks removing a dangerous access path. ${phraseEngineResult("pathsBetween", result)} The suggested fix (${fixSummary}) closes that path when approved by NFC tap.`,
      toolCalled: "pathsBetween",
      args: { subjectId, target },
      confidence: "high",
    };
  }

  return {
    question,
    answer: finding
      ? `Approving applies this fix and clears finding "${finding.title}": ${finding.explanation} Suggested change: ${fixSummary}.`
      : `Approving applies the suggested policy correction (${fixSummary}) and re-runs findings.`,
    toolCalled: "listFindings",
    args: { findingId },
    confidence: finding ? "high" : "medium",
  };
}

function summarizeFix(fix: Record<string, unknown>): string {
  const bits: string[] = [];
  if (typeof fix.id === "string") bits.push(`id ${fix.id}`);
  if (fix.roles && typeof fix.roles === "object") {
    const roles = fix.roles as { platform?: string[]; service?: string[] };
    bits.push(
      [...(roles.platform ?? []), ...(roles.service ?? [])].join("/") || "roles",
    );
  }
  if (typeof fix.mfa_enabled === "boolean") {
    bits.push(`mfa=${fix.mfa_enabled}`);
  }
  if (Array.isArray(fix.claim_rules)) bits.push("tighten claim rules");
  return bits.join(", ") || "corrected policy JSON";
}

export async function getPendingRequestContext(options?: {
  user_question?: string;
}): Promise<Record<string, unknown>> {
  const request = await getOldestPendingRequest();
  const seconds_remaining = request
    ? Math.max(
        0,
        Math.floor(
          (new Date(request.expires_at).getTime() - Date.now()) / 1000,
        ),
      )
    : 0;

  if (!request) {
    return {
      ok: true,
      can_approve: false,
      approval_capability: "none",
      approval_message: VOICE_NO_APPROVAL,
      pending_request: null,
      what_this_unlocks: {
        question: "what does this unlock",
        answer: "There is no pending request right now.",
      },
      instruction:
        "Explain that there is nothing waiting. Never claim you can approve.",
    };
  }

  const unlocks = explainWhatUnlocks(request);
  const allPending = memoryListPending().filter((r) => r.status === "pending");

  return {
    ok: true,
    // HARD-CODED: voice agent has no approval capability.
    can_approve: false,
    approval_capability: "none",
    approval_message: VOICE_NO_APPROVAL,
    pending_request: {
      id: request.id,
      kind: request.kind,
      reason: request.reason,
      requested_by: request.requested_by,
      dual_control: request.dual_control,
      status: request.status,
      created_at: request.created_at,
      expires_at: request.expires_at,
      seconds_remaining,
      payload_summary: summarizePayload(request),
    },
    pending_count: Math.max(allPending.length, 1),
    what_this_unlocks: unlocks,
    user_question: options?.user_question ?? null,
    instruction:
      "Explain the pending request and what approving unlocks. Answer questions using this data. If asked to approve, refuse and say approval requires a physical NFC tap. You have no approval capability.",
  };
}

function summarizePayload(request: PendingRequestRow): Record<string, unknown> {
  const p = request.payload ?? {};
  if (request.kind === "grant_admin") {
    return {
      subject_id: p.subject_id,
      role: p.role,
      target: p.target,
    };
  }
  return {
    finding_id: p.finding_id,
    severity: p.severity,
    has_suggested_fix: Boolean(p.suggestedFix),
  };
}
