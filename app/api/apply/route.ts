import { NextResponse } from "next/server";
import { createPendingRequest } from "@/lib/approval/service";
import type { Finding } from "@/engine/findings";

export const runtime = "nodejs";

/** Convenience wrapper: create an apply_fix pending request from a finding. */
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

  // Single-tag demo: CRITICAL is 1 tap with a shorter 30s window.
  // Other severities stay 1 tap / 60s.
  const isCritical = body.finding.severity === "CRITICAL";
  const { mode, request: pending } = await createPendingRequest({
    kind: "apply_fix",
    requested_by: body.requested_by ?? "analyst",
    reason: body.finding.title,
    dual_control: false,
    ttl_seconds: isCritical ? 30 : 60,
    payload: {
      finding_id: body.finding.id,
      severity: body.finding.severity,
      suggestedFix: body.finding.suggestedFix,
      evidence: body.finding.evidence,
    },
  });

  return NextResponse.json({
    ok: true,
    mode,
    pending_request: pending,
  });
}
