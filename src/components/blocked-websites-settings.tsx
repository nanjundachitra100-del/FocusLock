"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Check, Globe, LoaderCircle, Plus, RotateCw, ShieldCheck, X } from "lucide-react";
import { loadBlockedSites, saveBlockedSites } from "@/lib/blocked-sites/api";
import {
  BLOCKED_SITE_CATALOG,
  addCustomWebsite,
  EMPTY_SELECTION_ERROR,
  hostPermissionGuidance,
  loadBlockedWebsiteSelections,
  persistBlockedWebsiteSelection,
  removeCustomWebsite,
  selectionsFromSavedSites,
  toggleCustomWebsite,
  toggleDomain,
  validateSelection,
  type BlockedSiteRecord,
} from "@/lib/blocked-sites/settings";
import type { ExtensionStatus } from "@/lib/extension/status-bridge";

export function BlockedWebsitesSettings({
  status,
  onRefresh,
}: {
  status?: ExtensionStatus;
  onRefresh?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [extraSites, setExtraSites] = useState<BlockedSiteRecord[]>([]);
  const [customWebsiteInput, setCustomWebsiteInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<"load" | "save" | "validation" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const applySites = useCallback((sites: BlockedSiteRecord[]) => {
    const selections = selectionsFromSavedSites(sites);
    setSelected(selections.selected);
    setExtraSites(selections.extraSites);
  }, []);

  const loadSelections = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setErrorSource(null);
    setSuccess(null);

    const result = await loadBlockedWebsiteSelections({ load: loadBlockedSites });
    if (requestId !== requestIdRef.current) return;

    if (!result.success) {
      setError(result.error);
      setErrorSource("load");
      setLoading(false);
      return;
    }

    setSelected(result.selected);
    setExtraSites(result.extraSites);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSelections();
  }, [loadSelections]);

  function handleToggle(domain: string) {
    if (loading || saving) return;
    const next = toggleDomain(selected, domain);
    setSelected(next);
    setSuccess(null);

    const validation = validateSelection(next, extraSites);
    if (!validation.valid) {
      setError(validation.error);
      setErrorSource("validation");
      return;
    }

    setError(null);
    setErrorSource(null);
  }

  function handleAddCustomWebsite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || saving) return;

    const result = addCustomWebsite(customWebsiteInput, selected, extraSites);
    if (!result.success) {
      setError(result.error);
      setErrorSource("validation");
      setSuccess(null);
      return;
    }

    if (result.kind === "catalog") {
      setSelected((current) => current.includes(result.domain) ? current : [...current, result.domain]);
    } else {
      setExtraSites(result.extraSites);
    }
    setCustomWebsiteInput("");
    setError(null);
    setErrorSource(null);
    setSuccess(null);
  }

  function handleToggleCustomWebsite(domain: string) {
    if (loading || saving) return;
    setExtraSites((current) => toggleCustomWebsite(current, domain));
    setSuccess(null);
    setError(null);
    setErrorSource(null);
  }

  function handleRemoveCustomWebsite(domain: string) {
    if (loading || saving) return;
    setExtraSites((current) => removeCustomWebsite(current, domain));
    setSuccess(null);
    setError(null);
    setErrorSource(null);
  }

  async function handleSave() {
    if (loading || saving) return;

    const validation = validateSelection(selected, extraSites);
    if (!validation.valid) {
      setSuccess(null);
      setError(validation.error);
      setErrorSource("validation");
      return;
    }

    setSaving(true);
    setError(null);
    setErrorSource(null);
    setSuccess(null);

    const result = await persistBlockedWebsiteSelection({
      selectedDomains: selected,
      extraSites,
      save: saveBlockedSites,
      refreshExtension: onRefresh,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error);
      setErrorSource(result.reason === "empty" ? "validation" : "save");
      return;
    }

    applySites(result.sites);
    setSuccess("Blocked websites saved. For newly added sites, open the FocusLock Guardian popup and choose Enable website blocking to grant Chrome access.");
  }

  const emptySelection = selected.length === 0 && !extraSites.some((site) => site.enabled);
  const saveDisabled = loading || saving || emptySelection;
  const connectionState = status?.state ?? "not_detected";

  return (
    <section className="glass mt-4 max-w-2xl rounded-2xl p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[.2em] text-violet-300">
            <Globe className="size-3.5" /> FOCUS GUARDIAN
          </div>
          <h3 className="font-semibold">Blocked Websites</h3>
          <p className="mt-1 text-sm text-slate-400">
            Choose the sites FocusLock should block until you earn entertainment time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadSelections()}
          disabled={loading || saving}
          title="Reload saved selections"
          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCw className={`size-3.5 ${loading ? "animate-spin text-violet-300" : ""}`} />
        </button>
      </div>

      <form onSubmit={handleAddCustomWebsite} className="mb-5 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="blocked-custom-website">Add a website</label>
        <input
          id="blocked-custom-website"
          type="text"
          autoComplete="url"
          value={customWebsiteInput}
          onChange={(event) => setCustomWebsiteInput(event.target.value)}
          placeholder="Add a domain or website URL, e.g. snapchat.com"
          disabled={loading || saving}
          aria-describedby="blocked-custom-website-help"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-violet-300/60 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || saving || !customWebsiteInput.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-3 text-sm font-semibold text-violet-100 hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4" /> Add website
        </button>
        <p id="blocked-custom-website-help" className="sr-only">Enter a domain or an HTTP or HTTPS URL.</p>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-4 py-6 text-sm text-slate-400">
          <LoaderCircle className="size-4 animate-spin text-violet-300" />
          Loading your blocked websites…
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {BLOCKED_SITE_CATALOG.map((site) => {
            const isSelected = selected.includes(site.domain);
            return (
              <button
                key={site.domain}
                type="button"
                aria-pressed={isSelected}
                aria-label={`${isSelected ? "Unblock" : "Block"} ${site.name}`}
                disabled={saving}
                onClick={() => handleToggle(site.domain)}
                className={`rounded-2xl border p-4 text-left transition ${
                  isSelected
                    ? "border-violet-400/60 bg-violet-400/10 text-violet-100"
                    : "border-white/8 bg-white/3 text-slate-300 hover:bg-white/7"
                } ${saving ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{site.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{site.domain}</div>
                  </div>
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${
                      isSelected
                        ? "border-violet-300/70 bg-violet-400/20 text-violet-100"
                        : "border-white/15 bg-white/5 text-transparent"
                    }`}
                  >
                    <Check className="size-3.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && extraSites.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-3 text-sm font-medium text-slate-200">Your custom websites</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {extraSites.map((site) => (
              <div
                key={site.domain}
                className={`flex items-stretch gap-2 rounded-2xl border p-2 ${
                  site.enabled ? "border-violet-400/60 bg-violet-400/10" : "border-white/8 bg-white/3"
                }`}
              >
                <button
                  type="button"
                  aria-pressed={site.enabled}
                  aria-label={`${site.enabled ? "Unblock" : "Block"} ${site.domain}`}
                  disabled={saving}
                  onClick={() => handleToggleCustomWebsite(site.domain)}
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 p-2 text-left"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-100">{site.domain}</span>
                    <span className="mt-1 block text-xs text-slate-500">Custom website</span>
                  </span>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${
                    site.enabled
                      ? "border-violet-300/70 bg-violet-400/20 text-violet-100"
                      : "border-white/15 bg-white/5 text-transparent"
                  }`}>
                    <Check className="size-3.5" />
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${site.domain}`}
                  title={`Remove ${site.domain}`}
                  disabled={saving}
                  onClick={() => handleRemoveCustomWebsite(site.domain)}
                  className="self-start rounded-lg p-2 text-slate-500 hover:bg-rose-400/10 hover:text-rose-200 disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {extraSites.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          {extraSites.length} additional saved {extraSites.length === 1 ? "site is" : "sites are"} kept
          when you save: {extraSites.map((site) => site.domain).join(", ")}.
        </p>
      )}

      <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-violet-300" />
        {hostPermissionGuidance(connectionState)}
      </p>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div>{error}</div>
            {(errorSource === "load" || errorSource === "save") && !saving && (
              <button
                type="button"
                onClick={() => {
                  if (errorSource === "load") {
                    void loadSelections();
                    return;
                  }
                  void handleSave();
                }}
                className="mt-2 font-medium text-rose-100 underline decoration-rose-300/40 underline-offset-2 hover:text-white"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-xs text-emerald-200">
          {success}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saveDisabled}
        className="mt-6 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" /> Saving…
          </span>
        ) : (
          "Save blocked websites"
        )}
      </button>
      {emptySelection && !loading && (
        <p className="mt-2 text-xs text-rose-200">{EMPTY_SELECTION_ERROR}</p>
      )}
    </section>
  );
}
