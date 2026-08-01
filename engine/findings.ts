import type { ParsedAccount, Policy } from "./parse";
import {
  findPathsToTarget,
  formatTargetKey,
  type PathStep,
  type PermissionGraph,
} from "./graph";

export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type FindingEvidence = {
  policyId: string | null;
  line_start: number;
  line_end: number;
};

export type Finding = {
  id: string;
  severity: FindingSeverity;
  title: string;
  /** One sentence, plain English. */
  explanation: string;
  evidence: FindingEvidence[];
  suggestedFix: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const AS_OF = new Date("2026-08-01T00:00:00.000Z");

function isAccountWide(policy: Policy): boolean {
  const r = policy.resources;
  return !r.service && r.resourceGroup == null && r.instanceId == null;
}

function daysSince(iso: string, now: Date): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function evidenceFromPolicy(policy: Policy): FindingEvidence {
  return {
    policyId: policy.id,
    line_start: policy.line_start,
    line_end: policy.line_end,
  };
}

function evidenceFromSteps(steps: PathStep[]): FindingEvidence[] {
  const seen = new Set<string>();
  const out: FindingEvidence[] = [];
  for (const step of steps) {
    const key = `${step.policy_id ?? "none"}:${step.line_start}:${step.line_end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      policyId: step.policy_id,
      line_start: step.line_start,
      line_end: step.line_end,
    });
  }
  return out;
}

function nameSteps(steps: PathStep[]): string {
  return steps
    .map((step, i) => `(${i + 1}) ${step.reason}`)
    .join("; ");
}

function pathIsEscalationChain(path: PathStep[]): boolean {
  return path.some((step) => {
    const r = step.reason.toLowerCase();
    return (
      r.includes("can add self") ||
      r.includes("can create service ids") ||
      r.includes("effective account-wide admin")
    );
  });
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

function privilegedPrincipals(account: ParsedAccount): Set<string> {
  const out = new Set<string>();
  for (const policy of account.policies) {
    if (
      !policy.roles.platform.includes("Administrator") &&
      !policy.roles.service.includes("Manager")
    ) {
      continue;
    }
    for (const s of policy.subjects) out.add(s);
  }
  return out;
}

function policyJson(policy: Policy): Record<string, unknown> {
  return {
    id: policy.id,
    subjects: policy.subjects,
    roles: {
      platform: [...policy.roles.platform],
      service: [...policy.roles.service],
    },
    resources: { ...policy.resources },
  };
}

/**
 * Detect every finding rule from the project spec using the permission graph.
 * Never invents findings — only emits what the account data + graph derive.
 */
export function detectFindings(
  graph: PermissionGraph,
  minSeverity?: FindingSeverity,
): Finding[] {
  const account = graph.account;
  const findings: Finding[] = [];
  const minRank = minSeverity ? SEVERITY_RANK[minSeverity] : 1;

  // -------------------------------------------------------------------------
  // CRITICAL: privilege escalation chains (iam-groups / iam-identity / etc.)
  // -------------------------------------------------------------------------
  const escalationTargets = [
    "databases-for-postgresql/production",
    "account",
  ] as const;

  for (const subject of account.subjects) {
    let best: PathStep[] | null = null;
    let bestTarget = "";

    for (const target of escalationTargets) {
      const paths = findPathsToTarget(graph, subject.id, target, {
        maxDepth: 8,
        maxPaths: 30,
      }).filter(pathIsEscalationChain);

      // Prefer paths that actually abuse self-add / mint, not already-members.
      const abusive = paths.filter((path) =>
        path.some((s) => {
          const r = s.reason.toLowerCase();
          return (
            r.includes("can add self") ||
            r.includes("can create service ids") ||
            r.includes("effective account-wide admin")
          );
        }),
      );

      // Skip if subject already has a non-escalation membership path to the
      // same target that is shorter or equal (they're a legitimate member).
      const legitimate = findPathsToTarget(graph, subject.id, target, {
        maxDepth: 6,
        maxPaths: 20,
      }).filter(
        (path) =>
          !pathIsEscalationChain(path) &&
          path.every((s) => {
            const r = s.reason.toLowerCase();
            return (
              r.startsWith("direct policy") ||
              r.startsWith("member of") ||
              r.includes("nested membership")
            );
          }),
      );

      if (abusive.length === 0) continue;
      // Still report escalation if they can self-add even when already a member
      // of some groups — but skip when a pure membership path exists AND the
      // abusive path's only "can add self" lands on a group they already belong to.
      const alreadyMemberPath = legitimate[0];
      const candidate = abusive.sort((a, b) => a.length - b.length)[0]!;

      if (alreadyMemberPath && alreadyMemberPath.length <= candidate.length) {
        const selfAdd = candidate.find((s) =>
          s.reason.toLowerCase().includes("can add self"),
        );
        if (selfAdd) {
          const groupId = selfAdd.to.replace(/^group:/, "");
          const groups = graph.subjectGroups.get(subject.id);
          if (groups?.has(groupId)) continue;
        } else if (!candidate.some((s) => s.reason.includes("can create service IDs") || s.reason.includes("effective account-wide admin"))) {
          continue;
        }
      }

      if (!best || candidate.length < best.length) {
        best = candidate;
        bestTarget = target;
      }
    }

    if (!best) continue;

    const n = best.length;
    const stepNames = nameSteps(best);
    findings.push({
      id: `finding-escalation-${subject.id}`,
      severity: "CRITICAL",
      title: `${subject.name} can escalate to privileged access in ${n} steps`,
      explanation: `${subject.name} can reach ${bestTarget} in ${n} steps: ${stepNames}.`,
      evidence: evidenceFromSteps(best),
      suggestedFix: {
        id: `remediate-${subject.id}-escalation`,
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

  // -------------------------------------------------------------------------
  // CRITICAL: trusted profile open claim rules
  // -------------------------------------------------------------------------
  for (const profile of account.trusted_profiles) {
    if (!claimRuleIsOpen(profile)) continue;
    findings.push({
      id: `finding-open-tp-${profile.id}`,
      severity: "CRITICAL",
      title: `Trusted profile ${profile.name} is an open door`,
      explanation:
        "The claim rule checks only the issuer (or uses a wildcard), so any repository on that issuer can assume this profile.",
      evidence: [
        {
          policyId: null,
          line_start: profile.line_start,
          line_end: profile.line_end,
        },
      ],
      suggestedFix: {
        id: profile.id,
        name: profile.name,
        claim_rules: [
          {
            issuer:
              profile.claim_rules[0]?.issuer ??
              "https://token.actions.githubusercontent.com",
            conditions: [
              { claim: "repo", operator: "equals", value: "acme/api" },
            ],
          },
        ],
      },
      confidence: "high",
    });
  }

  // -------------------------------------------------------------------------
  // HIGH: account-wide Administrator or Manager
  // -------------------------------------------------------------------------
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
        "This policy grants Administrator or Manager with no resource attributes, so the blast radius is the entire account.",
      evidence: [evidenceFromPolicy(policy)],
      suggestedFix: {
        ...policyJson(policy),
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

  // -------------------------------------------------------------------------
  // HIGH: service ID Administrator + API key with no expiry
  // -------------------------------------------------------------------------
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
      title: `Service ID ${subject.name} has Administrator and a non-expiring API key`,
      explanation:
        "A service ID with Administrator plus an API key that never expires is a long-lived standing credential with full privilege.",
      evidence: [evidenceFromPolicy(policy)],
      suggestedFix: {
        id: policy.id,
        subjects: [subject.id],
        roles: { platform: ["Operator"], service: ["Writer"] },
        resources: {
          service: "cloud-object-storage",
          resourceGroup: "staging",
          instanceId: null,
        },
        api_key: {
          id: keys[0]!.id,
          subject: subject.id,
          expires: "2026-12-31",
        },
      },
      confidence: "high",
    });
  }

  // -------------------------------------------------------------------------
  // HIGH: human standing Administrator with MFA disabled
  // -------------------------------------------------------------------------
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
        "A human user holds standing Administrator while mfa_enabled is false.",
      evidence: adminPolicies.map(evidenceFromPolicy),
      suggestedFix: {
        id: subject.id,
        type: "user",
        name: subject.name,
        email: subject.email,
        mfa_enabled: true,
      },
      confidence: "high",
    });
  }

  // -------------------------------------------------------------------------
  // MEDIUM: standing Administrator on production for any human user
  // -------------------------------------------------------------------------
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
          "A human user holds standing Administrator on a production resource group instead of a time-limited grant.",
        evidence: [evidenceFromPolicy(policy)],
        suggestedFix: {
          ...policyJson(policy),
          roles: { platform: ["Editor"], service: ["Writer"] },
        },
        confidence: "high",
      });
    }
  }

  // -------------------------------------------------------------------------
  // MEDIUM: API key unused > 90 days on a privileged subject
  // -------------------------------------------------------------------------
  const privileged = privilegedPrincipals(account);
  for (const key of account.api_keys) {
    if (!key.last_used) continue;
    if (daysSince(key.last_used, AS_OF) <= 90) continue;

    const directAdmin = account.policies.some(
      (p) =>
        p.subjects.includes(key.subject) &&
        (p.roles.platform.includes("Administrator") ||
          p.roles.service.includes("Manager")),
    );
    if (!privileged.has(key.subject) && !directAdmin) continue;

    const policy =
      account.policies.find(
        (p) =>
          p.subjects.includes(key.subject) &&
          (p.roles.platform.includes("Administrator") ||
            p.roles.service.includes("Manager")),
      ) ?? account.policies.find((p) => p.subjects.includes(key.subject));

    if (!policy) continue;

    const subject = account.subjects.find((s) => s.id === key.subject);
    findings.push({
      id: `finding-stale-key-${key.id}`,
      severity: "MEDIUM",
      title: `Privileged API key ${key.id} unused for over 90 days`,
      explanation: `The API key for privileged subject ${subject?.name ?? key.subject} was last used on ${key.last_used} and is still active.`,
      evidence: [evidenceFromPolicy(policy)],
      suggestedFix: {
        id: key.id,
        subject: key.subject,
        created: key.created,
        last_used: key.last_used,
        expires: "2026-08-15",
      },
      confidence: "medium",
    });
  }

  // -------------------------------------------------------------------------
  // LOW: redundant or overlapping role grants on the same target
  // -------------------------------------------------------------------------
  const buckets = new Map<string, Policy[]>();
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
      const list = buckets.get(bucketKey) ?? [];
      list.push(policy);
      buckets.set(bucketKey, list);
    }
  }
  for (const [bucketKey, policies] of buckets) {
    if (policies.length < 2) continue;
    const [principal, target] = bucketKey.split("|");
    const keep = policies[0]!;
    findings.push({
      id: `finding-redundant-${policies.map((p) => p.id).sort().join("-")}`,
      severity: "LOW",
      title: `Redundant grants for ${principal} on ${target}`,
      explanation:
        "Two or more policies grant the same principal the same roles on the same target.",
      evidence: policies.map(evidenceFromPolicy),
      suggestedFix: policyJson(keep),
      confidence: "high",
    });
  }

  // -------------------------------------------------------------------------
  // LOW: account setting allowing all users to see all other users
  // -------------------------------------------------------------------------
  const settings = (
    account as ParsedAccount & {
      account_settings?: { allow_all_users_to_see_all_users?: boolean };
    }
  ).account_settings;
  if (settings?.allow_all_users_to_see_all_users === true) {
    findings.push({
      id: "finding-users-can-see-all-users",
      severity: "LOW",
      title: "All users can see all other users",
      explanation:
        "An account setting allows every user to enumerate every other user in the account.",
      evidence: [{ policyId: null, line_start: 1, line_end: 1 }],
      suggestedFix: {
        account_settings: { allow_all_users_to_see_all_users: false },
      },
      confidence: "high",
    });
  }

  return findings
    .filter((f) => SEVERITY_RANK[f.severity] >= minRank)
    .sort((a, b) => {
      const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (rank !== 0) return rank;
      return a.id.localeCompare(b.id);
    });
}
