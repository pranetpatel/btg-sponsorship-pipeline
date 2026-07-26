import { NextRequest, NextResponse } from "next/server";
import { ok, fail } from "@/lib/api";
import { checkPassword, makeSessionToken, TEAM_COOKIE } from "@/lib/session";
import { logActivity } from "@/lib/activity";
import { supabaseConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { name, password } = (await req.json()) as {
    name?: string;
    password?: string;
  };

  const trimmed = (name ?? "").trim();
  if (!trimmed) return fail("Enter your name so the team knows who sent what");
  if (trimmed.length > 60) return fail("That name is too long");
  if (!checkPassword(password ?? "")) return fail("Wrong team password", 401);

  const res = NextResponse.json({ name: trimmed });
  res.cookies.set(TEAM_COOKIE, makeSessionToken(trimmed), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  if (supabaseConfigured()) {
    await logActivity({ actor: trimmed, action: "team.signed_in" });
  }

  return res;
}

export async function DELETE() {
  const res = ok({ signedOut: true });
  res.cookies.set(TEAM_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
