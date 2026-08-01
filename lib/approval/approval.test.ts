import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { applySuggestedFixToRaw } from "./apply-fix";
import {
  createPendingRequest,
  processCardTap,
  syncAccountFromAnalyze,
} from "./service";
import { getMemoryState, CARD_A_ID, CARD_B_ID } from "./store";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";

const fixturePath = resolve(__dirname, "../../fixtures/acme-account.json");

describe("approval flow", () => {
  beforeEach(() => {
    const mem = getMemoryState();
    mem.pending = [];
    mem.taps = [];
    mem.grants = [];
    mem.audit = [];
    mem.account = null;
  });

  it("applies a suggested fix and removes the marco escalation finding", () => {
    const raw = readFileSync(fixturePath, "utf8");
    const parsed = parseAccountJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const before = createQueryEngine(parsed.data).listFindings();
    expect(
      before.some((f) => f.id === "finding-escalation-u-dev-marco"),
    ).toBe(true);

    const finding = before.find((f) => f.id === "finding-escalation-u-dev-marco")!;
    const nextRaw = applySuggestedFixToRaw(raw, finding.suggestedFix, finding.id);
    const next = parseAccountJson(nextRaw);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const after = createQueryEngine(next.data).listFindings();
    expect(
      after.some((f) => f.id === "finding-escalation-u-dev-marco"),
    ).toBe(false);
  });

  it("approves apply_fix after an NFC tap and refreshes findings", async () => {
    const raw = readFileSync(fixturePath, "utf8");
    const parsed = parseAccountJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const findings = createQueryEngine(parsed.data).listFindings();
    const finding = findings.find((f) => f.id === "finding-open-tp-tp-github-ci")!;
    expect(finding).toBeDefined();

    syncAccountFromAnalyze({
      raw,
      account_id: parsed.data.account_id,
      finding_ids: findings.map((f) => f.id),
    });

    const { request } = await createPendingRequest({
      kind: "apply_fix",
      requested_by: "analyst",
      reason: finding.title,
      dual_control: false,
      payload: {
        finding_id: finding.id,
        severity: finding.severity,
        suggestedFix: finding.suggestedFix,
      },
    });
    expect(request.status).toBe("pending");

    const outcome = await processCardTap(CARD_A_ID);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe("approved");
    expect(outcome.account?.finding_ids).not.toContain(finding.id);
  });

  it("requires two distinct cards for dual_control", async () => {
    const raw = readFileSync(fixturePath, "utf8");
    const parsed = parseAccountJson(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    syncAccountFromAnalyze({
      raw,
      account_id: parsed.data.account_id,
      finding_ids: [],
    });

    await createPendingRequest({
      kind: "apply_fix",
      requested_by: "analyst",
      reason: "critical fix",
      dual_control: true,
      payload: {
        finding_id: "finding-escalation-u-dev-marco",
        suggestedFix: {
          id: "pol-12",
          subjects: ["u-dev-marco"],
          roles: { platform: ["Viewer"], service: [] },
          resources: {
            service: "iam-groups",
            resourceGroup: null,
            instanceId: null,
          },
        },
      },
    });

    const first = await processCardTap(CARD_A_ID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.status).toBe("waiting");

    const second = await processCardTap(CARD_B_ID);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("approved");
  });

  it("creates a 15-minute grant on grant_admin approval", async () => {
    await createPendingRequest({
      kind: "grant_admin",
      requested_by: "analyst",
      reason: "break glass",
      dual_control: false,
      payload: {
        subject_id: "u-dev-marco",
        role: "Administrator",
        target: "databases-for-postgresql/production",
      },
    });

    const outcome = await processCardTap("a");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.grant?.subject_id).toBe("u-dev-marco");
    const ttl =
      new Date(outcome.grant!.expires_at).getTime() -
      new Date(outcome.grant!.granted_at).getTime();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
  });
});
