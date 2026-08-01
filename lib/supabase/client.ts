import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type KeyringSupabase = SupabaseClient<Database>;

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  let v = raw.trim();
  // Vercel UI sometimes preserves wrapping quotes from a copy/paste.
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}

/** Resolve first non-empty candidate (supports Supabase Connect aliases). */
function envAny(...names: string[]): string | undefined {
  for (const name of names) {
    const v = env(name);
    if (v) return v;
  }
  return undefined;
}

function supabaseUrl(): string | undefined {
  return envAny("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
}

/** Non-secret URL metadata for hosted debugging. */
export function supabaseUrlMeta(): {
  present: boolean;
  protocol: string | null;
  host: string | null;
} {
  const url = supabaseUrl();
  if (!url) return { present: false, protocol: null, host: null };
  try {
    const u = new URL(url);
    return { present: true, protocol: u.protocol.replace(":", ""), host: u.host };
  } catch {
    return { present: true, protocol: null, host: "invalid-url" };
  }
}

function supabaseAnonKey(): string | undefined {
  return envAny(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
  );
}

function supabaseServiceKey(): string | undefined {
  return envAny(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_KEY",
  );
}

/** Safe booleans for debugging hosted env (never returns secret values). */
export function supabaseEnvPresence(): {
  url: boolean;
  anon: boolean;
  service: boolean;
} {
  return {
    url: Boolean(supabaseUrl()),
    anon: Boolean(supabaseAnonKey()),
    service: Boolean(supabaseServiceKey()),
  };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey());
}

function requireValue(label: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${label}`);
  }
  return value;
}

/** Browser / anon client for the demo path (no auth wall). */
export function createBrowserClient(): KeyringSupabase {
  return createClient<Database>(
    requireValue("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl()),
    requireValue("NEXT_PUBLIC_SUPABASE_ANON_KEY", supabaseAnonKey()),
  );
}

/** Returns null when Supabase env is not configured (demo still runs). */
export function tryCreateBrowserClient(): KeyringSupabase | null {
  const url = supabaseUrl();
  const key = supabaseAnonKey();
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
    requireValue("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl()),
    requireValue("SUPABASE_SERVICE_ROLE_KEY", supabaseServiceKey()),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export function tryCreateServiceClient(): KeyringSupabase | null {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
