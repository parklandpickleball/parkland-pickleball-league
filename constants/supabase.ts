// constants/supabase.ts
// Supabase REST config (no supabase-js required)

export const SUPABASE_URL = 'https://wnfenibhzubfonmyeakq.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_a5oBMQMiVGn-PpAJWskokQ_aE4-AhOp';

export function supabaseRestUrl(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${SUPABASE_URL}/rest/v1${cleanPath}`;
}

export function supabaseHeaders(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  };
}
