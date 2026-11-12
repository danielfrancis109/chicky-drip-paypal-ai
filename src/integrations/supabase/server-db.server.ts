// Server-side data access for checkout, cancellation and owner insights (server-only module).
//
// Two interchangeable back ends behind one interface:
//  * "service_role": the original path, used when SUPABASE_SERVICE_ROLE_KEY is set (bypasses RLS).
//  * "rpc": used when only the publishable (anon) key is available, e.g. the hackathon demo where the
//    backend is owned by Lovable Cloud. It calls a few narrow SECURITY DEFINER functions (srv_*,
//    see supabase/migrations/20261112000000_server_rpc.sql) that each verify SERVER_RPC_TOKEN, a
//    secret known only to this server, before doing exactly one privileged operation.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export type DbOrder = {
  id: string;
  user_id: string;
  status: string;
  used_reward: boolean;
  payment_status: string;
  total: number;
  subtotal: number;
  discount: number;
  paypal_order_id: string | null;
};

export interface ServerDb {
  mode: "service_role" | "rpc";
  listUserOrders(userId: string): Promise<DbOrder[]>;
  insertOrder(row: Record<string, unknown>): Promise<{ id: string }>;
  updateOrder(id: string, userId: string, patch: Record<string, unknown>): Promise<void>;
  findByPayPalId(userId: string, paypalOrderId: string): Promise<DbOrder | null>;
  cancelOrder(id: string, userId: string): Promise<{ id: string } | null>;
  adminOrders(limit: number): Promise<Record<string, unknown>[]>;
  siteContent(): Promise<Array<{ key: string; value: string }>>;
}

type DbResult = { data: unknown; error: { message: string } | null };
/** The small slice of supabase-js used here, so tests can pass a fake. */
export type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult>;
  from(table: string): {
    select(cols: string): PromiseLike<DbResult>;
  };
};

const norm = (o: Record<string, unknown>): DbOrder => ({
  ...(o as unknown as DbOrder),
  total: Number(o["total"]),
  subtotal: Number(o["subtotal"] ?? 0),
  discount: Number(o["discount"] ?? 0),
});

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function apiKeyFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`)
      headers.delete("Authorization");
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/** RPC-backed implementation. `token` is the server secret; it is only ever sent as an RPC argument. */
export function createRpcDb(client: RpcClient, token: string): ServerDb {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, { p_token: token, ...args });
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    mode: "rpc",
    async listUserOrders(userId) {
      const rows = (await call("srv_list_user_orders", { p_user_id: userId })) as Record<string, unknown>[] | null;
      return (rows ?? []).map(norm);
    },
    async insertOrder(row) {
      const id = await call("srv_insert_order", { p_row: row });
      if (typeof id !== "string") throw new Error("Could not save order");
      return { id };
    },
    async updateOrder(id, userId, patch) {
      const changed = await call("srv_update_order", { p_id: id, p_user_id: userId, p_patch: patch });
      if (changed !== true) throw new Error("Order could not be updated");
    },
    async findByPayPalId(userId, paypalOrderId) {
      const row = (await call("srv_find_order_by_paypal_id", {
        p_user_id: userId,
        p_paypal_order_id: paypalOrderId,
      })) as Record<string, unknown> | null;
      return row ? norm(row) : null;
    },
    async cancelOrder(id, userId) {
      const r = (await call("srv_cancel_order", { p_id: id, p_user_id: userId })) as { id: string } | null;
      return r ? { id: r.id } : null;
    },
    async adminOrders(limit) {
      return ((await call("srv_admin_orders", { p_limit: limit })) as Record<string, unknown>[] | null) ?? [];
    },
    async siteContent() {
      // site_content is world-readable (RLS "public read"), so the publishable key is enough.
      const { data, error } = await client.from("site_content").select("key,value");
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ key: string; value: string }>;
    },
  };
}

/** Original implementation, using the service-role client (bypasses RLS). */
export function createServiceRoleDb(admin: ReturnType<typeof createClient<Database>>): ServerDb {
  const columns = "id,user_id,status,used_reward,payment_status,total,subtotal,discount,paypal_order_id";
  return {
    mode: "service_role",
    async listUserOrders(userId) {
      const { data, error } = await admin.from("orders").select(columns).eq("user_id", userId);
      if (error) throw new Error("Could not check your rewards. Please try again.");
      return (data ?? []).map((o) => norm(o as never));
    },
    async insertOrder(row) {
      const { data, error } = await admin.from("orders").insert(row as never).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "Could not save order");
      return { id: data.id };
    },
    async updateOrder(id, userId, patch) {
      const { error } = await admin.from("orders").update(patch as never).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    },
    async findByPayPalId(userId, paypalOrderId) {
      const { data, error } = await admin
        .from("orders")
        .select(columns)
        .eq("user_id", userId)
        .eq("paypal_order_id", paypalOrderId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? norm(data as never) : null;
    },
    async cancelOrder(id, userId) {
      const { data, error } = await admin
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("user_id", userId)
        .in("status", ["new", "confirmed"])
        .neq("payment_status", "paid")
        .select("id")
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id };
    },
    async adminOrders(limit) {
      const { data, error } = await admin
        .from("orders")
        .select("items,total,payment_status,status,event_date,created_at,used_reward")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as Record<string, unknown>[];
    },
    async siteContent() {
      const { data } = await admin.from("site_content").select("key,value");
      return data ?? [];
    },
  };
}

/** Pick the back end from the environment. Service-role wins when present; otherwise RPC + token. */
export async function getServerDb(env: Record<string, string | undefined> = process.env): Promise<ServerDb> {
  if (env["SUPABASE_SERVICE_ROLE_KEY"]) {
    const { supabaseAdmin } = await import("./client.server");
    return createServiceRoleDb(supabaseAdmin as never);
  }
  const url = env["SUPABASE_URL"];
  const key = env["SUPABASE_PUBLISHABLE_KEY"];
  const token = env["SERVER_RPC_TOKEN"];
  if (!url || !key || !token) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
      ...(!token ? ["SERVER_RPC_TOKEN"] : []),
    ];
    throw new Error(
      `Missing Supabase environment variable(s): ${missing.join(", ")} (set SUPABASE_SERVICE_ROLE_KEY, or the publishable key plus SERVER_RPC_TOKEN).`,
    );
  }
  const client = createClient<Database>(url, key, {
    global: { fetch: apiKeyFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return createRpcDb(client as unknown as RpcClient, token);
}
