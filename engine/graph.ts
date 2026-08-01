import type {
  AccessGroup,
  LineRange,
  ParsedAccount,
  Policy,
  Subject,
} from "./parse";
import type { PlatformRole, ServiceRole } from "./schema";
import { unionPlatformActions, unionServiceActions } from "./roles";

export type NodeKind = "subject" | "group" | "target" | "capability" | "account_admin";

export type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  ref_id?: string;
};

export type EdgeKind = "member_of" | "grant" | "escalation";

export type GraphEdge = {
  from: string;
  to: string;
  kind: EdgeKind;
  reason: string;
  policy_id: string | null;
  line_start: number;
  line_end: number;
  platform_roles: PlatformRole[];
  service_roles: ServiceRole[];
  platform_actions: string[];
  service_actions: string[];
};

export type PermissionGraph = {
  account: ParsedAccount;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** subject id -> transitive group ids */
  subjectGroups: Map<string, Set<string>>;
};

export function subjectNodeId(id: string): string {
  return `subject:${id}`;
}

export function groupNodeId(id: string): string {
  return `group:${id}`;
}

export function targetNodeId(service: string, resourceGroup: string): string {
  return `target:${service}/${resourceGroup}`;
}

export function accountAdminNodeId(): string {
  return "account_admin";
}

export function capabilityNodeId(subjectId: string, kind: string): string {
  return `capability:${subjectId}:${kind}`;
}

export function formatTargetKey(
  service?: string | null,
  resourceGroup?: string | null,
): string {
  if (!service) return "account";
  return `${service}/${resourceGroup ?? "*"}`;
}

export function parseTargetKey(target: string): {
  service: string;
  resourceGroup: string;
} {
  if (target === "account" || target === "*/*") {
    return { service: "*", resourceGroup: "*" };
  }
  const slash = target.indexOf("/");
  if (slash === -1) {
    return { service: target, resourceGroup: "*" };
  }
  return {
    service: target.slice(0, slash),
    resourceGroup: target.slice(slash + 1) || "*",
  };
}

function policyLineRange(policy: Policy): LineRange {
  return { line_start: policy.line_start, line_end: policy.line_end };
}

function isAccountWide(policy: Policy): boolean {
  const r = policy.resources;
  return !r.service && r.resourceGroup == null && r.instanceId == null;
}

function isAllAccountManagement(service: string | undefined): boolean {
  if (!service) return false;
  const normalized = service.toLowerCase().replace(/[_-]/g, " ");
  return (
    normalized === "all account management services" ||
    normalized === "all account management"
  );
}

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function edgeFromPolicy(
  from: string,
  to: string,
  kind: EdgeKind,
  reason: string,
  policy: Policy,
): GraphEdge {
  const platform_roles = policy.roles.platform;
  const service_roles = policy.roles.service;
  return {
    from,
    to,
    kind,
    reason,
    policy_id: policy.id,
    ...policyLineRange(policy),
    platform_roles,
    service_roles,
    platform_actions: unionPlatformActions(platform_roles),
    service_actions: unionServiceActions(service_roles),
  };
}

function membershipEdge(
  from: string,
  to: string,
  reason: string,
  group: AccessGroup,
): GraphEdge {
  return {
    from,
    to,
    kind: "member_of",
    reason,
    policy_id: null,
    line_start: group.line_start,
    line_end: group.line_end,
    platform_roles: [],
    service_roles: [],
    platform_actions: [],
    service_actions: [],
  };
}

