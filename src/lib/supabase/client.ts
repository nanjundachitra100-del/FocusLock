import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { requireSupabasePublicConfig } from "./env";

export function createClient() {
  const { url, publishableKey } = requireSupabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
}