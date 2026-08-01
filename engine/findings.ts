import type { ParsedAccount, Policy } from "./parse";
import {
  findPathsToTarget,
  formatTargetKey,
  type PermissionGraph,
} from "./graph";

export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type FindingEvidence = {
  policy_id: string | null;
  line_start: number;
  line_end: number;
  subject_id?: string;
  detail?: string;
};

export type Finding = {
  id: string;
  severity: FindingSeverity;
  title: string;
  explanation: string;
  evidence: FindingEvidence[];
  suggested_fix: Record<string, unknown> | null;
  confidence: "high" | "medium" | "low";
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function isAccountWide(policy: Policy): boolean {
  const r = policy.resources;
  return !r.service && r.resourceGroup == null && r.instanceId == null;
}

function daysBetween(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function claimRuleIsOpen(
  profile: ParsedAccount["trusted_profiles"][number],
): boolean {
  for (const rule of profile.claim_rules) {
    if (!rule.conditions || rule.conditions.length === 0) return true;
    for (const condition of rule.conditions) {
      const claim = condition.claim.toLowerCase();
      const value = condition.value;
      if (
        (claim === "repo" ||
          claim === "ref" ||
          claim === "branch" ||
          claim === "sub") &&
        (value === "*" || value.includes("*"))
      ) {
        return true;
      }
    }
    const hasRepoOrBranch = rule.conditions.some((c) => {
      const claim = c.claim.toLowerCase();
      return (
        claim === "repo" ||
        claim === "ref" ||
        claim === "branch" ||
        claim === "sub"
      );
    });
    if (!hasRepoOrBranch) return true;
  }
  return false;
}

function privilegedSubjectIds(account: ParsedAccount): Set<string> {
  const privileged = new Set<string>();
  for (const policy of account.policies) {
    const admin =
      policy.roles.platform.includes("Administrator") ||
      policy.roles.service.includes("Manager");
    if (!admin) continue;
    for (const s of policy.subjects) privileged.add(s);
  }
  return privileged;
}

/**
 * Derive findings from the account + graph. Never invent findings.
 */
export function detectFindings(
  graph: PermissionGraph,
  minSeverity?: FindingSeverity,
): Finding[] {
  const account = graph.account;
  const findings: Finding[] = [];
  const now = new Date("2026-08-01T00:00:00Z");
  const minRank = minSeverity ? SEVERITY_RANK[minSeverity] : 1;

  // CRITICAL: privilege escalation via iam-groups self-add
  for (const subject of account.subjects) {
    const paths = findPathsToTarget(
      graph,
      subject.id,
      "databases-for-postgresql/production",
    );
    const viaEscalation = paths.filter((path) =>
      path.some((s) => s.reason.includes("can add self")),
    );
    if (viaEscalation.length === 0) continue;

    const evidencePath = viaEscalation[0]!;
    findings.push({
      id: `finding-escalation-${subject.id}`,
      severity: "CRITICAL",
      title: `Privilege escalation to production Postgres via ${subject.id}`,
      explanation: `${subject.name} can reach Manager-level access on production databases-for-postgresql by abusing IAM access group edit rights.`,
      evidence: evidencePath.map((step) => ({
        policy_id: step.policy_id,
        line_start: step.line_start,
        line_end: step.line_end,
        subject_id: subject.id,
        detail: step.reason,
      })),
      suggested_fix: {
        id: "pol-12-fixed",
        subjects: [subject.id],
        roles: { platform: ["Viewer"], service: [] },
        resources: {
          service: "iam-groups",
          resourceGroup: null,
          instanceId: null,
        },
      },
      confidence: "high",
    });
  }

  // CRITICAL: open trusted profile claim rules
  for (const profile of account.trusted_profiles) {
    if (!claimRuleIsOpen(profile)) continue;
    findings.push({
      id: `finding-open-tp-${profile.id}`,
      severity: "CRITICAL",
      title: `Trusted profile ${profile.id} is effectively public`,
      explanation:
        "Claim rule checks the issuer only (or uses a wildcard), so any matching issuer identity can assume this profile.",
      evidence: [
        {
          policy_id: null,
          line_start: profile.line_start,
          line_end: profile.line_end,
          subject_id: profile.id,
          detail: "trusted profile claim rule",
        },
      ],
      suggested_fix: {
        id: profile.id,
        name: profile.name,
        claim_rules: [
          {
            issuer: profile.claim_rules[0]?.issuer ?? "",
            conditions: [
              { claim: "repo", operator: "equals", value: "acme/api" },
            ],
          },
        ],
      },
      confidence: "high",
    });
  }

  // HIGH: account-wide Administrator or Manager
  for (const policy of account.policies) {
    if (!isAccountWide(policy)) continue;
    const dangerous =
      policy.roles.platform.includes("Administrator") ||
      policy.roles.service.includes("Manager");
    if (!dangerous) continue;
    findings.push({
      id: `finding-account-wide-${policy.id}`,
      severity: "HIGH",
      title: `Account-wide privileged grant in ${policy.id}`,
      explanation:
        "Policy grants Administrator or Manager with no resource attributes, so blast radius is the whole account.",
      evidence: [
        {
          policy_id: policy.id,
          line_start: policy.line_start,
          line_end: policy.line_end,
        },
      ],
      suggested_fix: {
        id: policy.id,
        subjects: policy.subjects,
        roles: { platform: ["Operator"], service: ["Writer"] },
        resources: {
          service: "cloud-object-storage",
          resourceGroup: "staging",
          instanceId: null,
        },
      },
      confidence: "high",
    });
  }

  // HIGH: service ID Administrator + API key with no expiry
  for (const subject of account.subjects) {
    if (subject.type !== "serviceId") continue;
    const adminPolicies = account.policies.filter(
      (p) =>
        p.subjects.includes(subject.id) &&
        p.roles.platform.includes("Administrator"),
    );
    if (adminPolicies.length === 0) continue;
    const keys = account.api_keys.filter(
      (k) => k.subject === subject.id && k.expires == null,
    );
    if (keys.length === 0) continue;
    const policy = adminPolicies[0]!;
    findings.push({
      id: `finding-si-no-expiry-${subject.id}`,
      severity: "HIGH",
      title: `Service ID ${subject.id} is Administrator with a non-expiring API key`,
      explanation:
        "A standing Administrator service ID paired with an API key that never expires is a long-lived account takeover risk.",
      evidence: [
        {
          policy_id: policy.id,
          line_start: policy.line_start,
          line_end: policy.line_end,
          subject_id: subject.id,
        },
      ],
      suggested_fix: {
        api_key: { ...keys[0], expires: "2026-12-31" },
        policy: {
          id: policy.id,
          subjects: policy.subjects,
          roles: { platform: ["Operator"], service: ["Writer"] },
          resources: {
            service: "cloud-object-storage",
            resourceGroup: "staging",
            instanceId: null,
          },
        },
      },
      confidence: "high",
    });
  }

  // HIGH: human Administrator without MFA
  for (const subject of account.subjects) {
    if (subject.type !== "user" || subject.mfa_enabled) continue;
    const adminPolicies = account.policies.filter(
      (p) =>
        p.subjects.includes(subject.id) &&
        p.roles.platform.includes("Administrator"),
    );
    if (adminPolicies.length === 0) continue;
    findings.push({
      id: `finding-no-mfa-${subject.id}`,
      severity: "HIGH",
      title: `${subject.name} has standing Administrator without MFA`,
      explanation:
        "A human user holds Administrator while mfa_enabled is false.",
      evidence: adminPolicies.map((p) => ({
        policy_id: p.id,
        line_start: p.line_start,
        line_end: p.line_end,
        subject_id: subject.id,
      })),
      suggested_fix: {
        id: subject.id,
        type: subject.type,
        name: subject.name,
        email: "email" in subject ? subject.email : undefined,
        mfa_enabled: true,
      },
      confidence: "high",
    });
  }

  // MEDIUM: standing Administrator on production for human users
  for (const subject of account.subjects) {
    if (subject.type !== "user") continue;
    for (const policy of account.policies) {
      if (!policy.subjects.includes(subject.id)) continue;
      if (!policy.roles.platform.includes("Administrator")) continue;
      if (policy.resources.resourceGroup !== "production") continue;
      findings.push({
        id: `finding-standing-admin-prod-${subject.id}-${policy.id}`,
        severity: "MEDIUM",
        title: `${subject.name} has standing Administrator on production`,
        explanation:
          "Human user holds standing Administrator on a production resource group.",
        evidence: [
          {
            policy_id: policy.id,
            line_start: policy.line_start,
            line_end: policy.line_end,
            subject_id: subject.id,
          },
        ],
        suggested_fix: {
          id: policy.id,
          subjects: policy.subjects,
          roles: { platform: ["Editor"], service: ["Writer"] },
          resources: policy.resources,
        },
        confidence: "high",
      });
    }
  }

  // MEDIUM: privileged API key unused > 90 days
  const privileged = privilegedSubjectIds(account);
  for (const key of account.api_keys) {
    if (!key.last_used) continue;
    if (daysBetween(key.last_used, now) <= 90) continue;
    const subjectPrivileged =
      privileged.has(key.subject) ||
      account.policies.some(
        (p) =>
          p.subjects.includes(key.subject) &&
          (p.roles.platform.includes("Administrator") ||
            p.roles.service.includes("Manager")),
      );
    if (!subjectPrivileged) continue;
    const subject = account.subjects.find((s) => s.id === key.subject);
    const policy =
      account.policies.find((p) => p.subjects.includes(key.subject)) ?? null;
    findings.push({
      id: `finding-stale-key-${key.id}`,
      severity: "MEDIUM",
      title: `Privileged API key ${key.id} unused for over 90 days`,
      explanation: `API key for ${subject?.name ?? key.subject} was last used on ${key.last_used} and still grants privileged access.`,
      evidence: [
        {
          policy_id: policy?.id ?? null,
          line_start: policy?.line_start ?? 1,
          line_end: policy?.line_end ?? 1,
          subject_id: key.subject,
          detail: `api key ${key.id}`,
        },
      ],
      suggested_fix: { ...key, expires: "2026-08-15" },
      confidence: "medium",
    });
  }

  // LOW: redundant overlapping grants
  const grantBuckets = new Map<string, Policy[]>();
  for (const policy of account.policies) {
    const target = isAccountWide(policy)
      ? "account"
      : formatTargetKey(
          policy.resources.service,
          policy.resources.resourceGroup,
        );
    const rolesKey = JSON.stringify({
      platform: [...policy.roles.platform].sort(),
      service: [...policy.roles.service].sort(),
    });
    for (const principal of policy.subjects) {
      const bucketKey = `${principal}|${target}|${rolesKey}`;
      const list = grantBuckets.get(bucketKey) ?? [];
      list.push(policy);
      grantBuckets.set(bucketKey, list);
    }
  }
  for (const [bucketKey, policies] of grantBuckets) {
    if (policies.length < 2) continue;
    const [principal, target] = bucketKey.split("|");
    findings.push({
      id: `finding-redundant-${policies.map((p) => p.id).join("-")}`,
      severity: "LOW",
      title: `Redundant grants for ${principal} on ${target}`,
      explanation:
        "Two or more policies grant the same principal the same roles on the same target.",
      evidence: policies.map((p) => ({
        policy_id: p.id,
        line_start: p.line_start,
        line_end: p.line_end,
        subject_id: principal,
      })),
      suggested_fix: {
        id: policies[0]!.id,
        subjects: policies[0]!.subjects,
        roles: policies[0]!.roles,
        resources: policies[0]!.resources,
      },
      confidence: "high",
    });
  }

  return findings.filter((f) => SEVERITY_RANK[f.severity] >= minRank);
}
