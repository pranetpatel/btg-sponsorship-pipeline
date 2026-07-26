export type SponsorStatus =
  | "new"
  | "contacted"
  | "interested"
  | "committed"
  | "declined";

export type SponsorCategory =
  | "corporate"
  | "small_business"
  | "nonprofit"
  | "supplier"
  | "alumni"
  | "other";

export type ResponseStatus =
  | "pending"
  | "no_response"
  | "replied"
  | "bounced"
  | "failed"
  | "unsubscribed";

export type Sponsor = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  category: SponsorCategory;
  industry: string | null;
  location: string | null;
  status: SponsorStatus;
  potential_value: number | null;
  contact_name: string | null;
  notes: string | null;
  source: string | null;
  custom_fields: Record<string, string>;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OutreachLog = {
  id: string;
  sponsor_id: string;
  outreach_type: string;
  template_used: string | null;
  template_id: string | null;
  subject: string | null;
  body: string | null;
  to_email: string | null;
  sent_by: string | null;
  provider_id: string | null;
  sent_at: string;
  opened: boolean;
  opened_at: string | null;
  open_count: number;
  clicked: boolean;
  clicked_at: string | null;
  click_count: number;
  response_status: ResponseStatus;
  error: string | null;
};

export type EmailTemplate = {
  id: string;
  slug: string;
  name: string;
  category: string;
  subject: string;
  body: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type ActivityEntry = {
  id: string;
  actor: string;
  action: string;
  sponsor_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

/** A sponsor row joined with its outreach rollup, as the dashboard uses it. */
export type SponsorWithStats = Sponsor & {
  outreach_count: number;
  last_outreach_at: string | null;
  ever_opened: boolean;
  ever_clicked: boolean;
  latest_response: ResponseStatus | null;
};
