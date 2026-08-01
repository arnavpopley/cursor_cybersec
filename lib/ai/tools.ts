import type { AskModelTool } from "./client";
import type { QueryEngine } from "@/engine/queries";
import type { FindingSeverity } from "@/engine/findings";

export const ENGINE_TOOLS: AskModelTool[] = [
  {
    type: "function",
    function: {
      name: "whoCanAccess",
      description:
        "List subjects who can access a service (optional resource group and min role).",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          resourceGroup: { type: "string" },
          minRole: { type: "string" },
        },
        required: ["service"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "whatCanSubjectReach",
      description: "List targets a subject can reach, with access paths.",
      parameters: {
        type: "object",
        properties: {
          subjectId: { type: "string" },
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
        "Ordered access paths from a subject to a target like service/resourceGroup.",
      parameters: {
        type: "object",
        properties: {
          subjectId: { type: "string" },
          target: { type: "string" },
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
      description: "List misconfiguration findings, optionally filtered by severity.",
      parameters: {
        type: "object",
        properties: {
          minSeverity: {
            type: "string",
            enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "explainPolicy",
      description: "Explain a policy and which subjects it affects.",
      parameters: {
        type: "object",
        properties: {
          policyId: { type: "string" },
        },
        required: ["policyId"],
        additionalProperties: false,
      },
    },
  },
];

export type EngineCall = {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
};

export function runEngineTool(
  engine: QueryEngine,
  name: string,
  args: Record<string, unknown>,
): unknown {
  switch (name) {
    case "whoCanAccess":
      return engine.whoCanAccess(
        String(args.service ?? ""),
        args.resourceGroup ? String(args.resourceGroup) : undefined,
        args.minRole ? String(args.minRole) : undefined,
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
        args.minSeverity as FindingSeverity | undefined,
      );
    case "explainPolicy":
      return engine.explainPolicy(String(args.policyId ?? ""));
    default:
      return { error: `Unknown engine function: ${name}` };
  }
}

/**
 * Deterministic fallback when OpenAI is unavailable.
 * Still only calls engine query functions — never invents permissions.
 */
export function routeQuestionToEngine(
  question: string,
  engine: QueryEngine,
): EngineCall {
  const q = question.toLowerCase();

  const policyMatch = q.match(/\b(pol-\d+)\b/i);
  if (policyMatch && (q.includes("explain") || q.includes("what does"))) {
    const policyId = policyMatch[1]!.toLowerCase();
    return {
      name: "explainPolicy",
      args: { policyId },
      result: engine.explainPolicy(policyId),
    };
  }

  if (q.includes("finding") || q.includes("misconfig") || q.includes("risk")) {
    return {
      name: "listFindings",
      args: {},
      result: engine.listFindings(),
    };
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
    const target = `${service}/${rg}`;
    return {
      name: "pathsBetween",
      args: { subjectId, target },
      result: engine.pathsBetween(subjectId, target),
    };
  }

  if (subjectMatch && (q.includes("what can") || q.includes("access does"))) {
    const subjectId = subjectMatch[1]!;
    return {
      name: "whatCanSubjectReach",
      args: { subjectId },
      result: engine.whatCanSubjectReach(subjectId),
    };
  }

  if (serviceMatch || q.includes("who can")) {
    const service = serviceMatch?.[1] ?? "databases-for-postgresql";
    const resourceGroup = rgMatch?.[1];
    return {
      name: "whoCanAccess",
      args: { service, resourceGroup },
      result: engine.whoCanAccess(service, resourceGroup),
    };
  }

  if (subjectMatch) {
    const subjectId = subjectMatch[1]!;
    return {
      name: "whatCanSubjectReach",
      args: { subjectId },
      result: engine.whatCanSubjectReach(subjectId),
    };
  }

  return {
    name: "listFindings",
    args: { minSeverity: "HIGH" },
    result: engine.listFindings("HIGH"),
  };
}
