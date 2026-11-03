import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ModeId } from "./config";

export type PlayerStatus = "idle" | "searching" | "in_match";
export type Player = { id: string; tab?: string; name: string; avatar: string | null; status: PlayerStatus; title?: string | null; legendary?: boolean; clan?: string | null; respect?: number; mode?: ModeId };
export type MatchInfo = { matchId: string; creator: boolean; opponent: Player; mode: ModeId; bot?: { total: number; seed: number } };
export type Challenge = Player & { mode: ModeId };

type LobbyMsg =
  | { type: "challenge"; from: Player; to: string; mode: ModeId }
  | { type: "accept"; from: Player; to: string; toTab?: string; mode: ModeId }
  | { type: "decline"; from: Player; to: string; toTab?: string }
  | { type: "match"; matchId: string; a: Player; b: Player; mode: ModeId };

// Presence channel "lobby": who is online, challenges, and pairing into a match.
// Pairing rule: only the player with the smaller id creates the match.
// The same account can be open in several tabs or devices: each tab has its own id, and only the tab
// that sent/accepted the challenge (or was paired) joins the battle, so an idle tab can't report 0 reps.
const TAB = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
const forMe = (tab?: string) => !tab || tab === TAB;
// How long to look for a real opponent before a bot steps in (the developer account gets one right away).
const BOT_WAIT_MS = () => 7000 + Math.random() * 7000;
const TESTER_WAIT_MS = 1800;

export function useLobby(me: Omit<Player, "status">) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [status, setStatusState] = useState<PlayerStatus>("idle");
  const [incoming, setIncoming] = useState<Challenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const statusRef = useRef<PlayerStatus>("idle");
  const playersRef = useRef<Player[]>([]);
  const modeRef = useRef<ModeId>("brawl"); // the mode I'm searching for
  const meRef = useRef(me);
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  meRef.current = me;

  const self = (): Player => ({ ...meRef.current, tab: TAB, status: statusRef.current, mode: modeRef.current });
  const send = (msg: LobbyMsg) => channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

  const setStatus = useCallback((s: PlayerStatus) => {
    statusRef.current = s;
    setStatusState(s);
    channelRef.current?.track({ ...meRef.current, tab: TAB, status: s, mode: modeRef.current });
  }, []);

  const enterMatch = useCallback(
    (matchId: string, a: Player, b: Player, mode: ModeId) => {
      const meId = meRef.current.id;
      setStatus("in_match");
      setNotice(null);
      setIncoming(null);
      setMatch({ matchId, creator: a.id === meId, opponent: a.id === meId ? b : a, mode });
    },
    [setStatus],
  );

  // Called only by the player with the smaller id.
  const createMatch = useCallback(
    (other: Player, mode: ModeId) => {
      if (statusRef.current === "in_match") return;
      const a = self();
      const matchId = crypto.randomUUID();
      send({ type: "match", matchId, a, b: other, mode });
      enterMatch(matchId, a, other, mode);
    },
    [enterMatch],  
  );

  const trySearchPair = useCallback(
    (list: Player[]) => {
      if (statusRef.current !== "searching") return;
      if (meRef.current.legendary) return; // the developer account always battles bots
      const mode = modeRef.current;
      const other = list.find((p) => p.status === "searching" && p.mode === mode);
      if (other && meRef.current.id < other.id) createMatch(other, mode);
    },
    [createMatch],
  );

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel("lobby", { config: { presence: { key: me.id }, broadcast: { self: false } } });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<Player>();
        const list = Object.values(state)
          .map((entries) => entries.find((e) => e.status === "searching") ?? entries.find((e) => e.status === "idle") ?? entries[0])
          .filter((p) => p && p.id !== meRef.current.id);
        playersRef.current = list;
        setPlayers(list);
        trySearchPair(list);
      })
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        const msg = payload as LobbyMsg;
        const meId = meRef.current.id;
        if (msg.type === "match") {
          if (msg.b.id === meId && forMe(msg.b.tab) && statusRef.current !== "in_match") enterMatch(msg.matchId, msg.a, msg.b, msg.mode ?? "classic");
          return;
        }
        if (msg.to !== meId) return;
        if (msg.type === "challenge") {
          if (statusRef.current === "in_match") send({ type: "decline", from: self(), to: msg.from.id, toTab: msg.from.tab });
          else setIncoming({ ...msg.from, mode: msg.mode ?? "classic" });
        } else if (msg.type === "accept") {
          if (forMe(msg.toTab) && meId < msg.from.id) createMatch(msg.from, msg.mode ?? "classic");
        } else if (msg.type === "decline") {
          if (!forMe(msg.toTab)) return;
          setNotice(`${msg.from.name} declined`);
          setStatus("idle");
        }
      })
      .subscribe((s) => {
        if (s === "SUBSCRIBED") channel.track(self());
      });
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase?.removeChannel(channel);
    };
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-announce when the name or picture changes.
  useEffect(() => {
    channelRef.current?.track(self());
  }, [me.name, me.avatar, me.title, me.legendary, me.clan, me.respect]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    players,
    status,
    incoming,
    notice,
    match,
    challenge: (p: Player, mode: ModeId) => {
      send({ type: "challenge", from: self(), to: p.id, mode });
      setNotice(`Waiting for ${p.name} to accept…`);
    },
    accept: () => {
      if (!incoming) return;
      send({ type: "accept", from: self(), to: incoming.id, toTab: incoming.tab, mode: incoming.mode });
      if (meRef.current.id < incoming.id) createMatch(incoming, incoming.mode);
      setIncoming(null);
    },
    decline: () => {
      if (incoming) send({ type: "decline", from: self(), to: incoming.id, toTab: incoming.tab });
      setIncoming(null);
    },
    findMatch: (mode: ModeId) => {
      modeRef.current = mode;
      setNotice(null);
      setStatus("searching");
      trySearchPair(playersRef.current);
      // nobody came: battle a bot
      if (botTimer.current) clearTimeout(botTimer.current);
      botTimer.current = setTimeout(async () => {
        if (statusRef.current !== "searching" || modeRef.current !== mode || !supabase) return;
        setStatus("in_match"); // so no real player pairs with me meanwhile
        const { data, error } = await supabase.rpc("start_bot_match", { p_mode: mode });
        if (error || !data) {
          setStatus("searching");
          if (error && !/function|schema cache/i.test(error.message)) { setNotice(error.message); setStatus("idle"); }
          return;
        }
        const d = data as { match_id: string; total: number; seed: number; opponent: { id: string; name: string; avatar: string | null; legendary: boolean; title: string | null } };
        setNotice(null);
        setIncoming(null);
        setMatch({ matchId: d.match_id, creator: true, mode, bot: { total: d.total, seed: d.seed },
          opponent: { id: d.opponent.id, name: d.opponent.name, avatar: d.opponent.avatar, legendary: d.opponent.legendary, title: d.opponent.title, status: "in_match" } });
      }, meRef.current.legendary ? TESTER_WAIT_MS : BOT_WAIT_MS());
    },
    cancel: () => {
      if (botTimer.current) clearTimeout(botTimer.current);
      setNotice(null);
      setStatus("idle");
    },
    leaveMatch: () => {
      setMatch(null);
      setStatus("idle");
    },
  };
}
