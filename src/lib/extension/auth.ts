import type { NextRequest } from "next/server";
import { createClient as createServerCookieClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireSupabasePublicConfig } from "@/lib/supabase/env";

export interface AuthenticatedExtensionUser {
  id: string;
  email: string | null;
}

export interface ExtensionAuthContext {
  user: AuthenticatedExtensionUser;
  client: SupabaseClient<Database>;
}

export async function authenticateExtensionRequest(
  request: NextRequest,
): Promise<ExtensionAuthContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== null) {
    const match = /^Bearer ([^\s,]+)$/i.exec(authHeader);
    if (!match) return null;

    try {
      const token = match[1];
      const { url, publishableKey } = requireSupabasePublicConfig();
      const client = createSupabaseClient<Database>(url, publishableKey, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      const { data, error } = await client.auth.getUser(token);
      if (!error && data.user) {
        return {
          user: {
            id: data.user.id,
            email: data.user.email ?? null,
          },
          client,
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  try {
    const client = (await createServerCookieClient()) as unknown as SupabaseClient<Database>;
    const { data, error } = await client.auth.getUser();
    if (!error && data.user) {
      return {
        user: {
          id: data.user.id,
          email: data.user.email ?? null,
        },
        client,
      };
    }
  } catch {
    // Cookie auth failed.
  }

  return null;
}
