export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export type SupabaseEnvironmentStatus = {
  urlPresent: boolean;
  publishableKeyPresent: boolean;
};

export function getSupabaseEnvironmentStatus(): SupabaseEnvironmentStatus {
  return {
    urlPresent: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    publishableKeyPresent: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()),
  };
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) return null;

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return null;
    }
  } catch {
    return null;
  }

  return { url, publishableKey };
}

export function requireSupabasePublicConfig(): SupabasePublicConfig {
  const config = getSupabasePublicConfig();
  if (!config) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
  }
  return config;
}