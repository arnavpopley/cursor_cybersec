import type { ParsedAccount, Policy } from "./parse";
import {
  buildGraph,
  findPathsToTarget,
  formatTargetKey,
  type PathStep,
  type PermissionGraph,
} from "./graph";
import {
  detectFindings,
  type Finding,
  type FindingSeverity,
} from "./findings";
import { grantMeetsMinRole } from "./roles";

export type { PathStep, Finding, FindingSeverity };

export type AccessPath = PathStep[];

export type WhoCanAccessResult = {
  subject_id: string;
  subject_name: string;
  paths: AccessPath[];
};

export type WhatCanReachResult = {
  target: string;
  paths: AccessPath[];
};

export type ExplainPolicyResult = {
  policy: Policy;
  affected_subjects: Array<{
    id: string;
    name: string;
    via_group: string | null;
  }>;
};

export type QueryEngine = {
  graph: PermissionGraph;
  whoCanAccess: (
    service: string,
    resourceGroup?: string,
    minRole?: string,
  ) => WhoCanAccessResult[];
  whatCanSubjectReach: (subjectId: string) => WhatCanReachResult[];
  pathsBetween: (subjectId: string, target: string) => AccessPath[];
  listFindings: (minSeverity?: FindingSeverity) => Finding[];
  explainPolicy: (policyId: string) => ExplainPolicyResult | null;
};

function subjectName(account: ParsedAccount, id: string): string {
  return account.subjects.find((s) => s.id === id)?.name ?? id;
}

/**
 * Create the LLM-facing query surface bound to a parsed account.
 * Pure logic — no AI.
 */
export function createQueryEngine(account: ParsedAccount): QueryEngine {
  const graph = buildGraph(account);

  function pathsBetween(subjectId: string, target: string): AccessPath[] {
    return findPathsToTarget(graph, subjectId, target);
  }

  function whoCanAccess(
    service: string,
    resourceGroup?: string,
    minRole?: string,
  ): WhoCanAccessResult[] {
    const target = formatTargetKey(service, resourceGroup ?? null);
    const results: WhoCanAccessResult[] = [];

    for (const subject of account.subjects) {
      const paths = pathsBetween(subject.id, target).filter((path) => {
        if (!minRole) return true;
        for (let i = path.length - 1; i >= 0; i--) {
          const step = path[i]!;
          if (!step.policy_id) continue;
          const policy = account.policies.find((p) => p.id === step.policy_id);
          if (!policy) continue;
          return grantMeetsMinRole(
            policy.roles.platform,
            policy.roles.service,
            minRole,
          );
        }
        return false;
      });
      if (paths.length === 0) continue;
      results.push({
        subject_id: subject.id,
        subject_name: subject.name,
        paths,
      });
    }
    return results;
  }

  function whatCanSubjectReach(subjectId: string): WhatCanReachResult[] {
    const targets = new Set<string>();
    for (const policy of account.policies) {
      const key =
        !policy.resources.service &&
        policy.resources.resourceGroup == null &&
        policy.resources.instanceId == null
          ? "account"
          : formatTargetKey(
              policy.resources.service,
              policy.resources.resourceGroup,
            );
      targets.add(key);
    }

    const results: WhatCanReachResult[] = [];
    for (const target of targets) {
      const paths = pathsBetween(subjectId, target);
      if (paths.length === 0) continue;
      results.push({ target, paths });
    }
    return results;
  }

  function listFindings(minSeverity?: FindingSeverity): Finding[] {
    return detectFindings(graph, minSeverity);
  }

  function explainPolicy(policyId: string): ExplainPolicyResult | null {
    const policy = account.policies.find((p) => p.id === policyId);
    if (!policy) return null;

    const affected: ExplainPolicyResult["affected_subjects"] = [];
    const seen = new Set<string>();

    for (const principal of policy.subjects) {
      const group = account.access_groups.find((g) => g.id === principal);
      if (!group) {
        if (!seen.has(principal)) {
          seen.add(principal);
          affected.push({
            id: principal,
            name: subjectName(account, principal),
            via_group: null,
          });
        }
        continue;
      }
      for (const [sid, groups] of graph.subjectGroups) {
        if (!groups.has(group.id)) continue;
        if (seen.has(sid)) continue;
        seen.add(sid);
        affected.push({
          id: sid,
          name: subjectName(account, sid),
          via_group: group.id,
        });
      }
    }

    return { policy, affected_subjects: affected };
  }

  return {
    graph,
    whoCanAccess,
    whatCanSubjectReach,
    pathsBetween,
    listFindings,
    explainPolicy,
  };
}

/** Standalone helpers matching the spec's fixed signatures (graph-first). */
export function whoCanAccess(
  graph: PermissionGraph,
  service: string,
  resourceGroup?: string,
  minRole?: string,
): WhoCanAccessResult[] {
  return createQueryEngine(graph.account).whoCanAccess(
    service,
    resourceGroup,
    minRole,
  );
}

export function whatCanSubjectReach(
  graph: PermissionGraph,
  subjectId: string,
): WhatCanReachResult[] {
  return createQueryEngine(graph.account).whatCanSubjectReach(subjectId);
}

export function pathsBetween(
  graph: PermissionGraph,
  subjectId: string,
  target: string,
): AccessPath[] {
  return findPathsToTarget(graph, subjectId, target);
}

export function listFindings(
  graph: PermissionGraph,
  minSeverity?: FindingSeverity,
): Finding[] {
  return detectFindings(graph, minSeverity);
}

export function explainPolicy(
  graph: PermissionGraph,
  policyId: string,
): ExplainPolicyResult | null {
  return createQueryEngine(graph.account).explainPolicy(policyId);
}
