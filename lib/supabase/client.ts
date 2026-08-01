import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type KeyringSupabase = SupabaseClient<Database>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

/** Browser / anon client for the demo path (no auth wall). */
export function createBrowserClient(): KeyringSupabase {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

/**
 * Server client using the service role key.
 * PRODUCTION STEP: stop using the service role from request handlers; switch
 * to user-scoped clients with restrictive RLS instead.
 */
export function createServiceClient(): KeyringSupabase {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
