import type { SponsorCategory, SponsorStatus } from "./types";

/** Kanban column order. Also the funnel order for the conversion chart. */
export const STATUSES: SponsorStatus[] = [
  "new",
  "contacted",
  "interested",
  "committed",
  "declined",
];

export const STATUS_META: Record<
  SponsorStatus,
  { label: string; dot: string; chip: string; column: string }
> = {
  new: {
    label: "New",
    dot: "bg-slate-400",
    chip: "bg-slate-100 text-slate-700 ring-slate-200",
    column: "border-slate-300",
  },
  contacted: {
    label: "Contacted",
    dot: "bg-purple-500",
    chip: "bg-purple-100 text-purple-800 ring-purple-200",
    column: "border-purple-300",
  },
  interested: {
    label: "Interested",
    dot: "bg-amber-500",
    chip: "bg-amber-100 text-amber-800 ring-amber-200",
    column: "border-amber-300",
  },
  committed: {
    label: "Committed",
    dot: "bg-emerald-500",
    chip: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    column: "border-emerald-300",
  },
  declined: {
    label: "Declined",
    dot: "bg-rose-400",
    chip: "bg-rose-100 text-rose-700 ring-rose-200",
    column: "border-rose-200",
  },
};

export const CATEGORIES: SponsorCategory[] = [
  "corporate",
  "small_business",
  "nonprofit",
  "supplier",
  "alumni",
  "other",
];

export const CATEGORY_LABEL: Record<SponsorCategory, string> = {
  corporate: "Corporate",
  small_business: "Small business",
  nonprofit: "Nonprofit",
  supplier: "Supplier",
  alumni: "Alumni",
  other: "Other",
};

/** Which template we preselect for a given sponsor category. */
export const CATEGORY_DEFAULT_TEMPLATE: Record<SponsorCategory, string> = {
  corporate: "corporate-sponsorship",
  small_business: "small-business-partnership",
  nonprofit: "nonprofit-collaboration",
  supplier: "supply-donation",
  alumni: "corporate-sponsorship",
  other: "small-business-partnership",
};

export const ORG = {
  name: "Be The Good",
  fullName: "Be The Good UWO",
  instagram: "https://www.instagram.com/bethegooduwo/",
  handle: "@bethegooduwo",
  city: "London, ON",
};

export function statusLabel(s: SponsorStatus) {
  return STATUS_META[s].label;
}

export function categoryLabel(c: string) {
  return CATEGORY_LABEL[c as SponsorCategory] ?? c;
}

export function money(n: number | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  });
}
