import { NextResponse } from "next/server";
import { tryCreateServiceClient } from "@/lib/supabase";
import { markExpired, readGrants, readPendingRequests } from "@/lib/expiry";

export const runtime = "nodejs";

export async function GET() {
  const supabase = tryCreateServiceClient();
  if (!supabase) {
    return NextResponse.json({
      ok: true,
      configured: false,
      audit: [],
      grants: [],
      pending_requests: [],
    });
  }

  await markExpired(supabase);

  const [auditRes, grants, pending_requests] = await Promise.all([
    supabase
      .from("audit")
      .select("*")
      .order("at", { ascending: false })
      .limit(40),
    readGrants(supabase),
    readPendingRequests(supabase),
  ]);

  return NextResponse.json({
    ok: true,
    configured: true,
    audit: auditRes.data ?? [],
    grants: grants.filter((g) => !g.revoked_at && new Date(g.expires_at) > new Date()),
    pending_requests: pending_requests.filter((r) => r.status === "pending"),
  });
}
