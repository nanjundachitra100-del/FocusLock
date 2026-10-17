import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";
import { getSupabasePublicConfig } from "@/lib/supabase/env";

const publicPaths = new Set(["/login", "/signup", "/auth/callback", "/auth/login", "/auth/signup"]);

function isTransientAuthError(error: { status?: number } | null) {
  if (!error) return false;
  return error.status === undefined || error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isPublicPath = publicPaths.has(pathname);
  const supabaseConfig = getSupabasePublicConfig();

  if (!supabaseConfig) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Supabase configuration is missing." },
        { status: 500 },
      );
    }
    if (isPublicPath) return NextResponse.next();

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "configuration");
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const redirectWithCookies = (destination: URL) => {
    const redirectResponse = NextResponse.redirect(destination);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirectResponse.headers.set(header, value);
    }
    return redirectResponse;
  };

  const supabase = createServerClient<Database>(
    supabaseConfig.url,
    supabaseConfig.publishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();

  if (error && isTransientAuthError(error)) {
    return response;
  }

  if (isPublicPath) {
    if (data.user && !error && pathname !== "/auth/callback" && pathname !== "/auth/login" && pathname !== "/auth/signup") {
      return redirectWithCookies(new URL("/", request.url));
    }
    return response;
  }

  if (error || !data.user) {
    if (pathname.startsWith("/api/")) {
      return response;
    }
    const loginUrl = new URL("/login", request.url);
    if (error) loginUrl.searchParams.set("error", "session");
    return redirectWithCookies(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};