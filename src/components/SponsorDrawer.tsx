"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  Mail,
  MousePointerClick,
  Phone,
  Globe,
  Trash2,
  Save,
} from "lucide-react";
import Modal from "./Modal";
import { CATEGORIES, CATEGORY_LABEL, STATUSES, STATUS_META } from "@/lib/constants";
import type { OutreachLog, Sponsor } from "@/lib/types";

export default function SponsorDrawer({
  sponsorId,
  onClose,
  onChanged,
}: {
  sponsorId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [sponsor, setSponsor] = useState<Sponsor | null>(null);
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [draft, setDraft] = useState<Partial<Sponsor>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/sponsors/${sponsorId}`, {
        cache: "no-store",
      });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      setSponsor(data.sponsor);
      setLogs(data.logs ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [sponsorId]);

  function edit<K extends keyof Sponsor>(key: K, value: Sponsor[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const value = <K extends keyof Sponsor>(key: K) =>
    (draft[key] ?? sponsor?.[key] ?? "") as string;

  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sponsors/${sponsorId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setSponsor(data.sponsor);
      setDraft({});
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${sponsor?.name}? This also removes its email history.`))
      return;
    setBusy(true);
    const res = await fetch(`/api/sponsors/${sponsorId}`, { method: "DELETE" });
    if (res.ok) {
      onChanged();
      onClose();
    } else {
      setError("Could not delete");
      setBusy(false);
    }
  }

  async function markResponse(logId: string, response_status: string) {
    await fetch(`/api/outreach/${logId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ response_status }),
    });
    setLogs((rows) =>
      rows.map((r) =>
        r.id === logId
          ? { ...r, response_status: response_status as OutreachLog["response_status"] }
          : r,
      ),
    );
    onChanged();
  }

  if (!sponsor) {
    return (
      <Modal title="Loading" onClose={onClose}>
        <p className="py-8 text-center text-sm text-purple-900/45">
          Fetching sponsor
        </p>
      </Modal>
    );
  }

  return (
    <Modal title={sponsor.name} subtitle={sponsor.location ?? undefined} onClose={onClose} wide>
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        {/* Details */}
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Text label="Name" value={value("name")} onChange={(v) => edit("name", v)} />
            <Text
              label="Contact person"
              value={value("contact_name")}
              onChange={(v) => edit("contact_name", v)}
            />
            <Text
              label="Email"
              value={value("email")}
              onChange={(v) => edit("email", v)}
              icon={<Mail size={12} />}
            />
            <Text
              label="Phone"
              value={value("phone")}
              onChange={(v) => edit("phone", v)}
              icon={<Phone size={12} />}
            />
            <Text
              label="Website"
              value={value("website")}
              onChange={(v) => edit("website", v)}
              icon={<Globe size={12} />}
            />
            <Text
              label="Industry"
              value={value("industry")}
              onChange={(v) => edit("industry", v)}
            />

            <div>
              <label className="btg-label">Status</label>
              <select
                className="btg-input"
                value={value("status")}
                onChange={(e) => edit("status", e.target.value as Sponsor["status"])}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="btg-label">Category</label>
              <select
                className="btg-input"
                value={value("category")}
                onChange={(e) =>
                  edit("category", e.target.value as Sponsor["category"])
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>

            <Text
              label="Potential value (CAD)"
              value={String(draft.potential_value ?? sponsor.potential_value ?? "")}
              onChange={(v) => edit("potential_value", Number(v) || 0)}
              type="number"
            />
          </div>

          <div>
            <label className="btg-label">Notes</label>
            <textarea
              rows={4}
              className="btg-input resize-y"
              value={value("notes")}
              onChange={(e) => edit("notes", e.target.value)}
              placeholder="Who you talked to, what they said, when to follow up"
            />
          </div>

          {sponsor.custom_fields &&
            Object.keys(sponsor.custom_fields).length > 0 && (
              <div className="rounded-lg bg-cream-dark/40 px-3 py-2.5">
                <p className="btg-label mb-1">From import</p>
                <dl className="space-y-0.5 text-sm">
                  {Object.entries(sponsor.custom_fields).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="text-purple-900/50">{k}</dt>
                      <dd className="text-purple-900/80">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !dirty}
              className="btg-btn-primary flex-1"
            >
              <Save size={15} />
              {busy ? "Saving" : dirty ? "Save changes" : "Saved"}
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="btg-btn border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
              aria-label="Delete sponsor"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>

        {/* Contact history */}
        <div>
          <h3 className="btg-label">Contact history</h3>

          {!logs.length && (
            <p className="rounded-lg border border-dashed border-cream-dark px-3 py-8 text-center text-sm text-purple-900/40">
              No outreach yet. Select this sponsor on the board and send a
              template.
            </p>
          )}

          <ol className="max-h-[30rem] space-y-2.5 overflow-y-auto pr-1">
            {logs.map((log) => (
              <li key={log.id} className="btg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-purple-800">
                      {log.subject}
                    </p>
                    <p className="text-xs text-purple-900/50">
                      {log.template_used} · sent by {log.sent_by} ·{" "}
                      {new Date(log.sent_at).toLocaleString("en-CA", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {log.opened ? (
                    <span className="btg-chip bg-emerald-50 text-emerald-700 ring-emerald-200">
                      <Eye size={11} />
                      opened {log.open_count > 1 ? `${log.open_count}x` : ""}
                    </span>
                  ) : (
                    <span className="btg-chip bg-cream-dark/60 text-purple-900/50 ring-transparent">
                      not opened yet
                    </span>
                  )}
                  {log.clicked && (
                    <span className="btg-chip bg-emerald-100 text-emerald-800 ring-emerald-300">
                      <MousePointerClick size={11} />
                      clicked
                    </span>
                  )}
                  {log.error && (
                    <span className="btg-chip bg-rose-50 text-rose-700 ring-rose-200">
                      {log.error.slice(0, 60)}
                    </span>
                  )}

                  <select
                    value={log.response_status}
                    onChange={(e) => markResponse(log.id, e.target.value)}
                    className="btg-chip ml-auto cursor-pointer bg-white text-purple-700 ring-cream-dark"
                    aria-label="Mark response"
                  >
                    <option value="pending">awaiting reply</option>
                    <option value="replied">replied</option>
                    <option value="no_response">no response</option>
                    <option value="bounced">bounced</option>
                    <option value="unsubscribed">unsubscribed</option>
                  </select>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
}

function Text({
  label,
  value,
  onChange,
  type = "text",
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="btg-label flex items-center gap-1">
        {icon}
        {label}
      </label>
      <input
        type={type}
        className="btg-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