/** Expand nested access-group membership into subject -> group sets. */
function resolveSubjectGroups(
  account: ParsedAccount,
): Map<string, Set<string>> {
  const groupById = new Map(
    account.access_groups.map((g) => [g.id, g] as const),
  );
  const childGroups = new Map<string, string[]>();
  for (const group of account.access_groups) {
    for (const member of group.members) {
      if (groupById.has(member)) {
        const list = childGroups.get(group.id) ?? [];
        list.push(member);
        childGroups.set(group.id, list);
      }
    }
  }

  function collectNestedGroupIds(groupId: string, seen = new Set<string>()): Set<string> {
    if (seen.has(groupId)) return new Set();
    seen.add(groupId);
    const out = new Set<string>([groupId]);
    for (const child of childGroups.get(groupId) ?? []) {
      for (const id of collectNestedGroupIds(child, seen)) out.add(id);
    }
    return out;
  }

  // parent -> all descendant group ids including self (groups nested under parent)
  // Actually: if Engineering contains Contractors, members of Contractors are in Engineering.
  // So for subject S in G, S is also in every ancestor of G.
  const parentOf = new Map<string, string[]>();
  for (const [parent, children] of childGroups) {
    for (const child of children) {
      const parents = parentOf.get(child) ?? [];
      parents.push(parent);
      parentOf.set(child, parents);
    }
  }

  function ancestors(groupId: string, seen = new Set<string>()): Set<string> {
    if (seen.has(groupId)) return new Set();
    seen.add(groupId);
    const out = new Set<string>([groupId]);
    for (const parent of parentOf.get(groupId) ?? []) {
      for (const id of ancestors(parent, seen)) out.add(id);
    }
    return out;
  }

  const subjectGroups = new Map<string, Set<string>>();
  function addSubjectGroup(subjectId: string, groupId: string) {
    const set = subjectGroups.get(subjectId) ?? new Set<string>();
    for (const id of ancestors(groupId)) set.add(id);
    subjectGroups.set(subjectId, set);
  }

  for (const group of account.access_groups) {
    for (const member of group.members) {
      if (groupById.has(member)) continue; // nested group, not a subject
      addSubjectGroup(member, group.id);
    }
  }

  return subjectGroups;
}

function subjectLabel(subject: Subject): string {
  return subject.name || subject.id;
}

/**
 * Build the permission graph: subjects, groups, targets, membership,
 * direct grants, and escalation edges (via capability nodes).
 */
