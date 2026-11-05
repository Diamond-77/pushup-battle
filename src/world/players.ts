import { supabase } from "../supabase";

// Other signed-in players walking around the same empire, over Supabase Realtime (no database table).
// Presence says who is here; broadcasts carry where they are (about 8 times a second while moving)
// and challenges between two players.

export type Peer = { id: string; name: string; x: number; y: number; z: number; f: number; s: number; air: boolean; at: number };
type Pos = { id: string; x: number; y: number; z: number; f: number; s: number; air: boolean };
type Ask = { from: string; to: string; mode: string };
type Answer = { from: string; to: string; mode: string; ok: boolean };

export class Online {
  peers = new Map<string, Peer>();
  onRoster: () => void = () => {};
  onChallenge: (from: string, mode: string) => void = () => {};
  onAnswer: (from: string, mode: string, ok: boolean) => void = () => {};
  private ch: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
  private last = { x: 0, z: 0, f: 0, t: 0 };

  private me: { id: string; name: string };

  constructor(room: string, me: { id: string; name: string }) {
    this.me = me;
    if (!supabase) return;
    const ch = supabase.channel(`world:${room}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, () => {
      const here = new Map<string, string>();
      for (const [id, metas] of Object.entries(ch.presenceState<{ name: string }>())) if (id !== me.id) here.set(id, metas[0]?.name ?? "Player");
      for (const id of [...this.peers.keys()]) if (!here.has(id)) this.peers.delete(id);
      for (const [id, name] of here) if (!this.peers.has(id)) this.peers.set(id, { id, name, x: NaN, y: 0, z: 0, f: 0, s: 0, air: false, at: 0 });
      this.onRoster();
    })
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const p = payload as Pos, peer = this.peers.get(p.id);
        if (peer) Object.assign(peer, p, { at: performance.now() });
      })
      .on("broadcast", { event: "ask" }, ({ payload }) => {
        const a = payload as Ask;
        if (a.to === me.id && this.peers.has(a.from)) this.onChallenge(a.from, a.mode);
      })
      .on("broadcast", { event: "answer" }, ({ payload }) => {
        const a = payload as Answer;
        if (a.to === me.id) this.onAnswer(a.from, a.mode, a.ok);
      })
      .subscribe((s) => { if (s === "SUBSCRIBED") ch.track({ name: me.name }); });
    this.ch = ch;
  }

  // call every frame with where you are; sends only when it's worth it
  send(x: number, y: number, z: number, f: number, s: number, air: boolean) {
    if (!this.ch) return;
    const t = performance.now(), L = this.last;
    const moved = Math.hypot(x - L.x, z - L.z) > 0.05 || Math.abs(f - L.f) > 0.05 || air;
    if (t - L.t < (moved ? 120 : 1000)) return;
    Object.assign(L, { x, z, f, t });
    const r = (v: number) => Math.round(v * 100) / 100;
    this.ch.send({ type: "broadcast", event: "pos", payload: { id: this.me.id, x: r(x), y: r(y), z: r(z), f: r(f), s: r(s), air } satisfies Pos });
  }

  challenge(to: string, mode: string) {
    this.ch?.send({ type: "broadcast", event: "ask", payload: { from: this.me.id, to, mode } satisfies Ask });
  }

  answer(to: string, mode: string, ok: boolean) {
    this.ch?.send({ type: "broadcast", event: "answer", payload: { from: this.me.id, to, mode, ok } satisfies Answer });
  }

  close() {
    if (this.ch) supabase?.removeChannel(this.ch);
  }
}

// a steady look per player, picked from their id
const TEES = [0x3b6fd1, 0xc8372d, 0x2fa36b, 0xe8b84a, 0x8a4fd1, 0x1f9bb0, 0xf07a2a, 0x2a2a30];
const BANDS = [0xe0313c, 0xf7f7f2, 0x1b1a1f, 0xe8b84a];
export function lookFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { tee: TEES[h % TEES.length], band: BANDS[(h >> 4) % BANDS.length] };
}
