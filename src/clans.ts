// The clans players can join. The id must match a row in the Supabase `clans` table (supabase/clans.sql).

export type Weather = "storm" | "sunset" | "night" | "day";

export type Clan = {
  id: string;
  name: string;
  motto: string;
  color: string; // banner / UI accent
  weather: Weather;
  palace: { wall: number; roof: number; banner: number; mainTiers: number; sideTowers: 0 | 2 | 4 };
};

export const CLANS: Clan[] = [
  {
    id: "arasaka",
    name: "Arasaka",
    motto: "Iron discipline. Strike like lightning.",
    color: "#c8372d",
    weather: "storm",
    palace: { wall: 0x2a2228, roof: 0x34394a, banner: 0xc8372d, mainTiers: 6, sideTowers: 4 },
  },
  {
    id: "soraran-gate",
    name: "Soraran Gate",
    motto: "Rise with the sun, train till it sets.",
    color: "#e8b84a",
    weather: "sunset",
    palace: { wall: 0xb23a2e, roof: 0x2f6d6b, banner: 0xe8b84a, mainTiers: 5, sideTowers: 2 },
  },
  {
    id: "sleepbuilders",
    name: "sleepBuilders",
    motto: "Build while the world sleeps.",
    color: "#7b6cd9",
    weather: "night",
    palace: { wall: 0x3a3f5c, roof: 0x4d5562, banner: 0x7b6cd9, mainTiers: 4, sideTowers: 4 },
  },
];

export const clanById = (id: string | null | undefined) => CLANS.find((c) => c.id === id) ?? null;
