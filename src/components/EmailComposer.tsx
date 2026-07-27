"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, Send, TriangleAlert, ChevronLeft, ChevronRight } from "lucide-react";
import Modal from "./Modal";
import { CATEGORY_DEFAULT_TEMPLATE } from "@/lib/constants";
import type {
  EmailTemplate,
  SponsorCategory,
  SponsorWithStats,
} from "@/lib/types";

type PreviewRow = {
  sponsorId: string;
  sponsorName: string;
  email: string | null;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  subject?: string;
  body?: string;
};

export default function EmailComposer({
  sponsors,
  templates,
  emailReady,
  onClose,
  onSent,
}: {
  sponsors: SponsorWithStats[];
  templates: EmailTemplate[];
  emailReady: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);

  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: number;
    skipped: number;
    failed: number;
    results: PreviewRow[];
  } | null>(null);

  const sendable = sponsors.filter((s) => s.email);
  const missingEmail = sponsors.length - sendable.length;

  // Preselect the template that matches whatever category dominates the
  // selection, so the common case is one click.
  const suggested = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sponsors) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const slug = CATEGORY_DEFAULT_TEMPLATE[top as SponsorCategory];
    return templates.find((t) => t.slug === slug) ?? templates[0];
  }, [sponsors, templates]);

  useEffect(() => {
    if (suggested && !templateId) applyTemplate(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  function applyTemplate(t: EmailTemplate) {
    setTemplateId(t.id);
    setSubject(t.subject);
    setBody(t.body);
    setEdited(false);
    setPreview(null);
  }

  function onPickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (
      edited &&
      !confirm("Switching templates will replace your edits. Continue?")
    ) {
      return;
    }
    applyTemplate(t);
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sponsorIds: sponsors.map((s) => s.id),
          templateId: edited ? undefined : templateId,
          subject,
          body,
          dryRun: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreview(data.results);
      setPreviewIndex(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sponsorIds: sponsors.map((s) => s.id),
          templateId: edited ? undefined : templateId,
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      setResult(data);
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ── Post-send summary ─────────────────────────────────────────────── */
  if (result) {
    const problems = result.results.filter((r) => r.status !== "sent");
    return (
      <Modal title="Outreach sent" onClose={onClose}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Sent" value={result.sent} tone="good" />
          <Stat label="Skipped" value={result.skipped} />
          <Stat label="Failed" value={result.failed} tone="bad" />
        </div>

        <p className="mt-4 text-sm text-purple-900/65">
          Everyone who was still marked New has moved to Contacted. Opens and
          clicks show up on their cards as they come in.
        </p>

        {problems.length > 0 && (
          <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-cream-dark bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-900/50">
              Not delivered
            </p>
            <ul className="space-y-1.5 text-sm">
              {problems.map((p) => (
                <li key={p.sponsorId} className="flex gap-2">
                  <span className="font-medium text-purple-800">
                    {p.sponsorName}
                  </span>
                  <span className="text-purple-900/55">{p.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button onClick={onClose} className="btg-btn-primary mt-5 w-full">
          Back to the board
        </button>
      </Modal>
    );
  }

  /* ── Preview mode ──────────────────────────────────────────────────── */
  if (preview) {
    const row = preview[previewIndex];
    return (
      <Modal
        title="Preview"
        subtitle={`${previewIndex + 1} of ${preview.length}, personalized for each sponsor`}
        onClose={() => setPreview(null)}
        wide
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-purple-800">
              {row.sponsorName}
            </p>
            <p className="truncate text-sm text-purple-900/55">
              {row.email ?? "no email on file"}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
              disabled={previewIndex === 0}
              className="btg-btn-ghost px-2"
              aria-label="Previous preview"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() =>
                setPreviewIndex((i) => Math.min(preview.length - 1, i + 1))
              }
              disabled={previewIndex === preview.length - 1}
              className="btg-btn-ghost px-2"
              aria-label="Next preview"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {row.status === "skipped" && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <TriangleAlert size={14} />
            {row.reason}. This one will be skipped.
          </p>
        )}

        <div className="rounded-lg border border-cream-dark bg-white">
          <p className="border-b border-cream-dark px-4 py-2.5 text-sm font-semibold text-purple-800">
            {row.subject}
          </p>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-sans text-sm leading-relaxed text-ink">
            {row.body}
          </pre>
        </div>

        <div className="mt-5 flex gap-2">
          <button onClick={() => setPreview(null)} className="btg-btn-ghost flex-1">
            Keep editing
          </button>
          <button
            onClick={send}
            disabled={busy || !emailReady || !sendable.length}
            className="btg-btn-primary flex-1"
          >
            <Send size={15} />
            {busy ? "Sending" : `Send to ${sendable.length}`}
          </button>
        </div>
        {error && <ErrorNote message={error} />}
      </Modal>
    );
  }

  /* ── Compose ───────────────────────────────────────────────────────── */
  return (
    <Modal
      title="Send outreach"
      subtitle={`${sponsors.length} sponsor${sponsors.length === 1 ? "" : "s"} selected`}
      onClose={onClose}
      wide
    >
      {!emailReady && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            Email is not configured yet. Add RESEND_API_KEY and RESEND_FROM to
            your environment. You can still preview what would go out.
          </span>
        </p>
      )}

      {missingEmail > 0 && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-cream-dark/60 px-3 py-2.5 text-sm text-purple-900/75">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <span>
            {missingEmail} of these have no email on file and will be skipped.{" "}
            {sendable.length} will receive this.
          </span>
        </p>
      )}

      <div className="space-y-4">
        <div>
          <label className="btg-label" htmlFor="template">
            Template
          </label>
          <select
            id="template"
            className="btg-input"
            value={templateId}
            onChange={(e) => onPickTemplate(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.description ? ` — ${t.description}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="btg-label" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            className="btg-input"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label className="btg-label" htmlFor="body">
              Message
            </label>
            {edited && (
              <span className="mb-1.5 text-xs text-gold-700">
                Edited for this send only
              </span>
            )}
          </div>
          <textarea
            id="body"
            rows={14}
            className="btg-input resize-y font-sans leading-relaxed"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setEdited(true);
            }}
          />
        </div>

        <div className="rounded-lg bg-purple-50 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-900/55">
            Placeholders
          </p>
          <p className="mt-1 text-sm text-purple-900/70">
            {"{{sponsor_name}} {{contact_name}} {{category}} {{industry}} {{location}} {{sender_name}}"}
          </p>
          <p className="mt-1 text-xs text-purple-900/50">
            Each one is filled in per sponsor. Missing fields fall back to
            something that still reads naturally.
          </p>
        </div>
      </div>

      {error && <ErrorNote message={error} />}

      <div className="mt-5 flex gap-2">
        <button
          onClick={runPreview}
          disabled={busy || !subject || !body}
          className="btg-btn-ghost flex-1"
        >
          <Eye size={15} />
          {busy ? "Working" : "Preview each one"}
        </button>
        <button
          onClick={send}
          disabled={busy || !emailReady || !sendable.length || !subject || !body}
          className="btg-btn-primary flex-1"
        >
          <Send size={15} />
          {busy ? "Sending" : `Send to ${sendable.length}`}
        </button>
      </div>
    </Modal>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-emerald-600"
      : tone === "bad" && value > 0
        ? "text-rose-600"
        : "text-purple-700";
  return (
    <div className="btg-card p-3 text-center">
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-purple-900/55">{label}</p>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}
