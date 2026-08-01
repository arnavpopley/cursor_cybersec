import { NextResponse } from "next/server";
import { supabaseEnvPresence, tryCreateServiceClient } from "@/lib/supabase";
import { markExpired, readGrants, readPendingRequests } from "@/lib/expiry";
import {
  getAccountSnapshot,
  memoryListAudit,
  memoryListGrants,
  memoryListPending,
  memoryMarkExpired,
} from "@/lib/approval/store";
import { parseAccountJson } from "@/engine/parse";
import { createQueryEngine } from "@/engine/queries";

export const runtime = "nodejs";

export async function GET() {
  memoryMarkExpired();
  const snapshot = getAccountSnapshot();
  let findings =
    snapshot?.finding_ids.map((id) => ({ id })) ?? [];

  if (snapshot?.raw) {
    const parsed = parseAccountJson(snapshot.raw);
    if (parsed.ok) {
      findings = createQueryEngine(parsed.data).listFindings();
    }
  }

  const local = {
    audit: memoryListAudit().slice(0, 40),
    grants: memoryListGrants().filter(
      (g) => !g.revoked_at && new Date(g.expires_at) > new Date(),
    ),
    pending_requests: memoryListPending().filter((r) => r.status === "pending"),
    account: snapshot
      ? {
          raw: snapshot.raw,
          account_id: snapshot.account_id,
          finding_ids: snapshot.finding_ids,
          updated_at: snapshot.updated_at,
          findings,
        }
      : null,
  };

  const supabase = tryCreateServiceClient();
  if (!supabase) {
    return NextResponse.json({
      ok: true,
      configured: false,
      env: supabaseEnvPresence(),
      hint: "Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Vercel (Production), then Redeploy.",
      ...local,
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

  const remoteAudit = auditRes.data ?? [];
  const mergedAudit = [...remoteAudit];
  for (const row of local.audit) {
    if (!mergedAudit.some((a) => a.id === row.id)) mergedAudit.push(row);
  }
  mergedAudit.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );

  const remoteGrants = grants.filter(
    (g) => !g.revoked_at && new Date(g.expires_at) > new Date(),
  );
  const grantMap = new Map<string, (typeof remoteGrants)[number]>();
  for (const g of [...remoteGrants, ...local.grants]) grantMap.set(g.id, g);

  const remotePending = pending_requests.filter((r) => r.status === "pending");
  const pendingMap = new Map<string, (typeof remotePending)[number]>();
  for (const r of [...remotePending, ...local.pending_requests]) {
    pendingMap.set(r.id, r);
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    audit: mergedAudit.slice(0, 40),
    grants: [...grantMap.values()],
    pending_requests: [...pendingMap.values()].filter(
      (r) => r.status === "pending",
    ),
    account: local.account,
  });
}
