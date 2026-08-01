import { askModel, type AskModelMessage, type AskModelProvider } from "./client";
import {
  ENGINE_TOOLS,
  routeQuestionToTool,
  runEngineTool,
  type EngineToolName,
} from "./tools";
import { redactSensitive, type Redaction } from "./redact";
import type { QueryEngine } from "@/engine/queries";
import type { PathStep } from "@/engine/graph";
import type { Finding } from "@/engine/findings";

export type Citation = {
  policyId: string | null;
  line_start: number;
  line_end: number;
  label: string;
};

export type AskResponse = {
  answer: string;
  citations: Citation[];
  toolCalled: string;
  args: Record<string, unknown>;
  confidence: "high" | "medium" | "low";
  redactions: Redaction[];
  usedFallback: boolean;
};

/** @deprecated Use AskResponse — kept for older UI imports during transition */
export type AskAnswer = {
  text: string;
  confidence: "high" | "medium" | "low";
  citations: Citation[];
  toolCalled: string;
  args: Record<string, unknown>;
  used_model: boolean;
  usedFallback: boolean;
  redactions: Redaction[];
  engine_calls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
  }>;
};

export function citationsFromUnknown(data: unknown): Citation[] {
  const out: Citation[] = [];
  const seen = new Set<string>();

  function add(
    policyId: string | null,
    line_start: number,
    line_end: number,
    label: string,
  ) {
    const key = `${policyId}:${line_start}:${line_end}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ policyId, line_start, line_end, label });
  }

  function walk(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (
      typeof obj.line_start === "number" &&
      typeof obj.line_end === "number"
    ) {
      const policyId =
        (typeof obj.policy_id === "string" && obj.policy_id) ||
        (typeof obj.policyId === "string" && obj.policyId) ||
        null;
      add(
        policyId,
        obj.line_start,
        obj.line_end,
        typeof obj.reason === "string"
          ? obj.reason
          : policyId
            ? `Policy ${policyId}`
            : `Lines ${obj.line_start}–${obj.line_end}`,
      );
    }
    for (const v of Object.values(obj)) walk(v);
  }

  walk(data);
  return out;
}

export function phraseEngineResult(
  toolCalled: string,
  result: unknown,
): string {
  if (toolCalled === "pathsBetween" && Array.isArray(result)) {
    const paths = result as PathStep[][];
    if (paths.length === 0) {
      return "The engine found no access path between that subject and target.";
    }
    const path = paths[0]!;
    const steps = path
      .map(
        (s, i) =>
          `${i + 1}. ${s.reason} (${s.policy_id ?? "membership"}, L${s.line_start}–${s.line_end})`,
      )
      .join(" ");
    return `The engine found ${paths.length} path(s). Shortest is ${path.length} steps: ${steps}`;
  }

  if (toolCalled === "listFindings" && Array.isArray(result)) {
    const findings = result as Finding[];
    if (findings.length === 0) {
      return "The engine reported no findings at that severity.";
    }
    const top = findings
      .slice(0, 5)
      .map((f) => `${f.severity}: ${f.title}`)
      .join("; ");
    return `The engine reported ${findings.length} finding(s). Top: ${top}.`;
  }

  if (toolCalled === "whoCanAccess" && Array.isArray(result)) {
    const rows = result as Array<{
      subject_id: string;
      subject_name: string;
      paths: unknown[];
    }>;
    if (rows.length === 0) {
      return "The engine found no subjects with access to that target.";
    }
    return `The engine found ${rows.length} subject(s) with access: ${rows
      .slice(0, 8)
      .map((r) => r.subject_name)
      .join(", ")}${rows.length > 8 ? "…" : ""}.`;
  }

  if (toolCalled === "whatCanSubjectReach" && Array.isArray(result)) {
    const rows = result as Array<{ target: string }>;
    if (rows.length === 0) {
      return "The engine found no reachable targets for that subject.";
    }
    return `The engine found ${rows.length} reachable target(s): ${rows
      .map((r) => r.target)
      .slice(0, 10)
      .join(", ")}${rows.length > 10 ? "…" : ""}.`;
  }

  if (toolCalled === "explainPolicy") {
    if (!result) return "The engine could not find that policy.";
    const explained = result as {
      policy: { id: string; line_start: number; line_end: number };
      affected_subjects: Array<{
        id: string;
        name: string;
        via_group: string | null;
      }>;
    };
    const names = explained.affected_subjects
      .slice(0, 8)
      .map((s) => (s.via_group ? `${s.name} via ${s.via_group}` : s.name))
      .join(", ");
    return `Policy ${explained.policy.id} (L${explained.policy.line_start}–${explained.policy.line_end}) affects ${explained.affected_subjects.length} subject(s): ${names || "none"}.`;
  }

  return "The engine returned a structured result; see citations for evidence.";
}

function parseToolCall(message: {
  tool_calls?: Array<{
    type: string;
    function?: { name: string; arguments: string };
  }>;
}): { name: string; args: Record<string, unknown> } | null {
  const call = message.tool_calls?.find((t) => t.type === "function");
  if (!call?.function?.name) return null;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}") as Record<
      string,
      unknown
    >;
  } catch {
    args = {};
  }
  return { name: call.function.name, args };
}

/**
 * Full ask pipeline.
 * The model never sees the policy file — only the redacted question and
 * the engine's structured output.
 */
export async function answerQuestion(
  question: string,
  engine: QueryEngine,
  options?: { provider?: AskModelProvider },
): Promise<AskResponse> {
  // 1. Redact secrets from the question; record what was removed.
  const { text: safeQuestion, redactions } = redactSensitive(question);

  // 2. Ask the model to choose one of the five engine tools.
  //    Input is ONLY the redacted question — never the policy file.
  const selectMessages: AskModelMessage[] = [
    {
      role: "system",
      content: `You translate English IAM questions into exactly one engine tool call.
You NEVER decide whether someone has access. You NEVER invent permissions.
You only pick among: whoCanAccess, whatCanSubjectReach, pathsBetween, listFindings, explainPolicy.
Call exactly one tool.`,
    },
    { role: "user", content: safeQuestion },
  ];

  const selection = await askModel({
    messages: selectMessages,
    tools: ENGINE_TOOLS,
    tool_choice: "required",
    provider: options?.provider,
  });

  let toolCalled: string;
  let args: Record<string, unknown>;
  let usedFallback = selection.usedFallback;

  const parsed = parseToolCall(selection.message);
  if (parsed && ENGINE_TOOLS.some((t) => t.type === "function" && t.function.name === parsed.name)) {
    toolCalled = parsed.name;
    args = parsed.args;
  } else {
    const routed = routeQuestionToTool(safeQuestion);
    toolCalled = routed.name;
    args = routed.args;
    usedFallback = true;
  }

  // 3. Execute the chosen engine function server-side.
  const engineResult = runEngineTool(engine, toolCalled, args);
  const citations = citationsFromUnknown(engineResult);

  // 4. Send the structured engine result back for phrasing.
  //    Again: model sees ONLY question + engine JSON — never the policy file.
  const phraseMessages: AskModelMessage[] = [
    {
      role: "system",
      content: `You phrase Keyring engine results for a security engineer.
You NEVER add permissions, paths, or findings that are not in the engine JSON.
Always mention line ranges when present.
If the engine result is empty or inconclusive, say so plainly.
Keep the answer to a short paragraph.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        question: safeQuestion,
        toolCalled,
        args,
        engineResult,
      }),
    },
  ];

  const phrased = await askModel({
    messages: phraseMessages,
    provider: options?.provider,
  });
  usedFallback = usedFallback || phrased.usedFallback;

  const cannedPhrase = phraseEngineResult(toolCalled, engineResult);
  const answer =
    !phrased.usedFallback && phrased.message.content?.trim()
      ? phrased.message.content.trim()
      : cannedPhrase;

  // 5. Return the inspectable response shape.
  return {
    answer,
    citations,
    toolCalled,
    args,
    confidence: citations.length > 0 ? "high" : "medium",
    redactions,
    usedFallback,
  };
}

export function toAskAnswer(response: AskResponse, engineResult?: unknown): AskAnswer {
  return {
    text: response.answer,
    confidence: response.confidence,
    citations: response.citations,
    toolCalled: response.toolCalled,
    args: response.args,
    used_model: !response.usedFallback,
    usedFallback: response.usedFallback,
    redactions: response.redactions,
    engine_calls: [
      {
        name: response.toolCalled as EngineToolName,
        args: response.args,
        result: engineResult ?? null,
      },
    ],
  };
}
