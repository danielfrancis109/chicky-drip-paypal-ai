import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const DEFAULT_CONTENT: Record<string, string> = {
  hero_tagline: "Sauce it. Dip it. Drip it.",
  hero_title: "Flavor that hits different!",
  hero_text: "Saucy chicken catering for parties, offices, tailgates and everything in between. Order online, earn points, eat free.",
  menu_intro: "Pick your chicken, pick your drip, add your sides.",
  flavors_intro: "10 sauces from sweet to spicy to tangy. Every one made to drip.",
  rewards_title: "Order 10 times, eat free",
  rewards_text: "Every order fills your Drip Meter. Hit 10 and get a free meal worth $15.",
  order_note: "We'll call to confirm your catering order and pickup or delivery time.",
  footer_text: "Chicky Drip Catering. Get saucy.",
  menu_meal_note: "6-piece mini or 3-piece large drum — $9 with your choice of fries, cole slaw or rice.",
  menu_sandwich_note: "Chicken sandwiches with optional cole slaw.",
  menu_drinks_note: "Dr Pepper, Coke, Pepsi, Sprite or Fanta — $2.50. Apple juice — $3.50.",
  menu_extras_note: "One dip included with each chicken item. Extra dips — $0.75 each.",
  flavor_1: "Honey Drip", flavor_1_desc: "Golden honey glaze. Pure sweet.", flavor_1_heat: "Sweet",
  flavor_2: "Brown Sugar Babe", flavor_2_desc: "Brown sugar and butter, sticky and rich.", flavor_2_heat: "Sweet",
  flavor_3: "Mango Tango", flavor_3_desc: "Juicy mango with a tiny kick.", flavor_3_heat: "Sweet",
  flavor_4: "Sweet Heat Swirl", flavor_4_desc: "Honey meets chili flakes.", flavor_4_heat: "Sweet & Spicy",
  flavor_5: "Lemon Pepper Zing", flavor_5_desc: "Bright lemon, cracked pepper.", flavor_5_heat: "Tangy",
  flavor_6: "Tamarind Slap", flavor_6_desc: "Sour, sweet, and a little wild.", flavor_6_heat: "Tangy",
  flavor_7: "Garlic Parm Drip", flavor_7_desc: "Buttery garlic and parmesan.", flavor_7_heat: "Tangy",
  flavor_8: "Buffalo Bounce", flavor_8_desc: "Classic buffalo, extra saucy.", flavor_8_heat: "Spicy",
  flavor_9: "Nashville Fire", flavor_9_desc: "Smoky cayenne crunch.", flavor_9_heat: "Hot",
  flavor_10: "Ghost Pepper Meltdown", flavor_10_desc: "For the brave only.", flavor_10_heat: "Extreme",
};

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
