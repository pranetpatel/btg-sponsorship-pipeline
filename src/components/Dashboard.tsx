"use client";

import { useMemo, useState } from "react";
import {
  Columns3,
  Download,
  FileText,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Send,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  ORG,
  STATUSES,
  STATUS_META,
  chainBrand,
} from "@/lib/constants";
import type { SponsorStatus } from "@/lib/types";
import { usePipeline } from "./usePipeline";
import StatsBar from "./StatsBar";
import KanbanBoard from "./KanbanBoard";
import SponsorTable from "./SponsorTable";
import EmailComposer from "./EmailComposer";
import ImportPanel from "./ImportPanel";
import TemplateEditor from "./TemplateEditor";
import SponsorDrawer from "./SponsorDrawer";

type View = "kanban" | "table";
type Panel = "compose" | "import" | "templates" | null;

export default function Dashboard({
  member,
  emailReady,
}: {
  member: string;
  emailReady: boolean;
}) {
  const { sponsors, templates, loading, error, refresh, setStatus, bulk, setError } =
    usePipeline();

  const [view, setView] = useState<View>("kanban");
  const [panel, setPanel] = useState<Panel>(null);
  const [openSponsor, setOpenSponsor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<SponsorStatus>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());
  const [onlyEmailable, setOnlyEmailable] = useState(false);
  const [hideChains, setHideChains] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sponsors.filter((s) => {
      if (statusFilter.size && !statusFilter.has(s.status)) return false;
      if (categoryFilter.size && !categoryFilter.has(s.category)) return false;
      if (onlyEmailable && !s.email) return false;
      if (hideChains && chainBrand(s)) return false;
      if (!q) return true;
      return [s.name, s.email, s.contact_name, s.industry, s.notes, s.location]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q));
    });
  }, [sponsors, search, statusFilter, categoryFilter, onlyEmailable, hideChains]);

  // Selections survive filter changes, but the action bar only ever acts on
  // sponsors currently visible, so nothing hidden gets emailed by surprise.
  const selectedVisible = useMemo(
    () => filtered.filter((s) => selected.has(s.id)),
    [filtered, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleFilter<T>(set: Set<T>, apply: (s: Set<T>) => void, value: T) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.reload();
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (statusFilter.size) params.set("status", [...statusFilter].join(","));
    if (categoryFilter.size) params.set("category", [...categoryFilter].join(","));
    window.location.href = `/api/export?${params}`;
  }

  const filtersOn =
    statusFilter.size > 0 ||
    categoryFilter.size > 0 ||
    onlyEmailable ||
    hideChains ||
    search.length > 0;

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-30 border-b border-cream-dark bg-cream/85 backdrop-blur">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-gold-600">
              {ORG.fullName}
            </p>
            <h1 className="text-lg font-bold leading-tight text-purple-700">
              Sponsor pipeline
            </h1>
          </div>

          <button onClick={() => setPanel("import")} className="btg-btn-gold">
            <Plus size={15} />
            Add sponsors
          </button>
          <button onClick={() => setPanel("templates")} className="btg-btn-ghost">
            <FileText size={15} />
            Templates
          </button>
          <button onClick={exportCsv} className="btg-btn-ghost">
            <Download size={15} />
            Export
          </button>
          <button
            onClick={refresh}
            className="btg-btn-ghost px-2"
            aria-label="Refresh"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>

          <div className="flex items-center gap-2 border-l border-cream-dark pl-3">
            <span className="text-sm font-medium text-purple-800">{member}</span>
            <button
              onClick={signOut}
              className="rounded-lg p-1.5 text-purple-900/45 transition hover:bg-cream-dark hover:text-purple-700"
              aria-label="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[100rem] space-y-4 px-4 py-5">
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}

        <StatsBar sponsors={sponsors} />

        {/* Filters + view switch */}
        <div className="btg-card flex flex-wrap items-center gap-2 p-2.5">
          <div className="relative min-w-[13rem] flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-purple-900/35"
            />
            <input
              className="btg-input pl-8"
              placeholder="Search name, email, contact, notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => toggleFilter(statusFilter, setStatusFilter, s)}
                className={`btg-chip transition ${
                  statusFilter.has(s)
                    ? STATUS_META[s].chip
                    : "bg-white text-purple-900/50 ring-cream-dark hover:text-purple-700"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s].dot}`} />
                {STATUS_META[s].label}
              </button>
            ))}
          </div>

          <select
            className="btg-input w-auto"
            value=""
            onChange={(e) =>
              e.target.value &&
              toggleFilter(categoryFilter, setCategoryFilter, e.target.value)
            }
            aria-label="Filter by category"
          >
            <option value="">Category</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryFilter.has(c) ? "✓ " : ""}
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-purple-900/70">
            <input
              type="checkbox"
              checked={onlyEmailable}
              onChange={(e) => setOnlyEmailable(e.target.checked)}
              className="h-4 w-4 accent-[#4F2683]"
            />
            Has email
          </label>

          <label
            className="flex items-center gap-1.5 whitespace-nowrap text-sm text-purple-900/70"
            title="Hides anything tagged as a chain or franchise location"
          >
            <input
              type="checkbox"
              checked={hideChains}
              onChange={(e) => setHideChains(e.target.checked)}
              className="h-4 w-4 accent-[#4F2683]"
            />
            Hide chains
          </label>

          {filtersOn && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter(new Set());
                setCategoryFilter(new Set());
                setOnlyEmailable(false);
                setHideChains(false);
              }}
              className="text-sm text-purple-900/50 underline-offset-2 hover:text-purple-700 hover:underline"
            >
              Clear
            </button>
          )}

          <div className="ml-auto flex gap-1 rounded-lg bg-cream-dark/50 p-0.5">
            {(
              [
                ["kanban", Columns3, "Board"],
                ["table", Table2, "Table"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
                  view === key
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-purple-900/55 hover:text-purple-700"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {categoryFilter.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {[...categoryFilter].map((c) => (
              <button
                key={c}
                onClick={() => toggleFilter(categoryFilter, setCategoryFilter, c)}
                className="btg-chip bg-purple-100 text-purple-800 ring-purple-200"
              >
                {CATEGORY_LABEL[c as (typeof CATEGORIES)[number]] ?? c}
                <X size={11} />
              </button>
            ))}
          </div>
        )}

        {loading && !sponsors.length ? (
          <p className="py-20 text-center text-sm text-purple-900/45">
            Loading the pipeline
          </p>
        ) : !sponsors.length ? (
          <EmptyState onAdd={() => setPanel("import")} />
        ) : view === "kanban" ? (
          <KanbanBoard
            sponsors={filtered}
            selected={selected}
            onToggle={toggle}
            onOpen={setOpenSponsor}
            onStatusChange={setStatus}
          />
        ) : (
          <SponsorTable
            sponsors={filtered}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onOpen={setOpenSponsor}
            onStatusChange={setStatus}
          />
        )}

        {sponsors.length > 0 && (
          <p className="text-center text-xs text-purple-900/40">
            Showing {filtered.length} of {sponsors.length} sponsors. Changes sync
            to everyone on the team automatically.
          </p>
        )}
      </main>

      {/* Bulk action bar */}
      {selectedVisible.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-dark bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-2 px-4 py-3">
            <span className="mr-auto text-sm font-medium text-purple-800">
              {selectedVisible.length} selected
              <span className="ml-2 font-normal text-purple-900/50">
                {selectedVisible.filter((s) => s.email).length} can be emailed
              </span>
            </span>

            <select
              className="btg-input w-auto"
              value=""
              onChange={async (e) => {
                if (!e.target.value) return;
                await bulk(
                  selectedVisible.map((s) => s.id),
                  "status",
                  e.target.value as SponsorStatus,
                );
                setSelected(new Set());
              }}
              aria-label="Move selected to status"
            >
              <option value="">Move to…</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>

            <button
              onClick={async () => {
                if (
                  !confirm(`Delete ${selectedVisible.length} sponsors? This cannot be undone.`)
                )
                  return;
                await bulk(selectedVisible.map((s) => s.id), "delete");
                setSelected(new Set());
              }}
              className="btg-btn border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
            >
              <Trash2 size={15} />
              Delete
            </button>

            <button onClick={() => setSelected(new Set())} className="btg-btn-ghost">
              Clear
            </button>

            <button
              onClick={() => setPanel("compose")}
              disabled={!selectedVisible.some((s) => s.email)}
              className="btg-btn-primary"
            >
              <Send size={15} />
              Send email
            </button>
          </div>
        </div>
      )}

      {panel === "compose" && (
        <EmailComposer
          sponsors={selectedVisible}
          templates={templates}
          emailReady={emailReady}
          onClose={() => setPanel(null)}
          onSent={() => {
            setSelected(new Set());
            refresh();
          }}
        />
      )}

      {panel === "import" && (
        <ImportPanel onClose={() => setPanel(null)} onDone={refresh} />
      )}

      {panel === "templates" && (
        <TemplateEditor
          templates={templates}
          onClose={() => setPanel(null)}
          onChanged={refresh}
        />
      )}

      {openSponsor && (
        <SponsorDrawer
          sponsorId={openSponsor}
          onClose={() => setOpenSponsor(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="btg-card px-6 py-16 text-center">
      <h2 className="text-xl font-bold text-purple-700">No sponsors yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-purple-900/60">
        Pull a batch of London businesses automatically, or upload a CSV you
        already have. Then select a few, pick a template, and send.
      </p>
      <button onClick={onAdd} className="btg-btn-primary mx-auto mt-5">
        <Plus size={15} />
        Add your first sponsors
      </button>
    </div>
  );
}
