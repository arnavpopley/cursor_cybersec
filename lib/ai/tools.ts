import type { AskModelTool } from "./client";
import type { QueryEngine } from "@/engine/queries";
import type { FindingSeverity } from "@/engine/findings";

/**
 * The five engine queries as OpenAI function-calling tools.
 * Strict schemas: every property is required; optionals are nullable.
 */
export const ENGINE_TOOLS: AskModelTool[] = [
  {
    type: "function",
    function: {
      name: "whoCanAccess",
      description:
        "List subjects who can access a cloud service, optionally narrowed by resource group and minimum role. Returns subjects and access paths with line citations.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description:
              "Service name, e.g. databases-for-postgresql or cloud-object-storage",
          },
          resourceGroup: {
            type: ["string", "null"],
            description: "Resource group such as production or staging, or null",
          },
          minRole: {
            type: ["string", "null"],
            description:
              "Optional role name filter (Viewer, Operator, Editor, Administrator, Reader, Writer, Manager), or null",
          },
        },
        required: ["service", "resourceGroup", "minRole"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "whatCanSubjectReach",
      description:
        "List every target a subject can reach, with ordered access paths and evidence.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          subjectId: {
            type: "string",
            description: "Subject id such as u-dev-marco or si-deployer",
          },
        },
        required: ["subjectId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pathsBetween",
      description:
        "Ordered access paths from a subject to a target key like service/resourceGroup (e.g. databases-for-postgresql/production).",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          subjectId: {
            type: "string",
            description: "Subject id such as u-dev-marco",
          },
          target: {
            type: "string",
            description:
              "Target key as service/resourceGroup, or account for account-wide admin",
          },
        },
        required: ["subjectId", "target"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listFindings",
      description:
        "List misconfiguration findings derived by the engine, optionally filtered by minimum severity.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          minSeverity: {
            type: ["string", "null"],
            description: "CRITICAL | HIGH | MEDIUM | LOW, or null for all",
          },
        },
        required: ["minSeverity"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explainPolicy",
      description:
        "Explain a policy by id and list the subjects it affects (including via access groups).",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          policyId: {
            type: "string",
            description: "Policy id such as pol-12",
          },
        },
        required: ["policyId"],
        additionalProperties: false,
      },
    },
  },
];

export type EngineToolName =
  | "whoCanAccess"
  | "whatCanSubjectReach"
  | "pathsBetween"
  | "listFindings"
  | "explainPolicy";

export type EngineCall = {
  name: EngineToolName | string;
  args: Record<string, unknown>;
  result: unknown;
};

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

export function runEngineTool(
  engine: QueryEngine,
  name: string,
  args: Record<string, unknown>,
): unknown {
  switch (name) {
    case "whoCanAccess":
      return engine.whoCanAccess(
        String(args.service ?? ""),
        nullToUndefined(
          args.resourceGroup == null ? null : String(args.resourceGroup),
        ),
        nullToUndefined(args.minRole == null ? null : String(args.minRole)),
      );
    case "whatCanSubjectReach":
      return engine.whatCanSubjectReach(String(args.subjectId ?? ""));
    case "pathsBetween":
      return engine.pathsBetween(
        String(args.subjectId ?? ""),
        String(args.target ?? ""),
      );
    case "listFindings":
      return engine.listFindings(
        nullToUndefined(
          args.minSeverity == null
            ? null
            : (String(args.minSeverity) as FindingSeverity),
        ),
      );
    case "explainPolicy":
      return engine.explainPolicy(String(args.policyId ?? ""));
    default:
      return { error: `Unknown engine function: ${name}` };
  }
}

/**
 * Deterministic tool selection when the model is unavailable.
 * Still only selects among the five engine query functions.
 */
export function routeQuestionToTool(question: string): {
  name: EngineToolName;
  args: Record<string, unknown>;
} {
  const q = question.toLowerCase();

  const policyMatch = q.match(/\b(pol-\d+)\b/i);
  if (policyMatch && (q.includes("explain") || q.includes("what does"))) {
    return {
      name: "explainPolicy",
      args: { policyId: policyMatch[1]!.toLowerCase() },
    };
  }

  if (q.includes("finding") || q.includes("misconfig") || q.includes("risk")) {
    return { name: "listFindings", args: { minSeverity: null } };
  }

  const subjectMatch =
    q.match(/\b(u-[\w-]+|si-[\w-]+|tp-[\w-]+)\b/i) ??
    (q.includes("marco")
      ? ["u-dev-marco", "u-dev-marco"]
      : q.includes("jordan")
        ? ["u-jordan", "u-jordan"]
        : q.includes("priya")
          ? ["u-priya", "u-priya"]
          : null);

  const serviceMatch = q.match(
    /\b(databases-for-postgresql|cloud-object-storage|cloudantnosqldb|containers-kubernetes|iam-groups|iam-identity)\b/i,
  );
  const rgMatch = q.match(/\b(production|staging)\b/i);

  if (
    subjectMatch &&
    (q.includes("path") ||
      q.includes("reach") ||
      q.includes("escalat") ||
      q.includes("how can") ||
      q.includes("get to"))
  ) {
    const subjectId = subjectMatch[1]!;
    const service = serviceMatch?.[1] ?? "databases-for-postgresql";
    const rg = rgMatch?.[1] ?? "production";
    return {
      name: "pathsBetween",
      args: { subjectId, target: `${service}/${rg}` },
    };
  }

  if (subjectMatch && (q.includes("what can") || q.includes("access does"))) {
    return {
      name: "whatCanSubjectReach",
      args: { subjectId: subjectMatch[1]! },
    };
  }

  if (serviceMatch || q.includes("who can")) {
    return {
      name: "whoCanAccess",
      args: {
        service: serviceMatch?.[1] ?? "databases-for-postgresql",
        resourceGroup: rgMatch?.[1] ?? null,
        minRole: null,
      },
    };
  }

  if (subjectMatch) {
    return {
      name: "whatCanSubjectReach",
      args: { subjectId: subjectMatch[1]! },
    };
  }

  return { name: "listFindings", args: { minSeverity: "HIGH" } };
}

export function routeQuestionToEngine(
  question: string,
  engine: QueryEngine,
): EngineCall {
  const { name, args } = routeQuestionToTool(question);
  return { name, args, result: runEngineTool(engine, name, args) };
}
