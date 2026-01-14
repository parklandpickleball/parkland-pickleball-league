// constants/supabase.ts
// Supabase REST + Storage config (no supabase-js required)

export const SUPABASE_URL = "https://wnfenibhzubfonmyeakq.supabase.co";

// Keep your publishable key so anything importing it still works.
export const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_a5oBMQMiVGn-PpAJWskokQ_aE4-AhOp";

// ✅ Use publishable as the API key + bearer for your REST calls (as you had when things worked)
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

/**
 * REST endpoint helper
 */
export function supabaseRestUrl(path: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${SUPABASE_URL}/rest/v1${cleanPath}`;
}

/**
 * Shared headers for REST + Storage
 * ✅ Default to JSON so PostgREST inserts/updates work
 * ✅ Allow overrides (photos upload can override Content-Type)
 */
export function supabaseHeaders(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
}
