import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function loginErrorCode(error: { message: string; status?: number; code?: string }) {
  const message = error.message.toLowerCase();
  const code = error.code?.toLowerCase() ?? "";

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "invalid-credentials";
  }
  if (code.includes("email_not_confirmed") || message.includes("email not confirmed")) {
    return "email-not-confirmed";
  }
  if (error.status === undefined || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500) {
    return "auth-network";
  }
  return "login";
}

function redirectToLogin(request: NextRequest, code: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", code);
  return NextResponse.redirect(loginUrl, 303);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) return redirectToLogin(request, "login");

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return redirectToLogin(request, loginErrorCode(error));
    if (!data.session) return redirectToLogin(request, "login");

    return NextResponse.redirect(new URL("/", request.url), 303);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured.")) {
      return redirectToLogin(request, "configuration");
    }
    return redirectToLogin(request, "auth-network");
  }
}