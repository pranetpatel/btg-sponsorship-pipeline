import type { VercelConfig } from "@vercel/config/v1";

/**
 * Deployment config.
 *
 * The cron keeps the lead pool current without anyone opening a terminal.
 * It calls the same endpoint the "Refresh pool" button does, and each run
 * picks up wherever the last one ran out of time, so the first few nights
 * work through the backlog and after that it just tracks what changed.
 *
 * Requires CRON_SECRET in the project's environment — the route rejects the
 * cron path outright when it is unset, so the endpoint is never open.
 *
 * Note for Hobby projects: Vercel allows one cron job running once a day,
 * which is what this is. Overture is not included; it is far too heavy for
 * a function and stays a local job (npm run leads:refresh).
 */
export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/leads/refresh",
      // 07:15 UTC, a little after 3am in London, Ontario.
      schedule: "15 7 * * *",
    },
  ],
};

export default config;
