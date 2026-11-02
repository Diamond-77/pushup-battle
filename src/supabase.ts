import { createClient } from "@supabase/supabase-js";

// Read any error Supabase/Google sent back in the URL before the client cleans it up.
const params = new URLSearchParams(window.location.search + "&" + window.location.hash.replace(/^#/, ""));
export const authUrlError = params.get("error_description") || params.get("error");

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Null when the env vars are missing, so the app can show a clear error instead of crashing.
export const supabase = url && key ? createClient(url, key) : null;
