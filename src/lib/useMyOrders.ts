import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { meterStatus } from "./menu";

export function useMyOrders(userId?: string) {
  const q = useQuery({
    queryKey: ["my_orders", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("*").eq("user_id", userId!).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  // Only paid (PayPal) or legacy pay-on-pickup orders fill the Drip Meter; abandoned checkouts don't.
  const status = meterStatus(q.data ?? []);
  return { ...q, status };
}
