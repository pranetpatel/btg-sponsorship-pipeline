"use client";

import { useMemo } from "react";
import { STATUSES, STATUS_META, money } from "@/lib/constants";
import type { SponsorWithStats } from "@/lib/types";

export default function StatsBar({
  sponsors,
}: {
  sponsors: SponsorWithStats[];
}) {
  const s = useMemo(() => {
    const byStatus = Object.fromEntries(
      STATUSES.map((st) => [st, sponsors.filter((x) => x.status === st).length]),
    ) as Record<(typeof STATUSES)[number], number>;

    const reached = sponsors.filter((x) => x.outreach_count > 0);
    const opened = reached.filter((x) => x.ever_opened).length;
    const clicked = reached.filter((x) => x.ever_clicked).length;
    const committedValue = sponsors
      .filter((x) => x.status === "committed")
      .reduce((sum, x) => sum + Number(x.potential_value ?? 0), 0);
    const pipelineValue = sponsors
      .filter((x) => x.status === "interested" || x.status === "contacted")
      .reduce((sum, x) => sum + Number(x.potential_value ?? 0), 0);

    return {
      total: sponsors.length,
      byStatus,
      emailable: sponsors.filter((x) => x.email).length,
      reached: reached.length,
      opened,
      clicked,
      openRate: reached.length ? Math.round((opened / reached.length) * 100) : 0,
      committedValue,
      pipelineValue,
      winRate: reached.length
        ? Math.round((byStatus.committed / reached.length) * 100)
        : 0,
    };
  }, [sponsors]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Sponsors"
          value={String(s.total)}
          sub={`${s.emailable} with an email`}
        />
        <Tile
          label="Contacted"
          value={String(s.reached)}
          sub={
            s.total ? `${Math.round((s.reached / s.total) * 100)}% of the list` : "None yet"
          }
        />
        <Tile
          label="Open rate"
          value={`${s.openRate}%`}
          sub={`${s.opened} opened, ${s.clicked} clicked`}
          accent
        />
        <Tile
          label="Committed"
          value={money(s.committedValue)}
          sub={`${money(s.pipelineValue)} still in play`}
          accent
        />
      </div>

      {/* Conversion funnel. Bars are scaled against the widest stage so a
          small pipeline still reads clearly. */}
      <div className="btg-card p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-purple-800">Funnel</h2>
          <span className="text-xs text-purple-900/50">
            {s.winRate}% of contacted sponsors committed
          </span>
        </div>
        <div className="space-y-2">
          {STATUSES.map((status) => {
            const count = s.byStatus[status];
            const max = Math.max(...Object.values(s.byStatus), 1);
            return (
              <div key={status} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs font-medium text-purple-900/70">
                  {STATUS_META[status].label}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded-md bg-cream">
                  <div
                    className={`h-full rounded-md transition-all duration-500 ${STATUS_META[status].dot}`}
                    style={{ width: `${Math.max((count / max) * 100, count ? 3 : 0)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-purple-800">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="btg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-900/50">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          accent ? "text-gold-700" : "text-purple-700"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-purple-900/55">{sub}</p>
    </div>
  );
}
