import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Lightweight shared-password gate.
 *
 * The whole team signs in with one password (TEAM_PASSWORD) plus their own
 * name. The name is what gets stamped on every email and activity row, so
 * we always know who did what without making anyone create an account.
 *
 * Swap this for Supabase Auth later by replacing readTeamMember() — every
 * route already reads the actor through it.
 */

export const TEAM_COOKIE = "btg_team";

type TeamMember = { name: string };

function secret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.TEAM_PASSWORD ||
    "btg-dev-secret-change-me"
  );
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function makeSessionToken(name: string) {
  const payload = Buffer.from(JSON.stringify({ name, t: Date.now() })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token: string): TeamMember | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;

  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof parsed?.name !== "string" || !parsed.name.trim()) return null;
    return { name: parsed.name };
  } catch {
    return null;
  }
}

export function checkPassword(input: string) {
  const expected = process.env.TEAM_PASSWORD;
  // No password configured means the gate is open. Fine for local dev,
  // and the README calls out setting it before deploying.
  if (!expected) return true;
  const a = Buffer.from(input ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function readTeamMember(): Promise<TeamMember | null> {
  const jar = await cookies();
  const token = jar.get(TEAM_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Throws a 401-shaped error if the caller is not signed in. */
export async function requireTeam(): Promise<TeamMember> {
  const member = await readTeamMember();
  if (!member) {
    const err = new Error("Not signed in") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return member;
}
