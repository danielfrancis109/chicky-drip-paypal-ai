import { describe, expect, it, vi } from "vitest";
import { createRpcDb, getServerDb, type RpcClient } from "./server-db.server";

const TOKEN = "t".repeat(64);
const U = "11111111-1111-4111-8111-111111111111";

function fakeClient(responses: Record<string, unknown>, error?: string) {
  const rpc = vi.fn(async (fn: string, _args: Record<string, unknown>) =>
    error ? { data: null, error: { message: error } } : { data: responses[fn] ?? null, error: null },
  );
  const select = vi.fn(async () => ({ data: [{ key: "flavor_8", value: "Buffalo Bounce" }], error: null }));
  const from = vi.fn(() => ({ select }));
  return { client: { rpc, from } as unknown as RpcClient, rpc, from };
}

describe("RPC-backed server db (publishable key + server token)", () => {
  it("sends the server token with every call and normalises numeric strings", async () => {
    const { client, rpc } = fakeClient({
      srv_list_user_orders: [
        { id: "o1", user_id: U, status: "new", used_reward: false, payment_status: "paid", total: "9.00", subtotal: "9.00", discount: "0.00", paypal_order_id: null },
      ],
    });
    const db = createRpcDb(client, TOKEN);
    const rows = await db.listUserOrders(U);
    expect(rows[0]).toMatchObject({ id: "o1", total: 9, subtotal: 9, discount: 0 });
    expect(rpc).toHaveBeenCalledWith("srv_list_user_orders", { p_token: TOKEN, p_user_id: U });
  });

  it("inserts, updates (scoped to the user) and looks up by PayPal id", async () => {
    const { client, rpc } = fakeClient({
      srv_insert_order: "22222222-2222-4222-8222-222222222222",
      srv_update_order: true,
      srv_find_order_by_paypal_id: { id: "o1", user_id: U, status: "new", used_reward: false, payment_status: "pending", total: 36, subtotal: 36, discount: 0, paypal_order_id: "PP1" },
    });
    const db = createRpcDb(client, TOKEN);
    expect(await db.insertOrder({ user_id: U, total: 36 })).toEqual({ id: "22222222-2222-4222-8222-222222222222" });
    await db.updateOrder("o1", U, { paypal_order_id: "PP1" });
    expect(rpc).toHaveBeenCalledWith("srv_update_order", {
      p_token: TOKEN,
      p_id: "o1",
      p_user_id: U,
      p_patch: { paypal_order_id: "PP1" },
    });
    expect((await db.findByPayPalId(U, "PP1"))?.paypal_order_id).toBe("PP1");
  });

  it("fails loudly when the database refuses an update (e.g. already paid)", async () => {
    const { client } = fakeClient({ srv_update_order: false });
    await expect(createRpcDb(client, TOKEN).updateOrder("o1", U, { status: "cancelled" })).rejects.toThrow(/could not be updated/);
  });

  it("cancel returns null when nothing can be cancelled; admin and content reads work", async () => {
    const { client } = fakeClient({ srv_cancel_order: null, srv_admin_orders: [{ total: 1 }] });
    const db = createRpcDb(client, TOKEN);
    expect(await db.cancelOrder("o1", U)).toBeNull();
    expect(await db.adminOrders(500)).toEqual([{ total: 1 }]);
    expect(await db.siteContent()).toEqual([{ key: "flavor_8", value: "Buffalo Bounce" }]);
  });

  it("surfaces database errors (wrong token, missing function)", async () => {
    const { client } = fakeClient({}, "invalid_server_token");
    await expect(createRpcDb(client, TOKEN).listUserOrders(U)).rejects.toThrow("invalid_server_token");
  });
});

describe("getServerDb selection", () => {
  it("uses RPC mode with the publishable key + token and no service-role key", async () => {
    const db = await getServerDb({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub", SERVER_RPC_TOKEN: TOKEN });
    expect(db.mode).toBe("rpc");
  });
  it("prefers the service-role path when that key is present", async () => {
    const db = await getServerDb({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_PUBLISHABLE_KEY: "pub", SERVER_RPC_TOKEN: TOKEN });
    expect(db.mode).toBe("service_role");
  });
  it("names what is missing without leaking values", async () => {
    await expect(getServerDb({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "pub" })).rejects.toThrow(/SERVER_RPC_TOKEN/);
  });
});
