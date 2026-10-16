"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthControls() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    try {
      const supabase = createClient();
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setEmail(session?.user.email ?? null);
      });
      unsubscribe = () => data.subscription.unsubscribe();

      void supabase.auth.getUser().then(({ data: userData, error: userError }) => {
        if (!active) return;
        if (userError) setError("Could not refresh account details.");
        setEmail(userData.user?.email ?? null);
      });
    } catch {
      setError("Supabase is not configured. Check the local environment settings.");
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    setPending(true);
    setError(null);
    try {
      const { error: signOutError } = await createClient().auth.signOut();
      if (signOutError) throw signOutError;
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden max-w-48 truncate text-xs text-slate-300 sm:block" title={email ?? undefined}>
        {email ?? "Loading account..."}
      </span>
      {error && <span role="alert" className="max-w-40 text-right text-[11px] leading-4 text-rose-200 sm:max-w-56">{error}</span>}
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        aria-label={pending ? "Logging out" : "Log out"}
        title={pending ? "Logging out" : "Log out"}
        className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
      </button>
    </div>
  );
}