import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when the env vars are missing, so the app can show a clear error instead of crashing.
export const supabase = url && key ? createClient(url, key) : null;
