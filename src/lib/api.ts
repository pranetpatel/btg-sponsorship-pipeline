import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 });
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json({ error: message, extra }, { status });
}

/** Turns thrown errors (including requireTeam's 401) into JSON responses. */
export function handleError(err: unknown) {
  const e = err as Error & { status?: number };
  const status = e?.status ?? 500;
  if (status >= 500) console.error(e);
  return fail(e?.message ?? "Something went wrong", status);
}

export function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "http://localhost:3000"
  );
}
