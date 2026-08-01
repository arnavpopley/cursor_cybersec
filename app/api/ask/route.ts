import { NextResponse } from "next/server";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { answerQuestion } from "@/lib/ai/ask";
import { tryCreateServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { raw?: string; question?: string };
  if (!body.raw || !body.question?.trim()) {
    return NextResponse.json(
      { ok: false, error: "raw and question are required" },
      { status: 400 },
    );
  }

  const parsed = parseAccountJson(body.raw);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  const engine = createQueryEngine(parsed.data);
  const answer = await answerQuestion(body.question.trim(), engine);

  const supabase = tryCreateServiceClient();
  if (supabase) {
    await supabase.from("audit").insert({
      actor: "analyst",
      action: "question.asked",
      detail: {
        question: body.question.trim(),
        confidence: answer.confidence,
        engine_calls: answer.engine_calls.map((c) => c.name),
        used_model: answer.used_model,
      },
    });
  }

  return NextResponse.json({ ok: true, answer });
}
