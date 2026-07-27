"use client";

import { useState } from "react";

export default function SignIn() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, password }),
    });

    if (res.ok) {
      window.location.reload();
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Could not sign in");
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="btg-card w-full max-w-sm p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">
          Be The Good UWO
        </p>
        <h1 className="mt-1.5 text-2xl font-bold text-purple-700">
          Sponsor pipeline
        </h1>
        <p className="mt-2 text-sm text-purple-900/60">
          Your name goes on every email you send and every change you make, so
          the team knows who did what.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="btg-label" htmlFor="name">
              Your name
            </label>
            <input
              id="name"
              className="btg-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Arpi"
              autoComplete="name"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="btg-label" htmlFor="password">
              Team password
            </label>
            <input
              id="password"
              type="password"
              className="btg-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Shared with the exec team"
              autoComplete="current-password"
            />
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="btg-btn-primary mt-6 w-full"
        >
          {busy ? "Signing in" : "Open the dashboard"}
        </button>
      </form>
    </main>
  );
}
