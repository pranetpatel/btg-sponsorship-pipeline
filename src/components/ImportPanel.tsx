"use client";

import { useState } from "react";
import { Download, Globe, RefreshCw, Upload } from "lucide-react";
import Modal from "./Modal";
import {
  CONTACT_RULES,
  LEAD_CATEGORIES,
  LEAD_SOURCE_OPTIONS,
  type ContactRule,
  type LeadCategory,
  type LeadSourceOption,
} from "@/lib/scrape-groups";

type Tab = "scrape" | "csv" | "manual";

export default function ImportPanel({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<Tab>("scrape");

  return (
    <Modal
      title="Add sponsors"
      subtitle="Pull leads automatically, upload a CSV, or add one by hand"
      onClose={onClose}
      wide
    >
      <div className="mb-5 flex gap-1 rounded-lg bg-cream-dark/50 p-1">
        {(
          [
            ["scrape", "Find leads", Globe],
            ["csv", "Upload CSV", Upload],
            ["manual", "Add one", Download],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === key
                ? "bg-white text-purple-700 shadow-sm"
                : "text-purple-900/55 hover:text-purple-700"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === "scrape" && <ScrapeTab onDone={onDone} />}
      {tab === "csv" && <CsvTab onDone={onDone} />}
      {tab === "manual" && <ManualTab onDone={onDone} onClose={onClose} />}
    </Modal>
  );
}

/* ── Pulling leads off the pool ───────────────────────────────────────── */

function ScrapeTab({ onDone }: { onDone: () => void }) {
  const [categories, setCategories] = useState<Set<LeadCategory>>(
    new Set<LeadCategory>(["small_business"]),
  );
  const [sources, setSources] = useState<Set<LeadSourceOption>>(new Set());
  const [limit, setLimit] = useState(60);
  const [localOnly, setLocalOnly] = useState(true);
  const [contactRule, setContactRule] = useState<ContactRule>("email_or_phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    withEmail: number;
    remaining: number;
    empty?: boolean;
  } | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{
    stages: { stage: string; detail: string }[];
    ranOutOfTime: boolean;
    stats: { total: number; local: number; withEmail: number };
  } | null>(null);

  async function refreshPool() {
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);
    try {
      const res = await fetch("/api/leads/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not refresh the pool");
      setRefreshResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleIn<T>(set: Set<T>, apply: (s: Set<T>) => void, value: T) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categories: [...categories],
          sources: sources.size ? [...sources] : undefined,
          limit,
          localOnly,
          contactRule,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not pull leads");
      setResult(data);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-purple-900/65">
        Pulls from the lead pool: London businesses gathered from Overture
        Maps, the Downtown London BIA directory, and the Chamber of Commerce,
        already screened for chains and already crawled for email addresses.
        Anything already on your board is skipped.
      </p>

      <div>
        <p className="btg-label">What kind of business</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {LEAD_CATEGORIES.map((c) => (
            <label
              key={c.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
                categories.has(c.value)
                  ? "border-purple-400 bg-purple-50"
                  : "border-cream-dark bg-white hover:border-purple-200"
              }`}
            >
              <input
                type="checkbox"
                checked={categories.has(c.value)}
                onChange={() => toggleIn(categories, setCategories, c.value)}
                className="mt-0.5 h-4 w-4 accent-[#4F2683]"
              />
              <span>
                <span className="block text-sm font-medium text-purple-800">
                  {c.label}
                </span>
                <span className="block text-xs text-purple-900/55">
                  {c.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="btg-label">
          Which list to draw from{" "}
          <span className="font-normal normal-case tracking-normal text-purple-900/45">
            — leave all off to use every source
          </span>
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {LEAD_SOURCE_OPTIONS.map((s) => (
            <label
              key={s.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
                sources.has(s.value)
                  ? "border-purple-400 bg-purple-50"
                  : "border-cream-dark bg-white hover:border-purple-200"
              }`}
            >
              <input
                type="checkbox"
                checked={sources.has(s.value)}
                onChange={() => toggleIn(sources, setSources, s.value)}
                className="mt-0.5 h-4 w-4 accent-[#4F2683]"
              />
              <span>
                <span className="block text-sm font-medium text-purple-800">
                  {s.label}
                </span>
                <span className="block text-xs text-purple-900/55">
                  {s.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="btg-label">Who to keep</p>
        <label
          className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
            localOnly
              ? "border-purple-400 bg-purple-50"
              : "border-cream-dark bg-white hover:border-purple-200"
          }`}
        >
          <input
            type="checkbox"
            checked={localOnly}
            onChange={(e) => setLocalOnly(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#4F2683]"
          />
          <span>
            <span className="block text-sm font-medium text-purple-800">
              Independent businesses only
            </span>
            <span className="block text-xs text-purple-900/55">
              Skips chains and franchises — TD, Metro, 7-Eleven, Tim Hortons —
              and anything with more than one location around London. A branch
              manager cannot approve a sponsorship anyway.
            </span>
          </span>
        </label>
      </div>

      <div>
        <p className="btg-label">Contact info required</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {CONTACT_RULES.map((r) => (
            <label
              key={r.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
                contactRule === r.value
                  ? "border-purple-400 bg-purple-50"
                  : "border-cream-dark bg-white hover:border-purple-200"
              }`}
            >
              <input
                type="radio"
                name="contact-rule"
                checked={contactRule === r.value}
                onChange={() => setContactRule(r.value)}
                className="mt-0.5 h-4 w-4 accent-[#4F2683]"
              />
              <span>
                <span className="block text-sm font-medium text-purple-800">
                  {r.label}
                </span>
                <span className="block text-xs text-purple-900/55">
                  {r.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="btg-label" htmlFor="limit">
          How many to add, up to {limit}
        </label>
        <input
          id="limit"
          type="range"
          min={10}
          max={200}
          step={10}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-full accent-[#4F2683]"
        />
        <p className="mt-1 text-xs text-purple-900/50">
          Leads with an email come first, so a small batch is still a workable
          one.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {result?.empty && (
        <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Nothing left in the pool matching those filters. Try loosening them,
          or refresh the pool below to go looking for more.
        </div>
      )}

      {result && !result.empty && (
        <div className="space-y-1.5 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <p className="font-medium">
            Added {result.imported} new{" "}
            {result.imported === 1 ? "sponsor" : "sponsors"}, {result.withEmail}{" "}
            of them with an email.
          </p>
          <p className="text-emerald-900/70">
            {result.skipped
              ? `${result.skipped} were already on your board. `
              : ""}
            {result.remaining.toLocaleString()} leads still in the pool under
            these filters.
          </p>
        </div>
      )}

      <button
        onClick={run}
        disabled={busy || !categories.size}
        className="btg-btn-primary w-full"
      >
        <Globe size={15} />
        {busy ? "Adding" : "Add leads from the pool"}
      </button>

      <div className="space-y-2 border-t border-cream-dark pt-4">
        {refreshResult && (
          <div className="space-y-1 rounded-lg bg-cream-dark/50 px-3 py-2.5 text-sm text-purple-900/75">
            {refreshResult.stages.map((s) => (
              <p key={s.stage}>
                <span className="font-medium text-purple-800">
                  {s.stage.replace(/_/g, " ")}
                </span>{" "}
                — {s.detail}
              </p>
            ))}
            <p className="pt-1 text-xs text-purple-900/55">
              Pool now holds {refreshResult.stats.total.toLocaleString()} leads,{" "}
              {refreshResult.stats.local.toLocaleString()} independent,{" "}
              {refreshResult.stats.withEmail.toLocaleString()} with an email.
              {refreshResult.ranOutOfTime
                ? " There was more to do than fits in one run — it picks up where it left off, so run it again or let tonight's scheduled refresh continue."
                : ""}
            </p>
          </div>
        )}

        <button
          onClick={refreshPool}
          disabled={refreshing}
          className="btg-btn-ghost w-full"
        >
          <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Looking for new leads" : "Refresh the pool"}
        </button>
        <p className="text-center text-xs text-purple-900/45">
          Re-reads the BIA and Chamber directories and hunts for more emails.
          Runs automatically overnight, so you rarely need this. Takes a few
          minutes.
        </p>
      </div>
    </div>
  );
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function CsvTab({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    rows: number;
    imported: number;
    updated: number;
    skipped: number;
  } | null>(null);

  async function upload() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      if (file) form.append("file", file);
      else form.append("text", text);

      const res = await fetch("/api/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-purple-900/65">
        Any CSV with a name column works. Common header spellings are matched
        automatically, and columns we do not recognize are kept as custom
        fields rather than dropped.
      </p>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-cream-dark bg-white px-4 py-8 text-center transition hover:border-purple-300 hover:bg-purple-50/40">
        <Upload size={22} className="text-purple-400" />
        <span className="text-sm font-medium text-purple-800">
          {file ? file.name : "Choose a CSV file"}
        </span>
        <span className="text-xs text-purple-900/50">
          name, email, phone, category, industry, location, value, contact,
          notes
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setText("");
          }}
        />
      </label>

      <div>
        <label className="btg-label" htmlFor="paste">
          Or paste rows
        </label>
        <textarea
          id="paste"
          rows={5}
          className="btg-input resize-y font-mono text-xs"
          placeholder={"name,email,category,potential_value\nJoe's Cafe,hello@joes.ca,small_business,250"}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFile(null);
          }}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          Read {result.rows} rows. Added {result.imported}, updated{" "}
          {result.updated}
          {result.skipped ? `, skipped ${result.skipped} without a name` : ""}.
        </div>
      )}

      <button
        onClick={upload}
        disabled={busy || (!file && !text.trim())}
        className="btg-btn-primary w-full"
      >
        {busy ? "Importing" : "Import"}
      </button>
    </div>
  );
}

/* ── Manual ──────────────────────────────────────────────────────────── */

function ManualTab({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch("/api/sponsors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Business name" required />
        <Field name="contact_name" label="Contact person" />
        <Field name="email" label="Email" type="email" />
        <Field name="phone" label="Phone" />
        <Field name="website" label="Website" />
        <Field name="industry" label="Industry" />
        <div>
          <label className="btg-label" htmlFor="category">
            Category
          </label>
          <select id="category" name="category" className="btg-input" defaultValue="small_business">
            <option value="corporate">Corporate</option>
            <option value="small_business">Small business</option>
            <option value="nonprofit">Nonprofit</option>
            <option value="supplier">Supplier</option>
            <option value="alumni">Alumni</option>
            <option value="other">Other</option>
          </select>
        </div>
        <Field
          name="potential_value"
          label="Potential value (CAD)"
          type="number"
        />
      </div>

      <div>
        <label className="btg-label" htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={3} className="btg-input resize-y" />
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btg-btn-primary w-full">
        {busy ? "Saving" : "Add sponsor"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="btg-label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="btg-input"
      />
    </div>
  );
}
