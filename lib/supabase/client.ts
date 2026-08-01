import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type KeyringSupabase = SupabaseClient<Database>;

function env(name: string): string | undefined {
  return process.env[name];
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    env("NEXT_PUBLIC_SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

function requireEnv(name: string): string {
  const value = env(name);
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

/** Returns null when Supabase env is not configured (demo still runs). */
export function tryCreateBrowserClient(): KeyringSupabase | null {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return createClient<Database>(url, key);
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

export function tryCreateServiceClient(): KeyringSupabase | null {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
