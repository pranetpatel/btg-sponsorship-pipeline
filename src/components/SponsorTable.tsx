"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { CATEGORY_LABEL, STATUSES, STATUS_META, money } from "@/lib/constants";
import type {
  SponsorCategory,
  SponsorStatus,
  SponsorWithStats,
} from "@/lib/types";

type SortKey =
  | "name"
  | "category"
  | "status"
  | "potential_value"
  | "outreach_count"
  | "last_outreach_at"
  | "created_at";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Sponsor" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
  { key: "potential_value", label: "Value", align: "right" },
  { key: "outreach_count", label: "Emails", align: "right" },
  { key: "last_outreach_at", label: "Last contact" },
];

export default function SponsorTable({
  sponsors,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onStatusChange,
}: {
  sponsors: SponsorWithStats[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  onOpen: (id: string) => void;
  onStatusChange: (id: string, status: SponsorStatus) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "created_at",
    dir: "desc",
  });

  const rows = useMemo(() => {
    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;

    return [...sponsors].sort((a, b) => {
      const av = a[key];
      const bv = b[key];

      // Nulls always sink to the bottom regardless of direction, so an
      // unsorted "last contact" column does not bury the useful rows.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * factor;
      }
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [sponsors, sort]);

  const allIds = rows.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "category" ? "asc" : "desc" },
    );
  }

  return (
    <div className="btg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[54rem] text-sm">
          <thead>
            <tr className="border-b border-cream-dark bg-cream/60">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(allIds, e.target.checked)}
                  className="h-4 w-4 accent-[#4F2683]"
                  aria-label="Select all rows"
                />
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2.5 font-semibold text-purple-900/70 ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={`inline-flex items-center gap-1 transition hover:text-purple-700 ${
                      col.align === "right" ? "flex-row-reverse" : ""
                    }`}
                  >
                    {col.label}
                    {sort.key === col.key ? (
                      sort.dir === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )
                    ) : (
                      <ChevronsUpDown size={12} className="opacity-30" />
                    )}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2.5 text-left font-semibold text-purple-900/70">
                Tracking
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-cream-dark/60 transition-colors hover:bg-cream/50 ${
                  selected.has(s.id) ? "bg-purple-50/60" : ""
                }`}
              >
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => onToggle(s.id)}
                    className="h-4 w-4 accent-[#4F2683]"
                    aria-label={`Select ${s.name}`}
                  />
                </td>

                <td className="max-w-[16rem] px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onOpen(s.id)}
                    className="block max-w-full truncate text-left font-medium text-purple-800 hover:underline"
                  >
                    {s.name}
                  </button>
                  <span className="block max-w-full truncate text-xs text-purple-900/50">
                    {s.email ?? "no email on file"}
                  </span>
                </td>

                <td className="px-3 py-2.5 text-purple-900/70">
                  {CATEGORY_LABEL[s.category as SponsorCategory] ?? s.category}
                </td>

                <td className="px-3 py-2.5">
                  <select
                    value={s.status}
                    onChange={(e) =>
                      onStatusChange(s.id, e.target.value as SponsorStatus)
                    }
                    className={`btg-chip cursor-pointer appearance-none pr-1.5 ${STATUS_META[s.status].chip}`}
                    aria-label={`Status for ${s.name}`}
                  >
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_META[st].label}
                      </option>
                    ))}
                  </select>
                </td>

                <td className="px-3 py-2.5 text-right tabular-nums text-purple-900/70">
                  {Number(s.potential_value) > 0 ? money(s.potential_value) : "—"}
                </td>

                <td className="px-3 py-2.5 text-right tabular-nums text-purple-900/70">
                  {s.outreach_count || "—"}
                </td>

                <td className="px-3 py-2.5 text-purple-900/60">
                  {s.last_outreach_at
                    ? new Date(s.last_outreach_at).toLocaleDateString("en-CA")
                    : "—"}
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex gap-1">
                    {s.ever_opened && (
                      <span className="btg-chip bg-emerald-50 text-emerald-700 ring-emerald-200">
                        opened
                      </span>
                    )}
                    {s.ever_clicked && (
                      <span className="btg-chip bg-emerald-100 text-emerald-800 ring-emerald-300">
                        clicked
                      </span>
                    )}
                    {s.latest_response === "replied" && (
                      <span className="btg-chip bg-emerald-600 text-white ring-emerald-700">
                        replied
                      </span>
                    )}
                    {!s.outreach_count && (
                      <span className="text-xs text-purple-900/35">
                        not contacted
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!rows.length && (
        <p className="px-4 py-10 text-center text-sm text-purple-900/45">
          No sponsors match those filters.
        </p>
      )}
    </div>
  );
}