export function buildGraph(account: ParsedAccount): PermissionGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const subjectGroups = resolveSubjectGroups(account);
  const groupById = new Map(
    account.access_groups.map((g) => [g.id, g] as const),
  );

  addNode(nodes, {
    id: accountAdminNodeId(),
    kind: "account_admin",
    label: "Account-wide admin",
  });

  for (const subject of account.subjects) {
    addNode(nodes, {
      id: subjectNodeId(subject.id),
      kind: "subject",
      label: subjectLabel(subject),
      ref_id: subject.id,
    });
  }

  for (const group of account.access_groups) {
    addNode(nodes, {
      id: groupNodeId(group.id),
      kind: "group",
      label: group.name,
      ref_id: group.id,
    });
  }

  // Nested group membership edges (child group -> parent group)
  for (const group of account.access_groups) {
    for (const member of group.members) {
      const child = groupById.get(member);
      if (child) {
        edges.push(
          membershipEdge(
            groupNodeId(child.id),
            groupNodeId(group.id),
            `access group ${child.name} is nested under ${group.name}`,
            group,
          ),
        );
      }
    }
  }

  // Subject membership edges (direct + nested ancestors already in subjectGroups)
  for (const [subjectId, groups] of subjectGroups) {
    for (const groupId of groups) {
      const group = groupById.get(groupId);
      if (!group) continue;
      const direct = group.members.includes(subjectId);
      edges.push(
        membershipEdge(
          subjectNodeId(subjectId),
          groupNodeId(groupId),
          direct
            ? `member of access group ${group.name}`
            : `member of access group ${group.name} via nested membership`,
          group,
        ),
      );
    }
  }

  // Policy grant edges from subjects and groups to targets
  for (const policy of account.policies) {
    const platform = policy.roles.platform;
    const service = policy.roles.service;
    const targetKey = isAccountWide(policy)
      ? "account"
      : formatTargetKey(
          policy.resources.service,
          policy.resources.resourceGroup,
        );

    const targetId =
      targetKey === "account"
        ? accountAdminNodeId()
        : `target:${targetKey}`;

    if (targetKey !== "account") {
      addNode(nodes, {
        id: targetId,
        kind: "target",
        label: targetKey,
        ref_id: targetKey,
      });
    }

    const roleSummary = [
      ...platform.map((r) => `platform ${r}`),
      ...service.map((r) => `service ${r}`),
    ].join(", ");

    for (const principal of policy.subjects) {
      const from = groupById.has(principal)
        ? groupNodeId(principal)
        : subjectNodeId(principal);
      if (groupById.has(principal)) {
        addNode(nodes, {
          id: from,
          kind: "group",
          label: groupById.get(principal)!.name,
          ref_id: principal,
        });
      } else {
        addNode(nodes, {
          id: from,
          kind: "subject",
          label: principal,
          ref_id: principal,
        });
      }

      edges.push(
        edgeFromPolicy(
          from,
          targetId,
          "grant",
          `direct policy (${roleSummary}) on ${targetKey}`,
          policy,
        ),
      );
    }

    // Escalation edges from iam-groups Editor/Administrator
    const svc = policy.resources.service;
    const hasIamGroupsEscalation =
      svc === "iam-groups" &&
      (platform.includes("Editor") || platform.includes("Administrator"));
    const hasIamIdentityEscalation =
      svc === "iam-identity" && platform.includes("Administrator");
    const hasAccountMgmtEscalation =
      isAllAccountManagement(svc) && platform.includes("Administrator");
    const hasAccountWideAdminEscalation =
      isAccountWide(policy) &&
      (platform.includes("Administrator") || service.includes("Manager"));

    for (const principal of policy.subjects) {
      // Only escalate from concrete subjects; group principals escalate for members at query time via grants.
      // For group subjects on iam-groups, each member effectively gets the escalation — expand to members.
      const principals: string[] = groupById.has(principal)
        ? [...subjectGroups.entries()]
            .filter(([, groups]) => groups.has(principal))
            .map(([id]) => id)
        : [principal];

      for (const subjectId of principals) {
        const from = subjectNodeId(subjectId);

        if (hasIamGroupsEscalation) {
          const capId = capabilityNodeId(subjectId, "iam-groups-editor");
          addNode(nodes, {
            id: capId,
            kind: "capability",
            label: `${subjectId} can edit IAM access groups`,
            ref_id: subjectId,
          });
          edges.push(
            edgeFromPolicy(
              from,
              capId,
              "grant",
              platform.includes("Administrator")
                ? "Administrator on iam-groups (can add self to any group)"
                : "Editor on iam-groups (can add self to any group)",
              policy,
            ),
          );
          for (const group of account.access_groups) {
            edges.push(
              edgeFromPolicy(
                capId,
                groupNodeId(group.id),
                "escalation",
                `can add self to access group ${group.name}`,
                policy,
              ),
            );
          }
        }

        if (hasIamIdentityEscalation) {
          const capId = capabilityNodeId(subjectId, "iam-identity-admin");
          addNode(nodes, {
            id: capId,
            kind: "capability",
            label: `${subjectId} can mint service IDs`,
            ref_id: subjectId,
          });
          edges.push(
            edgeFromPolicy(
              from,
              capId,
              "grant",
              "Administrator on iam-identity (can create service IDs)",
              policy,
            ),
          );
          edges.push(
            edgeFromPolicy(
              capId,
              accountAdminNodeId(),
              "escalation",
              "can create service IDs and grant them anything",
              policy,
            ),
          );
        }

        if (hasAccountMgmtEscalation || hasAccountWideAdminEscalation) {
          const capId = capabilityNodeId(subjectId, "account-admin");
          addNode(nodes, {
            id: capId,
            kind: "capability",
            label: `${subjectId} account admin capability`,
            ref_id: subjectId,
          });
          const reason = hasAccountMgmtEscalation
            ? "Administrator on All Account Management Services"
            : "Administrator/Manager with no resource attributes (account-wide)";
          edges.push(
            edgeFromPolicy(from, capId, "grant", reason, policy),
          );
          edges.push(
            edgeFromPolicy(
              capId,
              accountAdminNodeId(),
              "escalation",
              "effective account-wide admin",
              policy,
            ),
          );
        }
      }
    }
  }

  return { account, nodes, edges, subjectGroups };
}

