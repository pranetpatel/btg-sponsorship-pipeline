"use client";

import { CATEGORY_LABEL, money } from "@/lib/constants";
import type { SponsorCategory, SponsorWithStats } from "@/lib/types";
import { Eye, MousePointerClick, Mail, MailX } from "lucide-react";

export default function SponsorCard({
  sponsor,
  selected,
  onToggle,
  onOpen,
  dragging,
}: {
  sponsor: SponsorWithStats;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  dragging?: boolean;
}) {
  return (
    <div
      className={`btg-card p-3 transition ${
        dragging ? "rotate-1 shadow-lg" : "hover:shadow-md"
      } ${selected ? "ring-2 ring-purple-400" : ""}`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#4F2683]"
          aria-label={`Select ${sponsor.name}`}
        />

        <button
          type="button"
          onClick={onOpen}
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-purple-800">
            {sponsor.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-purple-900/55">
            {CATEGORY_LABEL[sponsor.category as SponsorCategory] ??
              sponsor.category}
            {sponsor.industry ? ` · ${sponsor.industry}` : ""}
          </p>
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-6">
        {Number(sponsor.potential_value) > 0 && (
          <span className="btg-chip bg-gold-100 text-gold-700 ring-gold-300/50">
            {money(sponsor.potential_value)}
          </span>
        )}

        {sponsor.email ? (
          sponsor.outreach_count > 0 ? (
            <span className="btg-chip bg-purple-50 text-purple-700 ring-purple-200">
              <Mail size={11} />
              {sponsor.outreach_count}
            </span>
          ) : null
        ) : (
          <span className="btg-chip bg-rose-50 text-rose-600 ring-rose-200">
            <MailX size={11} />
            no email
          </span>
        )}

        {sponsor.ever_opened && (
          <span className="btg-chip bg-emerald-50 text-emerald-700 ring-emerald-200">
            <Eye size={11} />
            opened
          </span>
        )}
        {sponsor.ever_clicked && (
          <span className="btg-chip bg-emerald-100 text-emerald-800 ring-emerald-300">
            <MousePointerClick size={11} />
            clicked
          </span>
        )}
        {sponsor.latest_response === "replied" && (
          <span className="btg-chip bg-emerald-600 text-white ring-emerald-700">
            replied
          </span>
        )}
        {sponsor.latest_response === "bounced" && (
          <span className="btg-chip bg-rose-100 text-rose-700 ring-rose-200">
            bounced
          </span>
        )}
      </div>
    </div>
  );
}
