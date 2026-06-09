// Data layer for the /admin panel (Phase 1, read-only).
//
// Every query uses the service-role client (createSupabaseAdmin) to read across
// ALL users (RLS bypassed). NEVER import this from client code — it would pull
// the service-role key into the bundle. The /admin pages are server components.
//
// Graceful pre-migration behaviour: the cost views + audit journal depend on
// migration 0011 (llm_cost_events / admin_actions / admin_cost_summary). Until
// Vsevolod applies it, those reads fail with "relation/function does not exist";
// we catch that and return a `pending:true` marker so the panel still works from
// the existing tables (profiles / search_requests / usage_counters) and the cost
// sections show «ожидает миграцию 0011» instead of crashing the page.
//
// Scale note: aggregations over search_requests fetch up to ROW_CAP rows and
// roll up in JS — exact at beta volume. A returned `capped:true` surfaces in the
// UI when the cap is hit (→ move those rollups to an RPC, like cost summary).

import { createSupabaseAdmin } from "./supabase-server";
import { QUOTA_LIMITS } from "./config";

const ROW_CAP = 2000;

export type SearchType =
  | "novelty"
  | "landscape"
  | "deep_analysis"
  | "literature_review";

export type AdminProfile = {
  id: string;
  email: string;
  tier: string;
  full_name: string | null;
  organization: string | null;
  created_at: string | null;
};

type SearchRow = {
  id: string;
  user_id: string | null;
  type: string;
  status: string;
  topic: string | null;
  created_at: string | null;
};

export type CostSummary = {
  pending: boolean; // true ⇒ migration 0011 not applied yet
  totalRub: number;
  eventCount: number;
  byModel: Record<string, number>;
  byLabel: Record<string, number>;
  byUser: Record<string, number>;
};

const EMPTY_COST: CostSummary = {
  pending: true,
  totalRub: 0,
  eventCount: 0,
  byModel: {},
  byLabel: {},
  byUser: {},
};

/** First instant of the current month (cost/quota period boundary). */
export function monthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isMissingRelation(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  // Postgres 42P01 (undefined_table) / 42883 (undefined_function), or the
  // PostgREST PGRST202 (function not found in schema cache).
  const m = (err.message ?? "").toLowerCase();
  return (
    err.code === "42P01" ||
    err.code === "42883" ||
    err.code === "PGRST202" ||
    m.includes("does not exist") ||
    m.includes("could not find the function")
  );
}

/** LLM cost rollup since `since` via the admin_cost_summary RPC (exact in PG). */
export async function getCostSummary(since: Date): Promise<CostSummary> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.rpc("admin_cost_summary", {
    p_since: since.toISOString(),
  });
  if (error) {
    if (isMissingRelation(error)) return EMPTY_COST;
    console.error("[admin-data] getCostSummary failed", error.message);
    return EMPTY_COST;
  }
  const d = (data ?? {}) as {
    total_rub?: number;
    event_count?: number;
    by_model?: Record<string, number>;
    by_label?: Record<string, number>;
    by_user?: Record<string, number>;
  };
  return {
    pending: false,
    totalRub: Number(d.total_rub ?? 0),
    eventCount: Number(d.event_count ?? 0),
    byModel: d.by_model ?? {},
    byLabel: d.by_label ?? {},
    byUser: d.by_user ?? {},
  };
}

async function fetchProfiles(): Promise<AdminProfile[]> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, tier, full_name, organization, created_at")
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (error) {
    console.error("[admin-data] fetchProfiles failed", error.message);
    return [];
  }
  return (data ?? []) as AdminProfile[];
}

async function fetchSearchRows(): Promise<{ rows: SearchRow[]; capped: boolean }> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("search_requests")
    .select("id, user_id, type, status, topic, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (error) {
    console.error("[admin-data] fetchSearchRows failed", error.message);
    return { rows: [], capped: false };
  }
  const rows = (data ?? []) as SearchRow[];
  return { rows, capped: rows.length >= ROW_CAP };
}

export type AdminUserRow = AdminProfile & {
  requestCount: number;
  lastActivity: string | null;
  costRub: number; // attributed cost this month (events with this user_id)
};

export type UsersView = {
  users: AdminUserRow[];
  capped: boolean;
  costPending: boolean;
};

/** Users list (3.1): profiles + per-user request count / last activity / cost. */
export async function listUsers(): Promise<UsersView> {
  const [profiles, { rows, capped }, cost] = await Promise.all([
    fetchProfiles(),
    fetchSearchRows(),
    getCostSummary(monthStart()),
  ]);

  const countByUser = new Map<string, number>();
  const lastByUser = new Map<string, string>();
  for (const r of rows) {
    if (!r.user_id) continue;
    countByUser.set(r.user_id, (countByUser.get(r.user_id) ?? 0) + 1);
    // rows are ordered created_at desc → first seen per user is the latest.
    if (!lastByUser.has(r.user_id) && r.created_at) {
      lastByUser.set(r.user_id, r.created_at);
    }
  }

  const users: AdminUserRow[] = profiles.map((p) => ({
    ...p,
    requestCount: countByUser.get(p.id) ?? 0,
    lastActivity: lastByUser.get(p.id) ?? null,
    costRub: cost.byUser[p.id] ?? 0,
  }));

  return { users, capped, costPending: cost.pending };
}

