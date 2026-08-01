import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountJson } from "./parse";
import { buildGraph } from "./graph";
import { detectFindings, type Finding } from "./findings";

const brokenPath = resolve(__dirname, "../fixtures/acme-account.json");
const fixedPath = resolve(__dirname, "../fixtures/acme-account-fixed.json");

function loadFindings(path: string): Finding[] {
  const raw = readFileSync(path, "utf8");
  const parsed = parseAccountJson(raw);
  if (!parsed.ok) throw new Error(`parse failed for ${path}`);
  return detectFindings(buildGraph(parsed.data));
}

function plantedProblemMatchers(findings: Finding[]) {
  return {
    /** 1. Marco iam-groups → Platform → production Postgres */
    escalation: findings.find(
      (f) =>
        f.severity === "CRITICAL" &&
        f.id === "finding-escalation-u-dev-marco" &&
        /\b3 steps\b/i.test(f.explanation) &&
        /iam-groups/i.test(f.explanation) &&
        /platform/i.test(f.explanation) &&
        /databases-for-postgresql/i.test(f.explanation),
    ),
    /** 2. Open trusted profile */
    openTrustedProfile: findings.find(
      (f) =>
        f.severity === "CRITICAL" &&
        f.id === "finding-open-tp-tp-github-ci",
    ),
    /** 3. Legacy admin SI: account-wide and/or non-expiring key */
    legacyAdmin: findings.filter(
      (f) =>
        f.severity === "HIGH" &&
        (f.id === "finding-account-wide-pol-17" ||
          f.id === "finding-si-no-expiry-si-legacy-admin"),
    ),
    /** 4. Jordan without MFA */
    jordanNoMfa: findings.find(
      (f) => f.severity === "HIGH" && f.id === "finding-no-mfa-u-jordan",
    ),
    /** 5. Redundant grants */
    redundant: findings.filter(
      (f) =>
        f.severity === "LOW" &&
        f.id.startsWith("finding-redundant-") &&
        (f.id.includes("pol-08") || f.id.includes("pol-27")),
    ),
  };
}

describe("detectFindings planted problems", () => {
  it("detects all five planted problems in acme-account.json", () => {
    const findings = loadFindings(brokenPath);
    const planted = plantedProblemMatchers(findings);

    expect(planted.escalation).toBeDefined();
    expect(planted.escalation!.explanation).toMatch(/\(1\).*; \(2\).*; \(3\)/);
    expect(planted.escalation!.evidence.length).toBeGreaterThanOrEqual(2);
    expect(
      planted.escalation!.evidence.some((e) => e.policyId === "pol-12"),
    ).toBe(true);
    expect(
      planted.escalation!.evidence.some((e) => e.policyId === "pol-01"),
    ).toBe(true);

    expect(planted.openTrustedProfile).toBeDefined();
    expect(planted.legacyAdmin.length).toBeGreaterThanOrEqual(1);
    expect(planted.jordanNoMfa).toBeDefined();
    expect(planted.redundant.length).toBeGreaterThanOrEqual(1);

    // Shape checks
    for (const f of findings) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.explanation.length).toBeGreaterThan(0);
      expect(f.suggestedFix).toBeTypeOf("object");
      expect(["high", "medium", "low"]).toContain(f.confidence);
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const e of f.evidence) {
        expect(e.line_start).toBeGreaterThan(0);
        expect(e.line_end).toBeGreaterThanOrEqual(e.line_start);
      }
    }

    // CRITICAL ranked first
    expect(findings[0]?.severity).toBe("CRITICAL");
    const severities = findings.map((f) => f.severity);
    const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]!]).toBeLessThanOrEqual(rank[severities[i - 1]!]);
    }
  });

  it("does not invent findings — fixed fixture clears problems 1–4, keeps 5", () => {
    const broken = loadFindings(brokenPath);
    const fixed = loadFindings(fixedPath);

    const brokenPlanted = plantedProblemMatchers(broken);
    const fixedPlanted = plantedProblemMatchers(fixed);

    // Sanity: broken really has them
    expect(brokenPlanted.escalation).toBeDefined();
    expect(brokenPlanted.openTrustedProfile).toBeDefined();
    expect(brokenPlanted.legacyAdmin.length).toBeGreaterThan(0);
    expect(brokenPlanted.jordanNoMfa).toBeDefined();

    // Remediated in fixed file
    expect(fixedPlanted.escalation).toBeUndefined();
    expect(fixedPlanted.openTrustedProfile).toBeUndefined();
    expect(fixedPlanted.legacyAdmin).toHaveLength(0);
    expect(fixedPlanted.jordanNoMfa).toBeUndefined();

    // Problem 5 intentionally kept
    expect(fixedPlanted.redundant.length).toBeGreaterThanOrEqual(1);

    // Every finding is grounded in real policies / trusted profiles from the file
    const raw = readFileSync(brokenPath, "utf8");
    const parsed = parseAccountJson(raw);
    if (!parsed.ok) throw new Error("parse failed");
    const policyIds = new Set(parsed.data.policies.map((p) => p.id));
    const profileIds = new Set(parsed.data.trusted_profiles.map((p) => p.id));

    for (const f of broken) {
      for (const e of f.evidence) {
        if (e.policyId == null) {
          // Trusted-profile (or account-setting) evidence uses null policyId
          // but must still cite a real line range inside the file.
          const lines = raw.split("\n").length;
          expect(e.line_start).toBeLessThanOrEqual(lines);
          continue;
        }
        expect(policyIds.has(e.policyId)).toBe(true);
      }
      // No findings referencing unknown subjects in their ids for planted types
      if (f.id.startsWith("finding-open-tp-")) {
        const id = f.id.replace("finding-open-tp-", "");
        expect(profileIds.has(id)).toBe(true);
      }
    }

    // Do not invent the account-setting finding when the field is absent
    expect(
      broken.find((f) => f.id === "finding-users-can-see-all-users"),
    ).toBeUndefined();
    expect(
      fixed.find((f) => f.id === "finding-users-can-see-all-users"),
    ).toBeUndefined();
  });
});
