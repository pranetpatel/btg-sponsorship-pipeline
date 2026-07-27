"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { EmailTemplate, SponsorStatus, SponsorWithStats } from "@/lib/types";

/**
 * Single source of truth for the dashboard.
 *
 * Fetches through the API routes (so the service-role key stays server-side)
 * and subscribes to Supabase realtime purely as a signal to refetch. Refetching
 * rather than patching rows in place keeps the outreach rollups correct without
 * duplicating the join logic on the client.
 */
export function usePipeline() {
  const [sponsors, setSponsors] = useState<SponsorWithStats[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveAt, setLiveAt] = useState<Date | null>(null);

  // Coalesces bursts of realtime events into one refetch.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [sponsorRes, templateRes] = await Promise.all([
        fetch("/api/sponsors", { cache: "no-store" }),
        fetch("/api/templates", { cache: "no-store" }),
      ]);

      if (sponsorRes.status === 401) {
        window.location.reload();
        return;
      }
      if (!sponsorRes.ok) {
        const data = await sponsorRes.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not load sponsors");
      }

      const { sponsors } = await sponsorRes.json();
      setSponsors(sponsors ?? []);

      if (templateRes.ok) {
        const { templates } = await templateRes.json();
        setTemplates(templates ?? []);
      }

      setError(null);
      setLiveAt(new Date());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(refresh, 400);
  }, [refresh]);

  useEffect(() => {
    // Initial load. refresh() is async, so every setState inside it happens
    // in a promise callback rather than synchronously during this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let channel: ReturnType<
      ReturnType<typeof supabaseBrowser>["channel"]
    > | null = null;

    try {
      channel = supabaseBrowser()
        .channel("btg-pipeline")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "sponsors" },
          scheduleRefresh,
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "outreach_logs" },
          scheduleRefresh,
        )
        .subscribe();
    } catch {
      // No anon key configured. The dashboard still works, just without
      // live updates from teammates.
    }

    return () => {
      if (pending.current) clearTimeout(pending.current);
      channel?.unsubscribe();
    };
  }, [scheduleRefresh]);

  /** Optimistic status change, rolled back if the server rejects it. */
  const setStatus = useCallback(
    async (id: string, status: SponsorStatus) => {
      const before = sponsors;
      setSponsors((rows) =>
        rows.map((r) => (r.id === id ? { ...r, status } : r)),
      );

      const res = await fetch(`/api/sponsors/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        setSponsors(before);
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not update status");
      }
    },
    [sponsors],
  );

  const bulk = useCallback(
    async (
      ids: string[],
      action: "status" | "delete",
      status?: SponsorStatus,
    ) => {
      const res = await fetch("/api/sponsors/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Bulk action failed");
      await refresh();
      return data;
    },
    [refresh],
  );

  return {
    sponsors,
    templates,
    loading,
    error,
    liveAt,
    refresh,
    setStatus,
    bulk,
    setError,
  };
}
