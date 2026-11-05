import { supabase } from "../supabase";

// The giant screen's radio: friends suggest YouTube songs and vote, the top vote plays next,
// and everyone in the world hears the same second of the same song.
// Sync runs over Supabase Realtime (no database table): the player who has been here longest is the
// "host"; they keep the list and tell everyone what plays and when it started. When they leave,
// the next longest takes over with the list they already have. Without Supabase it runs just on this phone.

export type Song = { id: string; title: string; by: string; votes: string[] };
export type Now = { id: string; title: string; by: string; startedAt: number } | null;
// played: recent songs, which come round again when nobody has suggested anything, so it never goes quiet
export type RadioState = { queue: Song[]; now: Now; played?: { id: string; title: string; by: string }[] };

type Msg =
  | { t: "state"; from: string; sentAt: number; state: RadioState }
  | { t: "hello"; from: string }
  | { t: "suggest"; from: string; songs: Song[] }
  | { t: "vote"; from: string; id: string; on: boolean }
  | { t: "ended"; from: string; id: string; skip?: boolean };

const MAX_QUEUE = 80;
const MAX_PLAYED = 60;
const KEY = import.meta.env.VITE_YOUTUBE_API_KEY;
export const canSearch = !!KEY;

export type Found = { kind: "video" | "playlist"; id: string; title: string; channel: string; thumb: string };

// a playlist link -> its id
export function playlistId(text: string): string | null {
  try {
    const u = new URL(text.trim().startsWith("http") ? text.trim() : "https://" + text.trim());
    const l = u.searchParams.get("list");
    return l && /^[\w-]{10,64}$/.test(l) ? l : null;
  } catch {
    return null;
  }
}

const unescape = (t: string) => { const e = document.createElement("textarea"); e.innerHTML = t; return e.value; };

// YouTube search (official Data API; needs VITE_YOUTUBE_API_KEY)
export async function search(q: string, kind: "video" | "playlist"): Promise<Found[]> {
  if (!KEY) return [];
  const p = new URLSearchParams({ part: "snippet", q, type: kind, maxResults: "15", key: KEY, safeSearch: "moderate" });
  if (kind === "video") p.set("videoEmbeddable", "true");
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${p}`);
  if (!r.ok) throw new Error(r.status === 403 ? "YouTube search limit reached for today" : "Search failed");
  const j = (await r.json()) as { items: { id: { videoId?: string; playlistId?: string }; snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string } } } }[] };
  return j.items
    .map((it) => ({ kind, id: (kind === "video" ? it.id.videoId : it.id.playlistId) ?? "", title: unescape(it.snippet.title), channel: unescape(it.snippet.channelTitle), thumb: it.snippet.thumbnails.medium?.url ?? "" }))
    .filter((f) => f.id);
}

// the songs in a playlist (first 50)
export async function playlistSongs(id: string): Promise<{ id: string; title: string }[]> {
  if (!KEY) return [];
  const p = new URLSearchParams({ part: "snippet", playlistId: id, maxResults: "50", key: KEY });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${p}`);
  if (!r.ok) throw new Error("Couldn't open that playlist");
  const j = (await r.json()) as { items: { snippet: { title: string; resourceId: { videoId?: string } } }[] };
  return j.items
    .filter((it) => it.snippet.resourceId.videoId && it.snippet.title !== "Private video" && it.snippet.title !== "Deleted video")
    .map((it) => ({ id: it.snippet.resourceId.videoId!, title: unescape(it.snippet.title).slice(0, 90) }));
}

// a YouTube link (or a bare 11-character id) -> the video id
export function videoId(text: string): string | null {
  const s = text.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.startsWith("http") ? s : "https://" + s);
    const host = u.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* not a link */
  }
  return null;
}

