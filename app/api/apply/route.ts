import { NextResponse } from "next/server";
import { tryCreateServiceClient } from "@/lib/supabase";
import type { Finding } from "@/engine/findings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    finding?: Finding;
    requested_by?: string;
  };

  if (!body.finding) {
    return NextResponse.json(
      { ok: false, error: "finding is required" },
      { status: 400 },
    );
  }

  const supabase = tryCreateServiceClient();
  if (!supabase) {
    return NextResponse.json({
      ok: true,
      mode: "local",
      message:
        "Supabase is not configured. Apply queued locally — wire NFC approval when Supabase is available.",
      pending_request: {
        id: `local-${Date.now()}`,
        kind: "apply_fix",
        status: "pending",
        dual_control: body.finding.severity === "CRITICAL",
        expires_in_seconds: 60,
        payload: {
          finding_id: body.finding.id,
          suggestedFix: body.finding.suggestedFix,
        },
      },
    });
  }

  const dual_control = body.finding.severity === "CRITICAL";
  const { data, error } = await supabase
    .from("pending_requests")
    .insert({
      kind: "apply_fix",
      requested_by: body.requested_by ?? "analyst",
      reason: body.finding.title,
      dual_control,
      payload: {
        finding_id: body.finding.id,
        severity: body.finding.severity,
        suggestedFix: body.finding.suggestedFix,
        evidence: body.finding.evidence,
      },
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  await supabase.from("audit").insert({
    actor: body.requested_by ?? "analyst",
    action: "fix.apply_requested",
    detail: {
      finding_id: body.finding.id,
      request_id: data.id,
      dual_control,
    },
  });

  return NextResponse.json({
    ok: true,
    mode: "supabase",
    pending_request: data,
  });
}
