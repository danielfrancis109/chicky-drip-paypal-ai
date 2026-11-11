import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import { DEFAULT_CONTENT } from "./content-defaults";
export { DEFAULT_CONTENT };

export const contentQuery = queryOptions({
  queryKey: ["site_content"],
  queryFn: async () => {
    const { data } = await supabase.from("site_content").select("key,value");
    const map = { ...DEFAULT_CONTENT };
    for (const r of data ?? []) map[r.key] = r.value;
    return map;
  },
});

export function useContent() {
  const { data } = useQuery(contentQuery);
  const c = data ?? DEFAULT_CONTENT;
  return (k: string) => c[k] ?? DEFAULT_CONTENT[k] ?? "";
}
