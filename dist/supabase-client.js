import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

export const isSupabaseConfigured =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
  SUPABASE_ANON_KEY.length > 24 &&
  !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

export let supabase = null;
export let supabaseLoadError = null;

if (isSupabaseConfigured) {
  try {
    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    supabaseLoadError = error;
  }
}
