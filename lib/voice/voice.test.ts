import { beforeEach, describe, expect, it } from "vitest";
import {
  createPendingRequest,
  syncAccountFromAnalyze,
} from "@/lib/approval/service";
import { getMemoryState } from "@/lib/approval/store";
import { getPendingRequestContext, VOICE_NO_APPROVAL } from "./context";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("voice pending context", () => {
  beforeEach(() => {
    const mem = getMemoryState();
    mem.pending = [];
    mem.taps = [];
    mem.grants = [];
    mem.audit = [];
    mem.account = null;
  });

  it("returns pending detail and what-this-unlocks with can_approve false", async () => {
    const raw = readFileSync(
      resolve(__dirname, "../../fixtures/acme-account.json"),
      "utf8",
    );
    const parsed = parseAccountJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = createQueryEngine(parsed.data).listFindings();
    const finding = findings.find((f) => f.id === "finding-open-tp-tp-github-ci")!;

    syncAccountFromAnalyze({
      raw,
      account_id: parsed.data.account_id,
      finding_ids: findings.map((f) => f.id),
    });

    await createPendingRequest({
      kind: "apply_fix",
      requested_by: "analyst",
      reason: finding.title,
      dual_control: true,
      payload: {
        finding_id: finding.id,
        severity: finding.severity,
        suggestedFix: finding.suggestedFix,
      },
    });

    const ctx = await getPendingRequestContext({
      user_question: "what does this unlock?",
    });

    expect(ctx.can_approve).toBe(false);
    expect(ctx.approval_capability).toBe("none");
    expect(ctx.approval_message).toBe(VOICE_NO_APPROVAL);
    expect(ctx.pending_request).toBeTruthy();
    const unlocks = ctx.what_this_unlocks as { answer: string };
    expect(unlocks.answer.length).toBeGreaterThan(20);
  });

  it("hard-codes no approval even with no pending request", async () => {
    const ctx = await getPendingRequestContext();
    expect(ctx.can_approve).toBe(false);
    expect(String(ctx.approval_message)).toMatch(/physical/i);
  });
});
