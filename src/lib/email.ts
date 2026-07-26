import { Resend } from "resend";
import { categoryLabel, ORG } from "./constants";
import type { Sponsor } from "./types";
import { appUrl } from "./api";

let cached: Resend | null = null;

export function resend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  if (!cached) cached = new Resend(key);
  return cached;
}

export function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/* ── Personalization ────────────────────────────────────────────────── */

export type TokenContext = {
  sponsor: Sponsor;
  senderName: string;
};

/**
 * Falls back to something that still reads like a real sentence when a
 * field is missing. "Hi there," beats "Hi ,".
 */
export function tokensFor({ sponsor, senderName }: TokenContext) {
  return {
    sponsor_name: sponsor.name || "your team",
    contact_name: sponsor.contact_name?.trim() || "there",
    category: categoryLabel(sponsor.category),
    industry: sponsor.industry || "your industry",
    location: sponsor.location || ORG.city,
    sender_name: senderName || ORG.fullName,
    org_name: ORG.fullName,
    org_instagram: ORG.instagram,
    org_handle: ORG.handle,
    ...Object.fromEntries(
      Object.entries(sponsor.custom_fields ?? {}).map(([k, v]) => [
        `custom_${k}`,
        String(v ?? ""),
      ]),
    ),
  } as Record<string, string>;
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function render(text: string, tokens: Record<string, string>) {
  return (text ?? "").replace(TOKEN, (whole, key: string) =>
    key in tokens ? tokens[key] : whole,
  );
}

/** Tokens present in a string, for the composer's "unfilled fields" warning. */
export function tokensUsed(text: string) {
  return [...(text ?? "").matchAll(TOKEN)].map((m) => m[1]);
}

/* ── HTML body + tracking ───────────────────────────────────────────── */

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/g;

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Plain-text body -> tracked HTML email.
 *
 * Links are rewritten through /api/track/click so we know who clicked, and
 * a 1x1 pixel at /api/track/open records opens. The log id is minted before
 * the send so both URLs can be baked in.
 */
export function buildHtml(bodyText: string, logId: string) {
  const base = appUrl();

  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((block) => {
      const withBreaks = escapeHtml(block.trim()).replace(/\n/g, "<br />");
      const linked = withBreaks.replace(URL_RE, (url) => {
        const tracked = `${base}/api/track/click/${logId}?url=${encodeURIComponent(url)}`;
        return `<a href="${tracked}" style="color:#4F2683;text-decoration:underline">${url}</a>`;
      });
      return `<p style="margin:0 0 16px;line-height:1.6">${linked}</p>`;
    })
    .join("");

  const pixel = `<img src="${base}/api/track/open/${logId}" width="1" height="1" alt="" style="display:block;border:0" />`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F7F3EC">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#1A1224">
    ${paragraphs}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #E5DED2;font-size:12px;color:#6B6478">
      ${escapeHtml(ORG.fullName)} &middot; Western University &middot;
      <a href="${base}/api/track/click/${logId}?url=${encodeURIComponent(ORG.instagram)}" style="color:#4F2683">${escapeHtml(ORG.handle)}</a>
    </div>
    ${pixel}
  </div>
</body></html>`;
}
