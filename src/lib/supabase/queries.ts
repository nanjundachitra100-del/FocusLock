import "server-only";

import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";
import type { Database } from "./database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type FocusSession = Database["public"]["Tables"]["focus_sessions"]["Row"];

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(`Unable to fetch the authenticated user: ${error.message}`);
  return data.user;
}

export async function getUserProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(`Unable to verify the authenticated user: ${authError.message}`);
  if (!authData.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (error) throw new Error(`Unable to fetch the profile: ${error.message}`);
  return data;
}

export async function updateUserDisplayName(displayName: string): Promise<Profile> {
  const normalizedName = displayName.trim();
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    throw new Error("Display name must be between 2 and 80 characters.");
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(`Unable to verify the authenticated user: ${authError.message}`);
  if (!authData.user) throw new Error("You must be logged in to update your profile.");

  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: normalizedName })
    .eq("id", authData.user.id)
    .select("*")
    .single();
  if (error) throw new Error(`Unable to update the profile: ${error.message}`);
  return data;
}

export async function getFocusSessionHistory(limit = 50): Promise<FocusSession[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Session history limit must be between 1 and 100.");
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(`Unable to verify the authenticated user: ${authError.message}`);
  if (!authData.user) throw new Error("You must be logged in to fetch focus sessions.");

  const { data, error } = await supabase
    .from("focus_sessions")
    .select("*")
    .eq("user_id", authData.user.id)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Unable to fetch focus-session history: ${error.message}`);
  return data;
}