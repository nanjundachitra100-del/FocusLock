"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { AvatarStageProps } from "./AvatarStage";

// Sleek fallback placeholder matching FocusLock glassmorphic theme
function AvatarStageSkeleton() {
  return (
    <div className="glass flex h-[410px] w-full flex-col justify-between rounded-2xl border border-white/10 p-5 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-white/10">
            <Sparkles className="size-4 text-violet-300" />
          </div>
          <div>
            <div className="h-4 w-36 rounded bg-white/10" />
            <div className="mt-1 h-3 w-48 rounded bg-white/5" />
          </div>
        </div>
        <div className="h-6 w-20 rounded-full bg-white/5" />
      </div>

      <div className="flex h-72 w-full flex-col items-center justify-center rounded-xl border border-white/5 bg-white/3">
        <LoaderCircle className="size-6 animate-spin text-violet-400" />
        <span className="mt-2 text-xs text-slate-400">Initializing 3D virtual companion…</span>
      </div>

      <div className="flex justify-between">
        <div className="h-6 w-32 rounded bg-white/5" />
        <div className="h-6 w-28 rounded bg-white/5" />
      </div>
    </div>
  );
}

// Dynamically imported with SSR disabled to keep all other dashboard tabs lightweight
const DynamicAvatarStage = dynamic(() => import("./AvatarStage"), {
  ssr: false,
  loading: () => <AvatarStageSkeleton />,
});

export default function LazyAvatarStage(props: AvatarStageProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <AvatarStageSkeleton />;
  }

  return <DynamicAvatarStage {...props} />;
}
