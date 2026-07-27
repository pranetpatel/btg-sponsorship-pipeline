"use client";

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import Modal from "./Modal";
import type { EmailTemplate } from "@/lib/types";

const BLANK = {
  id: "",
  name: "New template",
  category: "other",
  subject: "",
  body: "",
  description: "",
} as Partial<EmailTemplate>;

export default function TemplateEditor({
  templates,
  onClose,
  onChanged,
}: {
  templates: EmailTemplate[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [activeId, setActiveId] = useState(templates[0]?.id ?? "");
  const [draft, setDraft] = useState<Partial<EmailTemplate> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = templates.find((t) => t.id === activeId);
  const current = draft ?? stored ?? BLANK;
  const isNew = !current.id;

  function select(id: string) {
    if (draft && !confirm("Discard your unsaved edits?")) return;
    setDraft(null);
    setActiveId(id);
  }

  function edit(patch: Partial<EmailTemplate>) {
    setDraft({ ...current, ...patch });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        isNew ? "/api/templates" : `/api/templates/${current.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: current.name,
            category: current.category,
            subject: current.subject,
            body: current.body,
            description: current.description,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setDraft(null);
      setActiveId(data.template.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!stored || !confirm(`Delete "${stored.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/templates/${stored.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Could not delete");
    else {
      setDraft(null);
      setActiveId(templates.find((t) => t.id !== stored.id)?.id ?? "");
      onChanged();
    }
    setBusy(false);
  }

  return (
    <Modal
      title="Email templates"
      subtitle="Edit the wording once and the whole team sends the same thing"
      onClose={onClose}
      wide
    >
      <div className="grid gap-5 sm:grid-cols-[13rem_1fr]">
        <aside className="space-y-1.5">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                t.id === activeId && !isNew
                  ? "bg-purple-600 text-white"
                  : "bg-white text-purple-800 hover:bg-purple-50"
              }`}
            >
              <span className="block truncate font-medium">{t.name}</span>
              {t.is_default && (
                <span
                  className={`text-xs ${
                    t.id === activeId && !isNew
                      ? "text-purple-200"
                      : "text-purple-900/45"
                  }`}
                >
                  built in
                </span>
              )}
            </button>
          ))}

          <button
            onClick={() => {
              setDraft(BLANK);
              setActiveId("");
            }}
            className="btg-btn-ghost w-full justify-start"
          >
            <Plus size={14} />
            New template
          </button>
        </aside>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="btg-label">Name</label>
              <input
                className="btg-input"
                value={current.name ?? ""}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </div>
            <div>
              <label className="btg-label">When to use it</label>
              <input
                className="btg-input"
                value={current.description ?? ""}
                onChange={(e) => edit({ description: e.target.value })}
                placeholder="Shown in the composer dropdown"
              />
            </div>
          </div>

          <div>
            <label className="btg-label">Subject</label>
            <input
              className="btg-input"
              value={current.subject ?? ""}
              onChange={(e) => edit({ subject: e.target.value })}
            />
          </div>

          <div>
            <label className="btg-label">Body</label>
            <textarea
              rows={15}
              className="btg-input resize-y leading-relaxed"
              value={current.body ?? ""}
              onChange={(e) => edit({ body: e.target.value })}
            />
          </div>

          <p className="rounded-lg bg-purple-50 px-3 py-2 text-xs text-purple-900/65">
            {"Placeholders: {{sponsor_name}} {{contact_name}} {{category}} {{industry}} {{location}} {{sender_name}}"}
          </p>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy || !draft || !current.subject || !current.body}
              className="btg-btn-primary flex-1"
            >
              <Save size={15} />
              {busy ? "Saving" : isNew ? "Create template" : "Save changes"}
            </button>
            {stored && !stored.is_default && (
              <button
                onClick={remove}
                disabled={busy}
                className="btg-btn border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                aria-label="Delete template"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
