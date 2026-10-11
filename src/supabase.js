import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// No keys configured → "demo mode": no sign-in, data only saved in this browser.
export const supabase = url && key ? createClient(url, key) : null;
