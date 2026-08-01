import type { KeyringSupabase } from "./supabase/client";
import type { GrantRow, PendingRequestRow } from "./supabase/types";

export type ExpiryResult = {
  expired_requests: number;
  expired_grants: number;
};

/**
 * Mark expired pending requests and grants.
 * Call this on every relevant read — do not rely on a cron job.
 */
export async function markExpired(
  client: KeyringSupabase,
  now: Date = new Date(),
): Promise<ExpiryResult> {
  const iso = now.toISOString();

  const requests = await client
    .from("pending_requests")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", iso)
    .select("id");

  if (requests.error) {
    throw new Error(`markExpired requests failed: ${requests.error.message}`);
  }

  const grants = await client
    .from("grants")
    .update({ revoked_at: iso })
    .is("revoked_at", null)
    .lt("expires_at", iso)
    .select("id");

  if (grants.error) {
    throw new Error(`markExpired grants failed: ${grants.error.message}`);
  }

  return {
    expired_requests: requests.data?.length ?? 0,
    expired_grants: grants.data?.length ?? 0,
  };
}

/** Read pending requests after applying expiry. */
export async function readPendingRequests(
  client: KeyringSupabase,
): Promise<PendingRequestRow[]> {
  await markExpired(client);
  const { data, error } = await client
    .from("pending_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`readPendingRequests failed: ${error.message}`);
  }
  return data ?? [];
}

/** Read grants after applying expiry. */
export async function readGrants(
  client: KeyringSupabase,
): Promise<GrantRow[]> {
  await markExpired(client);
  const { data, error } = await client
    .from("grants")
    .select("*")
    .order("granted_at", { ascending: false });

  if (error) {
    throw new Error(`readGrants failed: ${error.message}`);
  }
  return data ?? [];
}

/** Read a single pending request after applying expiry. */
export async function readPendingRequest(
  client: KeyringSupabase,
  id: string,
): Promise<PendingRequestRow | null> {
  await markExpired(client);
  const { data, error } = await client
    .from("pending_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`readPendingRequest failed: ${error.message}`);
  }
  return data;
}