// the video's title, from YouTube's public oEmbed (no key needed)
export async function videoTitle(id: string): Promise<string> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`);
    if (r.ok) return ((await r.json()) as { title?: string }).title?.slice(0, 90) || "YouTube video";
  } catch {
    /* blocked or offline */
  }
  return "YouTube video";
}

export const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

export class Radio {
  state: RadioState = { queue: [], now: null };
  host = false;
  online = false;
  private me = Math.random().toString(36).slice(2, 10);
  private joinedAt = Date.now();
  private hostId: string | null = null;
  private offset = 0; // host clock minus our clock, in ms
  private channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
  private timer = 0;
  private listeners = new Set<() => void>();

  constructor(room = "arasaka", id?: string) {
    if (id) this.me = id; // signed in: your votes stay yours after a reload
    if (!supabase) {
      this.host = true;
      return;
    }
    const ch = supabase.channel(`world-music:${room}`, { config: { presence: { key: this.me }, broadcast: { self: false } } });
    ch.on("presence", { event: "sync" }, () => {
      const all = Object.values(ch.presenceState<{ id: string; at: number }>()).flat();
      if (!all.some((p) => p.id === this.me)) return; // our own join hasn't shown up yet
      all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
      const was = this.host;
      this.hostId = all[0].id;
      this.host = this.hostId === this.me;
      if (this.host && !was) this.takeOver();
      this.emit();
    })
      .on("broadcast", { event: "m" }, ({ payload }) => this.receive(payload as Msg))
      .subscribe((s) => {
        if (s !== "SUBSCRIBED") return;
        this.online = true;
        ch.track({ id: this.me, at: this.joinedAt });
        this.send({ t: "hello", from: this.me });
      });
    this.channel = ch;
    // the host repeats the state now and then, so nobody drifts or misses a change
    this.timer = window.setInterval(() => { if (this.host) this.publish(); }, 10000);
  }

  get myId() {
    return this.me;
  }

  // the host's clock, in ms
  now() {
    return Date.now() + this.offset;
  }

  // seconds into the current song
  elapsed() {
    return this.state.now ? Math.max(0, (this.now() - this.state.now.startedAt) / 1000) : 0;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  close() {
    clearInterval(this.timer);
    if (this.channel) supabase?.removeChannel(this.channel);
    this.listeners.clear();
  }

  suggest(list: { id: string; title: string }[], by: string) {
    const songs: Song[] = list.map((x) => ({ id: x.id, title: x.title, by, votes: [this.me] }));
    if (this.host) this.apply({ t: "suggest", from: this.me, songs });
    else this.send({ t: "suggest", from: this.me, songs });
  }

  vote(id: string, on: boolean) {
    // show our vote straight away; the host's next state confirms it
    const s = this.state.queue.find((x) => x.id === id);
    if (s) s.votes = on ? [...new Set([...s.votes, this.me])] : s.votes.filter((v) => v !== this.me);
    this.emit();
    if (this.host) this.apply({ t: "vote", from: this.me, id, on });
    else this.send({ t: "vote", from: this.me, id, on });
  }

  // the player saw the song finish, or YouTube refused to play it (skip)
  ended(id: string, skip = false) {
    const m: Msg = { t: "ended", from: this.me, id, skip };
    if (this.host) this.apply(m);
    else this.send(m);
  }

  private emit() {
    this.listeners.forEach((f) => f());
  }

  private send(m: Msg) {
    this.channel?.send({ type: "broadcast", event: "m", payload: m });
  }

  private publish() {
    this.send({ t: "state", from: this.me, sentAt: Date.now(), state: this.state });
  }

  private takeOver() {
    this.offset = 0;
    this.next();
    this.publish();
  }

  private receive(m: Msg) {
    if (m.t === "state") {
      if (m.from !== this.hostId && this.hostId !== null) return;
      this.offset = m.sentAt - Date.now(); // good to within the message delay
      this.state = m.state;
      this.emit();
    } else if (this.host) {
      if (m.t === "hello") this.publish();
      else this.apply(m);
    }
  }

  // host only: change the list and tell everyone
  private apply(m: Msg) {
    const q = this.state.queue;
    if (m.t === "suggest") {
      for (const song of m.songs.slice(0, 50)) {
        if (this.state.now?.id === song.id || !/^[\w-]{11}$/.test(song.id)) continue;
        const have = q.find((s) => s.id === song.id);
        if (have) have.votes = [...new Set([...have.votes, m.from])];
        else if (q.length < MAX_QUEUE) q.push({ id: song.id, title: String(song.title).slice(0, 90), by: String(song.by).slice(0, 12), votes: [m.from] });
      }
    } else if (m.t === "vote") {
      const s = q.find((x) => x.id === m.id);
      if (s) s.votes = m.on ? [...new Set([...s.votes, m.from])] : s.votes.filter((v) => v !== m.from);
    } else if (m.t === "ended") {
      // ignore stale reports and "ended" right after a song started
      const now = this.state.now;
      if (now?.id !== m.id || (!m.skip && this.elapsed() < 8)) return;
      // finished songs go round again later; broken ones are dropped
      const played = (this.state.played ?? []).filter((p) => p.id !== now.id);
      if (!m.skip) played.push({ id: now.id, title: now.title, by: now.by });
      this.state.played = played.slice(-MAX_PLAYED);
      this.state.now = null;
    }
    this.next();
    this.publish();
    this.emit();
  }

  // host only: nothing playing -> the top vote goes on (ties: suggested first).
  // With nothing suggested, an earlier song comes round again (not one of the last few).
  private next() {
    if (this.state.now) return;
    const q = this.state.queue;
    if (!q.length) {
      const old = this.state.played ?? [];
      if (!old.length) return;
      const pool = old.length > 4 ? old.slice(0, -3) : old;
      const s = pool[Math.floor(Math.random() * pool.length)];
      this.state.now = { ...s, startedAt: this.now() + 1500 };
      return;
    }
    let top = 0;
    q.forEach((s, i) => { if (s.votes.length > q[top].votes.length) top = i; });
    const [s] = q.splice(top, 1);
    this.state.now = { id: s.id, title: s.title, by: s.by, startedAt: this.now() + 1500 };
  }
}
