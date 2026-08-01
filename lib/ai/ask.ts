import { askModel, hasOpenAI, type AskModelMessage } from "./client";
import {
  ENGINE_TOOLS,
  routeQuestionToEngine,
  runEngineTool,
  type EngineCall,
} from "./tools";
import { redactSensitive } from "./redact";
import type { QueryEngine } from "@/engine/queries";
import type { PathStep } from "@/engine/graph";
import type { Finding } from "@/engine/findings";

export type Citation = {
  policyId: string | null;
  line_start: number;
  line_end: number;
  label: string;
};

export type AskAnswer = {
  text: string;
  confidence: "high" | "medium" | "low";
  citations: Citation[];
  engine_calls: EngineCall[];
  used_model: boolean;
  redactions: Array<{ kind: string; from: string; to: string }>;
};

function citationsFromUnknown(data: unknown): Citation[] {
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

function phraseEngineResult(call: EngineCall): string {
  const { name, result } = call;

  if (name === "pathsBetween" && Array.isArray(result)) {
    const paths = result as PathStep[][];
    if (paths.length === 0) {
      return "The engine found no access path between that subject and target.";
    }
    const path = paths[0]!;
    const steps = path
      .map((s, i) => `${i + 1}. ${s.reason} (${s.policy_id ?? "membership"}, L${s.line_start}–${s.line_end})`)
      .join(" ");
    return `The engine found ${paths.length} path(s). Shortest is ${path.length} steps: ${steps}`;
  }

  if (name === "listFindings" && Array.isArray(result)) {
    const findings = result as Finding[];
    if (findings.length === 0) return "The engine reported no findings at that severity.";
    const top = findings
      .slice(0, 5)
      .map((f) => `${f.severity}: ${f.title}`)
      .join("; ");
    return `The engine reported ${findings.length} finding(s). Top: ${top}.`;
  }

  if (name === "whoCanAccess" && Array.isArray(result)) {
    const rows = result as Array<{ subject_id: string; subject_name: string; paths: unknown[] }>;
    if (rows.length === 0) return "The engine found no subjects with access to that target.";
    return `The engine found ${rows.length} subject(s) with access: ${rows
      .slice(0, 8)
      .map((r) => r.subject_name)
      .join(", ")}${rows.length > 8 ? "…" : ""}.`;
  }

  if (name === "whatCanSubjectReach" && Array.isArray(result)) {
    const rows = result as Array<{ target: string }>;
    if (rows.length === 0) return "The engine found no reachable targets for that subject.";
    return `The engine found ${rows.length} reachable target(s): ${rows
      .map((r) => r.target)
      .slice(0, 10)
      .join(", ")}${rows.length > 10 ? "…" : ""}.`;
  }

  if (name === "explainPolicy") {
    if (!result) return "The engine could not find that policy.";
    const explained = result as {
      policy: { id: string; line_start: number; line_end: number };
      affected_subjects: Array<{ id: string; name: string; via_group: string | null }>;
    };
    const names = explained.affected_subjects
      .slice(0, 8)
      .map((s) =>
        s.via_group ? `${s.name} via ${s.via_group}` : s.name,
      )
      .join(", ");
    return `Policy ${explained.policy.id} (L${explained.policy.line_start}–${explained.policy.line_end}) affects ${explained.affected_subjects.length} subject(s): ${names || "none"}.`;
  }

  return "The engine returned a structured result; see citations for evidence.";
}

async function askWithModel(
  question: string,
  engine: QueryEngine,
): Promise<AskAnswer> {
  const { text: safeQuestion, redactions } = redactSensitive(question);
  const system = `You are Keyring's answer phrasing layer.
You NEVER decide permissions yourself. You only call the provided engine tools,
then phrase the tool results in clear English for a security engineer.
Always mention line ranges when the engine provides them.
If the engine cannot determine something, say so plainly.
Do not invent findings or access paths.`;

  const messages: AskModelMessage[] = [
    { role: "system", content: system },
    { role: "user", content: safeQuestion },
  ];

  const calls: EngineCall[] = [];
  let rounds = 0;

  while (rounds < 4) {
    rounds++;
    const { message } = await askModel({
      messages,
      tools: ENGINE_TOOLS,
      tool_choice: rounds === 1 ? "required" : "auto",
    });

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: message.content,
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        const result = runEngineTool(engine, toolCall.function.name, args);
        calls.push({ name: toolCall.function.name, args, result });
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    const text =
      message.content?.trim() ||
      (calls[0] ? phraseEngineResult(calls[0]) : "No answer.");
    return {
      text,
      confidence: calls.length > 0 ? "high" : "low",
      citations: calls.flatMap((c) => citationsFromUnknown(c.result)),
      engine_calls: calls,
      used_model: true,
      redactions,
    };
  }

  const fallback = calls[0]
    ? phraseEngineResult(calls[0])
    : "The engine could not complete that question.";
  return {
    text: fallback,
    confidence: "medium",
    citations: calls.flatMap((c) => citationsFromUnknown(c.result)),
    engine_calls: calls,
    used_model: true,
    redactions,
  };
}

export async function answerQuestion(
  question: string,
  engine: QueryEngine,
): Promise<AskAnswer> {
  if (hasOpenAI()) {
    try {
      return await askWithModel(question, engine);
    } catch {
      // Fall through to deterministic router.
    }
  }

  const { redactions } = redactSensitive(question);
  const call = routeQuestionToEngine(question, engine);
  return {
    text: phraseEngineResult(call),
    confidence: "high",
    citations: citationsFromUnknown(call.result),
    engine_calls: [call],
    used_model: false,
    redactions,
  };
}
