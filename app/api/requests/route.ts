import { NextResponse } from "next/server";
import { createPendingRequest } from "@/lib/approval/service";
import type { RequestKind } from "@/lib/supabase/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    kind?: RequestKind;
    payload?: Record<string, unknown>;
    requested_by?: string;
    reason?: string;
    dual_control?: boolean;
  };

  if (!body.kind || !body.payload) {
    return NextResponse.json(
      { ok: false, error: "kind and payload are required" },
      { status: 400 },
    );
  }

  if (body.kind !== "grant_admin" && body.kind !== "apply_fix") {
    return NextResponse.json(
      { ok: false, error: "kind must be grant_admin or apply_fix" },
      { status: 400 },
    );
  }

  const { mode, request: pending } = await createPendingRequest({
    kind: body.kind,
    payload: body.payload,
    requested_by: body.requested_by ?? "analyst",
    reason: body.reason ?? body.kind,
    dual_control:
      body.dual_control ??
      (body.kind === "apply_fix" &&
        (body.payload as { severity?: string }).severity === "CRITICAL"),
  });

  return NextResponse.json({
    ok: true,
    mode,
    pending_request: pending,
  });
}
