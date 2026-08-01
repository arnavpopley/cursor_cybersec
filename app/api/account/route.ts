import { NextResponse } from "next/server";
import { getAccountSnapshot } from "@/lib/approval/store";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";

export const runtime = "nodejs";

/** Current in-memory account after NFC-approved fixes. */
export async function GET() {
  const snapshot = getAccountSnapshot();
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "no account loaded" }, { status: 404 });
  }

  const parsed = parseAccountJson(snapshot.raw);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, errors: parsed.errors }, { status: 500 });
  }

  const findings = createQueryEngine(parsed.data).listFindings();
  return NextResponse.json({
    ok: true,
    raw: snapshot.raw,
    account_id: snapshot.account_id,
    updated_at: snapshot.updated_at,
    findings,
    summary: {
      subjects: parsed.data.subjects.length,
      access_groups: parsed.data.access_groups.length,
      policies: parsed.data.policies.length,
      findings: findings.length,
    },
  });
}
