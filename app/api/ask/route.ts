import { NextResponse } from "next/server";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { answerQuestion } from "@/lib/ai/ask";
import { tryCreateServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * Ask pipeline:
 * 1. Redact key/token/email shaped input (recorded)
 * 2. Send the question with the five engine tools (never the policy file)
 * 3. Execute the chosen engine function server-side
 * 4. Send structured engine output back for phrasing
 * 5. Return { answer, citations, toolCalled, args, confidence }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { raw?: string; question?: string };
  if (!body.raw || !body.question?.trim()) {
    return NextResponse.json(
      { ok: false, error: "raw and question are required" },
      { status: 400 },
    );
  }

  // Policy file is parsed server-side for the engine only.
  // It is never forwarded to the model.
  const parsed = parseAccountJson(body.raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, errors: parsed.errors },
      { status: 400 },
    );
  }

  const engine = createQueryEngine(parsed.data);
  const result = await answerQuestion(body.question.trim(), engine);

  const supabase = tryCreateServiceClient();
  if (supabase) {
    await supabase.from("audit").insert({
      actor: "analyst",
      action: "question.asked",
      detail: {
        question: body.question.trim(),
        confidence: result.confidence,
        toolCalled: result.toolCalled,
        args: result.args,
        usedFallback: result.usedFallback,
        redaction_count: result.redactions.length,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    answer: result.answer,
    citations: result.citations,
    toolCalled: result.toolCalled,
    args: result.args,
    confidence: result.confidence,
    redactions: result.redactions,
    usedFallback: result.usedFallback,
  });
}
