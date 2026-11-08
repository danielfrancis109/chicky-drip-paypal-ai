import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rewardStatus } from "./menu";

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
  const valid = (q.data ?? []).filter((o) => o.status !== "cancelled");
  const status = rewardStatus(valid.filter((o) => !o.used_reward).length, valid.filter((o) => o.used_reward).length);
  return { ...q, status };
}
