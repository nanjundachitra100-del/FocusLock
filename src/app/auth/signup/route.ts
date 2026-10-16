import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function redirectToSignup(request: NextRequest, error: string) {
  const signupUrl = new URL("/signup", request.url);
  signupUrl.searchParams.set("error", error);
  return NextResponse.redirect(signupUrl, 303);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const displayName = String(formData.get("displayName") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (displayName.length < 2 || displayName.length > 80 || !email || password.length < 8) {
      return redirectToSignup(request, "signup");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: new URL("/auth/callback", request.url).toString(),
      },
    });

    if (error) return redirectToSignup(request, "signup");
    if (data.session) return NextResponse.redirect(new URL("/", request.url), 303);
    if (data.user) {
      const signupUrl = new URL("/signup", request.url);
      signupUrl.searchParams.set("success", "confirmation");
      return NextResponse.redirect(signupUrl, 303);
    }

    return redirectToSignup(request, "signup");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Supabase is not configured.")) {
      return redirectToSignup(request, "configuration");
    }
    return redirectToSignup(request, "signup-network");
  }
}