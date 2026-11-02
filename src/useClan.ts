import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { clanById, type Clan } from "./clans";

export type Membership = { clan: Clan; joinedAt: Date; expiresAt: Date };
export type Member = { id: string; name: string; avatar: string | null; title: string | null; legendary: boolean; joinedAt: Date; respect: number | null };

// The player's clan (null = lone warrior), member counts per clan, and joining.
export function useClan(userId: string) {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [respect, setRespect] = useState<Record<string, number>>({}); // clan Respect = all members' Respect added up
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    const now = new Date().toISOString();
    const [mine, all] = await Promise.all([
      supabase.from("clan_members").select("clan_id, joined_at, expires_at").eq("user_id", userId).gt("expires_at", now).maybeSingle(),
      supabase.from("clan_members").select("clan_id, profiles(*)").gt("expires_at", now),
    ]);
    const clan = clanById(mine.data?.clan_id);
    setMembership(clan && mine.data ? { clan, joinedAt: new Date(mine.data.joined_at), expiresAt: new Date(mine.data.expires_at) } : null);
    const c: Record<string, number> = {}, r: Record<string, number> = {};
    for (const row of Array.isArray(all.data) ? all.data : []) {
      c[row.clan_id] = (c[row.clan_id] ?? 0) + 1;
      const p = (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { respect?: number } | null;
      r[row.clan_id] = (r[row.clan_id] ?? 0) + (p?.respect ?? 0);
    }
    setCounts(c);
    setRespect(r);
    setError(mine.error?.message ?? all.error?.message ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const join = async (clanId: string) => {
    if (!supabase) return;
    setError(null);
    const { error } = await supabase.rpc("join_clan", { p_clan: clanId });
    if (error) setError(error.message);
    await refresh();
  };

  return { membership, counts, respect, loading, error, join, refresh };
}

export async function loadMembers(clanId: string): Promise<Member[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("clan_members")
    .select("user_id, joined_at, profiles(*)")
    .eq("clan_id", clanId)
    .gt("expires_at", new Date().toISOString())
    .order("joined_at");
  return (data ?? []).map((r) => {
    const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as { username: string; avatar_url: string | null; title?: string | null; legendary?: boolean; respect?: number } | null;
    return { id: r.user_id as string, name: p?.username ?? "?", avatar: p?.avatar_url ?? null, title: p?.title ?? null, legendary: !!p?.legendary, joinedAt: new Date(r.joined_at as string), respect: p?.respect ?? null };
  });
}

export const daysLeft = (d: Date) => Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
