import * as z from "zod/mini";

/**
 * The figures of the dashboard of /admin (10c), as admin_dashboard() gives them. A figure the
 * database does not give, or gives malformed, is null: the page shows « — », never a made-up 0.
 */
export type Figure = number | null;

export type TodoItem = {
  kind: "photo" | "report" | "flag";
  created_at: string;
  pseudo: string | null;
  detail: string | null;
};

export type Dashboard = {
  bads_registered: Figure;
  bads_complete: Figure;
  bads_three_photos: Figure;
  bads_visible: Figure;
  visitors_registered: Figure;
  visitors_complete: Figure;
  dossiers_blocked: Figure;
  photos_pending: Figure;
  reports_open: Figure;
  flags_open: Figure;
  zones_open: Figure;
  zones_waitlist: Figure;
  emails_sent_today: Figure;
  emails_app_quota: Figure;
  push_queued: Figure;
  todo: TodoItem[];
};

const FIGURES = [
  "bads_registered",
  "bads_complete",
  "bads_three_photos",
  "bads_visible",
  "visitors_registered",
  "visitors_complete",
  "dossiers_blocked",
  "photos_pending",
  "reports_open",
  "flags_open",
  "zones_open",
  "zones_waitlist",
  "emails_sent_today",
  "emails_app_quota",
  "push_queued",
] as const;

/** Where each kind of waiting item is dealt with. */
export const TODO_HREF: Record<TodoItem["kind"], string> = {
  photo: "/admin/greffe",
  report: "/admin/signalements",
  flag: "/admin/textes",
};

const todoSchema = z.object({
  kind: z.enum(["photo", "report", "flag"]),
  created_at: z.string(),
  pseudo: z.nullable(z.string()),
  detail: z.nullable(z.string()),
});

function figure(value: unknown): Figure {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseDashboard(value: unknown): Dashboard {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const figures = Object.fromEntries(FIGURES.map((key) => [key, figure(row[key])])) as Record<
    (typeof FIGURES)[number],
    Figure
  >;
  const todo = Array.isArray(row.todo)
    ? row.todo.flatMap((item) => {
        const parsed = todoSchema.safeParse(item);
        return parsed.success && !Number.isNaN(Date.parse(parsed.data.created_at))
          ? [parsed.data]
          : [];
      })
    : [];
  return { ...figures, todo: todo.slice(0, 10) };
}