export function outgoing(graph: PermissionGraph, from: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === from);
}

export type PathStep = {
  reason: string;
  policy_id: string | null;
  line_start: number;
  line_end: number;
  from: string;
  to: string;
};

function edgeToStep(edge: GraphEdge): PathStep {
  return {
    reason: edge.reason,
    policy_id: edge.policy_id,
    line_start: edge.line_start,
    line_end: edge.line_end,
    from: edge.from,
    to: edge.to,
  };
}

function goalNodesForTarget(graph: PermissionGraph, target: string): Set<string> {
  const goals = new Set<string>();
  if (target === "account" || target === "*/*") {
    goals.add(accountAdminNodeId());
    return goals;
  }
  const parsed = parseTargetKey(target);
  goals.add(targetNodeId(parsed.service, parsed.resourceGroup));
  // Account-wide admin can reach any target.
  goals.add(accountAdminNodeId());
  // Also accept wildcard resource group matches for the same service.
  if (parsed.resourceGroup !== "*") {
    const wildcard = targetNodeId(parsed.service, "*");
    if (graph.nodes.has(wildcard)) goals.add(wildcard);
  }
  return goals;
}

/**
 * Find ordered access paths from a subject to a target key
 * (e.g. "databases-for-postgresql/production").
 */
export function findPathsToTarget(
  graph: PermissionGraph,
  subjectId: string,
  target: string,
  options?: { maxDepth?: number; maxPaths?: number },
): PathStep[][] {
  const maxDepth = options?.maxDepth ?? 8;
  const maxPaths = options?.maxPaths ?? 20;
  const start = subjectNodeId(subjectId);
  if (!graph.nodes.has(start)) return [];

  const goals = goalNodesForTarget(graph, target);
  const paths: PathStep[][] = [];

  type Frame = { node: string; path: GraphEdge[]; visited: Set<string> };
  const stack: Frame[] = [{ node: start, path: [], visited: new Set([start]) }];

  while (stack.length > 0 && paths.length < maxPaths) {
    const frame = stack.pop()!;
    if (frame.path.length > 0 && goals.has(frame.node)) {
      // Reaching account_admin only counts for a concrete resource target
      // when the last edge was an escalation/admin grant — still valid.
      if (
        frame.node === accountAdminNodeId() &&
        target !== "account" &&
        target !== "*/*"
      ) {
        // Synthetic: account admin implies the requested target.
        const steps = frame.path.map(edgeToStep);
        steps.push({
          reason: `account-wide admin implies access to ${target}`,
          policy_id: frame.path[frame.path.length - 1]?.policy_id ?? null,
          line_start: frame.path[frame.path.length - 1]?.line_start ?? 1,
          line_end: frame.path[frame.path.length - 1]?.line_end ?? 1,
          from: accountAdminNodeId(),
          to: `target:${target}`,
        });
        paths.push(steps);
      } else {
        paths.push(frame.path.map(edgeToStep));
      }
      continue;
    }
    if (frame.path.length >= maxDepth) continue;

    for (const edge of outgoing(graph, frame.node)) {
      if (frame.visited.has(edge.to)) continue;
      // Prefer escalation / grant routes; membership is allowed.
      const nextVisited = new Set(frame.visited);
      nextVisited.add(edge.to);
      stack.push({
        node: edge.to,
        path: [...frame.path, edge],
        visited: nextVisited,
      });
    }
  }

  // Prefer shorter paths first.
  paths.sort((a, b) => a.length - b.length);
  return paths;
}
