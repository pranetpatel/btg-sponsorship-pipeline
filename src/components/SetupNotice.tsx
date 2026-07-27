/** Shown when Supabase env vars are missing, so the app never white-screens. */
export default function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-600">
        Be The Good UWO
      </p>
      <h1 className="mt-2 text-3xl font-bold text-purple-700">
        Almost there. Two keys to go.
      </h1>
      <p className="mt-3 text-purple-900/70">
        The dashboard needs a Supabase project before it can load. This takes
        about five minutes.
      </p>

      <ol className="mt-8 space-y-4">
        {[
          {
            title: "Create a Supabase project",
            body: "supabase.com, new project, free tier is plenty.",
          },
          {
            title: "Run the schema",
            body: "Open the SQL editor, paste all of supabase/schema.sql, run it. That creates the tables and the five email templates.",
          },
          {
            title: "Copy .env.example to .env.local",
            body: "Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY from Project Settings, API.",
          },
          {
            title: "Restart the dev server",
            body: "npm run dev. This page turns into the dashboard.",
          },
        ].map((step, i) => (
          <li key={step.title} className="btg-card flex gap-4 p-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-sm font-semibold text-white">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-purple-800">{step.title}</p>
              <p className="mt-0.5 text-sm text-purple-900/65">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-sm text-purple-900/55">
        Email sending needs RESEND_API_KEY and RESEND_FROM as well. You can add
        those after the dashboard is up. Full walkthrough is in README.md.
      </p>
    </main>
  );
}
