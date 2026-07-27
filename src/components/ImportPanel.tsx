"use client";

import { useState } from "react";
import { Download, Globe, Upload } from "lucide-react";
import Modal from "./Modal";
import {
  CONTACT_RULES,
  SCRAPE_GROUPS,
  type ContactRule,
  type ScrapeGroup,
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

/* ── Lead discovery ──────────────────────────────────────────────────── */

function ScrapeTab({ onDone }: { onDone: () => void }) {
  const [groups, setGroups] = useState<Set<ScrapeGroup>>(
    new Set<ScrapeGroup>(["local_business"]),
  );
  const [limit, setLimit] = useState(60);
  const [findEmails, setFindEmails] = useState(true);
  const [localOnly, setLocalOnly] = useState(true);
  const [contactRule, setContactRule] = useState<ContactRule>("email_or_phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    scanned: number;
    chainsSkipped: number;
    noContactSkipped: number;
    found: number;
    imported: number;
    skipped: number;
    emailsFound: number;
    withEmail: number;
  } | null>(null);

  function toggle(g: ScrapeGroup) {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
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
          groups: [...groups],
          limit,
          findEmails,
          localOnly,
          contactRule,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lead search failed");
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
        Pulls businesses and organizations around London, Ontario from
        OpenStreetMap, screens out chains, hunts down a contact email on each
        website, and drops anything you would have no way to reach. Duplicates
        are matched on email and skipped.
      </p>
      <p className="rounded-lg bg-cream-dark/50 px-3 py-2.5 text-sm text-purple-900/70">
        Worth knowing before you set the number: OpenStreetMap is thin on
        contact details. Of the London businesses listed there, about 18% have
        a website, 17% a phone number, and only 1% an email — the rest are
        just a name on a map. Searching websites is what turns most of the
        first group into real addresses. Asking for 60 and getting 25 is
        normal, and those 25 are ones you can actually write to.
      </p>

      <div>
        <p className="btg-label">What to look for</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCRAPE_GROUPS.map((g) => (
            <label
              key={g.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition ${
                groups.has(g.value)
                  ? "border-purple-400 bg-purple-50"
                  : "border-cream-dark bg-white hover:border-purple-200"
              }`}
            >
              <input
                type="checkbox"
                checked={groups.has(g.value)}
                onChange={() => toggle(g.value)}
                className="mt-0.5 h-4 w-4 accent-[#4F2683]"
              />
              <span>
                <span className="block text-sm font-medium text-purple-800">
                  {g.label}
                </span>
                <span className="block text-xs text-purple-900/55">
                  {g.hint}
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

      <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <label className="flex items-center gap-2.5 self-end pb-1 text-sm text-purple-900/75">
          <input
            type="checkbox"
            checked={findEmails}
            onChange={(e) => setFindEmails(e.target.checked)}
            className="h-4 w-4 accent-[#4F2683]"
          />
          Search websites for emails (slower, finds most of them)
        </label>
      </div>

      {!findEmails && contactRule === "email" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Requiring an email without searching websites will find almost
          nothing — OpenStreetMap itself carries an email for very few
          businesses. Turn the website search back on.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-1.5 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
          <p className="font-medium">
            Added {result.imported} new{" "}
            {result.imported === 1 ? "sponsor" : "sponsors"}, {result.withEmail}{" "}
            of them with an email.
          </p>
          <p className="text-emerald-900/70">
            Looked at {result.scanned} listings.
            {result.chainsSkipped
              ? ` Passed on ${result.chainsSkipped} chain ${
                  result.chainsSkipped === 1 ? "location" : "locations"
                }.`
              : ""}
            {result.noContactSkipped
              ? ` Passed on ${result.noContactSkipped} with no way to reach them.`
              : ""}
            {result.skipped
              ? ` ${result.skipped} were already on your list.`
              : ""}
            {result.emailsFound
              ? ` ${result.emailsFound} emails came off the businesses' own websites.`
              : ""}
          </p>
        </div>
      )}

      <button
        onClick={run}
        disabled={busy || !groups.size}
        className="btg-btn-primary w-full"
      >
        <Globe size={15} />
        {busy ? "Searching, this takes a minute" : "Find leads"}
      </button>
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