export type Metrics = {
  totalUsers: number;
  byTier: Record<string, number>;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  recentRegistrations: { date: string; count: number }[]; // last 14 days
  capped: boolean;
};

/** Aggregate metrics (3.4). */
export async function getMetrics(): Promise<Metrics> {
  const [profiles, { rows, capped }] = await Promise.all([
    fetchProfiles(),
    fetchSearchRows(),
  ]);

  const byTier: Record<string, number> = {};
  for (const p of profiles) byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  // Registrations per day for the last 14 days.
  const regByDay = new Map<string, number>();
  for (const p of profiles) {
    if (!p.created_at) continue;
    const day = p.created_at.slice(0, 10);
    regByDay.set(day, (regByDay.get(day) ?? 0) + 1);
  }
  const recentRegistrations: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    recentRegistrations.push({ date: key, count: regByDay.get(key) ?? 0 });
  }

  return {
    totalUsers: profiles.length,
    byTier,
    byType,
    byStatus,
    recentRegistrations,
    capped,
  };
}

export type ActivityRow = SearchRow & { email: string | null; costRub?: number };

/** Recent activity feed (3.2): search_requests joined to user email. */
export async function getActivity(limit = 200): Promise<{ rows: ActivityRow[] }> {
  const admin = createSupabaseAdmin();
  const [{ data: srData, error }, profiles] = await Promise.all([
    admin
      .from("search_requests")
      .select("id, user_id, type, status, topic, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    fetchProfiles(),
  ]);
  if (error) {
    console.error("[admin-data] getActivity failed", error.message);
    return { rows: [] };
  }
  const emailById = new Map(profiles.map((p) => [p.id, p.email]));
  const rows: ActivityRow[] = ((srData ?? []) as SearchRow[]).map((r) => ({
    ...r,
    email: r.user_id ? emailById.get(r.user_id) ?? null : null,
  }));
  return { rows };
}

export type QuotaLine = { operation: string; used: number; limit: number | null };
export type UserDetail = {
  profile:
    | (AdminProfile & {
        phone: string | null;
        position: string | null;
        industrial_usage_enabled: boolean | null;
        tier_expires_at: string | null;
        account_deleted_at: string | null;
      })
    | null;
  requests: SearchRow[];
  quotas: QuotaLine[];
  costRub: number;
  costPending: boolean;
};

const QUOTA_OPS = ["search", "landscape"] as const;

/** Per-user drill (3.5): profile + requests + quotas + attributed cost. */
export async function getUserDetail(userId: string): Promise<UserDetail> {
  const admin = createSupabaseAdmin();
  const period = monthStart();
  const [{ data: prof }, { data: reqs }, { data: counters }, cost] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, email, tier, full_name, organization, position, phone, created_at, tier_expires_at, industrial_usage_enabled, account_deleted_at"
        )
        .eq("id", userId)
        .maybeSingle(),
      admin
        .from("search_requests")
        .select("id, user_id, type, status, topic, created_at")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("usage_counters")
        .select("operation, count")
        .eq("user_id", userId)
        .eq("period_start", period.toISOString()),
      getCostSummary(period),
    ]);

  const profile = (prof ?? null) as UserDetail["profile"];
  const tier = profile?.tier ?? "free";
  const usedByOp = new Map<string, number>(
    ((counters ?? []) as { operation: string; count: number }[]).map((c) => [
      c.operation,
      c.count,
    ])
  );
  const limits = (QUOTA_LIMITS as Record<string, Record<string, number>>)[tier];
  const quotas: QuotaLine[] = QUOTA_OPS.map((op) => {
    const lim = limits?.[op];
    return {
      operation: op,
      used: usedByOp.get(op) ?? 0,
      limit: lim === undefined || lim === Infinity ? null : lim,
    };
  });

  return {
    profile,
    requests: ((reqs ?? []) as SearchRow[]),
    quotas,
    costRub: cost.byUser[userId] ?? 0,
    costPending: cost.pending,
  };
}

export type AdminActionRow = {
  id: string;
  admin_email: string;
  target_user_id: string | null;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
};

/** Audit journal (§6). Empty in Phase 1; pending:true until 0011 is applied. */
export async function getAdminActions(
  limit = 200
): Promise<{ rows: AdminActionRow[]; pending: boolean }> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin
    .from("admin_actions")
    .select("id, admin_email, target_user_id, action, payload, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingRelation(error)) return { rows: [], pending: true };
    console.error("[admin-data] getAdminActions failed", error.message);
    return { rows: [], pending: false };
  }
  return { rows: (data ?? []) as AdminActionRow[], pending: false };
}
