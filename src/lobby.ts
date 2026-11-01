import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type PlayerStatus = "idle" | "searching" | "in_match";
export type Player = { id: string; name: string; avatar: string | null; status: PlayerStatus };
export type MatchInfo = { matchId: string; creator: boolean; opponent: Player };

type LobbyMsg =
  | { type: "challenge"; from: Player; to: string }
  | { type: "accept"; from: Player; to: string }
  | { type: "decline"; from: Player; to: string }
  | { type: "match"; matchId: string; a: Player; b: Player };

// Presence channel "lobby": who is online, challenges, and pairing into a match.
// Pairing rule: only the player with the smaller id creates the match.
export function useLobby(me: { id: string; name: string; avatar: string | null }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [status, setStatusState] = useState<PlayerStatus>("idle");
  const [incoming, setIncoming] = useState<Player | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchInfo | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const statusRef = useRef<PlayerStatus>("idle");
  const playersRef = useRef<Player[]>([]);
  const meRef = useRef(me);
  meRef.current = me;

  const self = (): Player => ({ ...meRef.current, status: statusRef.current });
  const send = (msg: LobbyMsg) => channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });

  const setStatus = useCallback((s: PlayerStatus) => {
    statusRef.current = s;
    setStatusState(s);
    channelRef.current?.track({ ...meRef.current, status: s });
  }, []);

  const enterMatch = useCallback(
    (matchId: string, a: Player, b: Player) => {
      const meId = meRef.current.id;
      setStatus("in_match");
      setNotice(null);
      setIncoming(null);
      setMatch({ matchId, creator: a.id === meId, opponent: a.id === meId ? b : a });
    },
    [setStatus],
  );

  // Called only by the player with the smaller id.
  const createMatch = useCallback(
    (other: Player) => {
      if (statusRef.current === "in_match") return;
      const a = self();
      const matchId = crypto.randomUUID();
      send({ type: "match", matchId, a, b: other });
      enterMatch(matchId, a, other);
    },
    [enterMatch],  
  );

  const trySearchPair = useCallback(
    (list: Player[]) => {
      if (statusRef.current !== "searching") return;
      const other = list.find((p) => p.status === "searching");
      if (other && meRef.current.id < other.id) createMatch(other);
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
          .map((entries) => entries[0])
          .filter((p) => p && p.id !== meRef.current.id);
        playersRef.current = list;
        setPlayers(list);
        trySearchPair(list);
      })
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        const msg = payload as LobbyMsg;
        const meId = meRef.current.id;
        if (msg.type === "match") {
          if (msg.b.id === meId && statusRef.current !== "in_match") enterMatch(msg.matchId, msg.a, msg.b);
          return;
        }
        if (msg.to !== meId) return;
        if (msg.type === "challenge") {
          if (statusRef.current === "in_match") send({ type: "decline", from: self(), to: msg.from.id });
          else setIncoming(msg.from);
        } else if (msg.type === "accept") {
          if (meId < msg.from.id) createMatch(msg.from);
        } else if (msg.type === "decline") {
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
  }, [me.name, me.avatar]);  

  return {
    players,
    status,
    incoming,
    notice,
    match,
    challenge: (p: Player) => {
      send({ type: "challenge", from: self(), to: p.id });
      setNotice(`Waiting for ${p.name} to accept…`);
    },
    accept: () => {
      if (!incoming) return;
      send({ type: "accept", from: self(), to: incoming.id });
      if (meRef.current.id < incoming.id) createMatch(incoming);
      setIncoming(null);
    },
    decline: () => {
      if (incoming) send({ type: "decline", from: self(), to: incoming.id });
      setIncoming(null);
    },
    findMatch: () => {
      setNotice(null);
      setStatus("searching");
      trySearchPair(playersRef.current);
    },
    cancel: () => {
      setNotice(null);
      setStatus("idle");
    },
    leaveMatch: () => {
      setMatch(null);
      setStatus("idle");
    },
  };
}
