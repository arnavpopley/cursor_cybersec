import { NextResponse } from "next/server";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";
import { tryCreateServiceClient } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { raw?: string };
  const raw = body.raw;
  if (!raw || typeof raw !== "string") {
    return NextResponse.json(
      { ok: false, errors: [{ message: "Missing raw JSON body" }] },
      { status: 400 },
    );
  }

  const parsed = parseAccountJson(raw);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 400 });
  }

  const engine = createQueryEngine(parsed.data);
  const findings = engine.listFindings();

  const supabase = tryCreateServiceClient();
  if (supabase) {
    await supabase.from("audit").insert({
      actor: "system",
      action: "account.analyzed",
      detail: {
        account_id: parsed.data.account_id,
        finding_count: findings.length,
        subject_count: parsed.data.subjects.length,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    account_id: parsed.data.account_id,
    summary: {
      subjects: parsed.data.subjects.length,
      access_groups: parsed.data.access_groups.length,
      policies: parsed.data.policies.length,
      findings: findings.length,
    },
    findings,
  });
}
