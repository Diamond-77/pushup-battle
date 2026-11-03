import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SONG_VOLUME, type PlayerSong } from "./config";
import { setSongActive, useSoundPrefs } from "./music";

const key = (src: string) => `pb_song_off:${src}`;
const readOff = (src: string) => { try { return localStorage.getItem(key(src)) === "1"; } catch { return false; } };
// Only one player song at a time: the newest page's song plays, the ones under it wait (and resume when it closes).
type Slot = { hold: (on: boolean) => void };
const stack: Slot[] = [];
function pushSlot(slot: Slot) {
  stack.forEach((x) => x.hold(true));
  stack.push(slot);
  return () => {
    const i = stack.indexOf(slot);
    if (i >= 0) stack.splice(i, 1);
    if (i === stack.length) stack[stack.length - 1]?.hold(false); // I was on top: the one below may play again
  };
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// The song's "cover": the player's picture if given, otherwise a painted swirl in the clan colour.
function Cover({ song, color, size }: { song: PlayerSong; color: string; size: number }) {
  return song.art
    ? <img className="song-cover" src={song.art} alt="" width={size} height={size} />
    : <div className="song-cover painted" style={{ width: size, height: size, ["--c" as string]: color }}><span>{song.title.slice(0, 1)}</span></div>;
}

// A small spinning record that plays a player's song on loop (from its start point), quietly.
// Tap it for a lock-screen style card with the song's name, artist, progress and play/pause.
// On your own profile the card also lets you pick a song from your device, name it, and set where it starts.
export type SongEditor = {
  upload: (file: File) => Promise<string | null>; // error text or null
  setStart: (sec: number) => Promise<void>;
  setMeta: (title: string, artist: string) => Promise<void>;
  remove: () => Promise<void>;
};
const NO_SONG: PlayerSong = { src: "", title: "No song yet", artist: "Pick one from your phone" };

export default function SongPlayer({ song: given, color = "#ffd27a", className = "", editor }: { song: PlayerSong | null; color?: string; className?: string; editor?: SongEditor }) {
  const song = given ?? NO_SONG;
  const prefs = useSoundPrefs();
  const [off, setOff] = useState(() => readOff(song.src) || !prefs.music);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState({ now: 0, len: 0 });
  const [missing, setMissing] = useState(false);
  const [held, setHeld] = useState(false); // another song on a newer page is playing
  useEffect(() => pushSlot({ hold: setHeld }), []);
  const audio = useRef<HTMLAudioElement | null>(null);
  const start = song.start ?? 0;

  useEffect(() => {
    if (!song.src) return;
    setMissing(false);
    // "#t=" asks the browser to start loading and playing right at the start point (no jump from 0:00)
    const a = new Audio(start > 0 ? `${song.src}#t=${start}` : song.src);
    a.preload = "auto";
    a.volume = 0;
    a.addEventListener("loadedmetadata", () => { try { a.currentTime = start; } catch { /* not seekable yet */ } setTime({ now: a.currentTime, len: a.duration }); }, { once: true });
    a.addEventListener("ended", () => { a.currentTime = start; a.play().catch(() => {}); });
    a.addEventListener("timeupdate", () => {
      if (song.end && a.currentTime >= song.end) a.currentTime = start; // loop just the chosen part
      setTime({ now: a.currentTime, len: a.duration || 0 });
    });
    a.addEventListener("error", () => setMissing(true));
    audio.current = a;
    return () => { a.pause(); a.removeAttribute("src"); a.load(); audio.current = null; };
  }, [song.src, start, song.end]);

  useEffect(() => {
    const a = audio.current;
    if (!a || !song.src) return;
    let active = false, fadeT = 0, cancelled = false;
    const go = () => {
      if (cancelled) return;
      if (a.currentTime < start && a.readyState >= 1) { try { a.currentTime = start; } catch { /* ignore */ } }
      a.play().then(() => {
        if (cancelled) return a.pause();
        active = true; setSongActive(true); setPlaying(true);
        let v = 0;
        fadeT = window.setInterval(() => { v = Math.min(SONG_VOLUME, v + SONG_VOLUME / 6); a.volume = v; if (v >= SONG_VOLUME) clearInterval(fadeT); }, 60);
      }).catch(() => window.addEventListener("pointerdown", go, { once: true })); // browsers wait for a first tap
    };
    const hide = () => { if (document.hidden) a.pause(); else if (active) a.play().catch(() => {}); };
    if (!off && !held) { go(); document.addEventListener("visibilitychange", hide); }
    return () => {
      cancelled = true;
      clearInterval(fadeT);
      window.removeEventListener("pointerdown", go);
      document.removeEventListener("visibilitychange", hide);
      a.pause();
      setPlaying(false);
      if (active) setSongActive(false);
    };
  }, [off, held, start, song.src]);

  const toggle = () => setOff((o) => { try { localStorage.setItem(key(song.src), o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  // the scrubber: hold the bar and slide to jump anywhere in the song (like the lock screen)
  const [drag, setDrag] = useState<number | null>(null); // 0..1 while held
  const fracAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const seekTo = (f: number) => {
    const a = audio.current;
    if (!a || !time.len) return;
    a.currentTime = f * time.len;
    setTime({ now: a.currentTime, len: time.len });
  };
  const shown = drag !== null ? drag * time.len : time.now;
  const pct = time.len ? Math.min(100, (shown / time.len) * 100) : 0;
  return (
    <>
      <button className={`song-disc ${playing ? "spin" : ""} ${className}`} style={{ ["--c" as string]: color }} onClick={() => setOpen(true)} aria-label={`Now playing: ${song.title}`}>
        <span className="disc-label" />
      </button>
      {open && createPortal(
        <div className="modal-back now-back" onClick={() => setOpen(false)}>
          <div className="now-card" style={{ ["--c" as string]: color }} onClick={(e) => e.stopPropagation()}>
            <div className="now-top">
              <Cover song={song} color={color} size={64} />
              <div className="now-text">
                <b>{song.title}</b>
                <span>{song.artist}</span>
              </div>
              <div className={`now-eq ${playing ? "on" : ""}`}><i /><i /><i /><i /></div>
            </div>
            <div className={`now-scrub ${drag !== null ? "held" : ""}`}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(fracAt(e)); }}
              onPointerMove={(e) => { if (drag !== null) setDrag(fracAt(e)); }}
              onPointerUp={(e) => { if (drag !== null) seekTo(fracAt(e)); setDrag(null); }}
              onPointerCancel={() => setDrag(null)}>
              <div className="now-bar"><i style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="now-times"><span>{mmss(shown)}</span><span>{missing ? "song file not added yet" : time.len ? `-${mmss(Math.max(0, time.len - shown))}` : ""}</span></div>
            <div className="now-controls">
              <button className="now-play" disabled={!song.src} onClick={toggle} aria-label={off ? "Play" : "Pause"}>
                {off
                  ? <svg viewBox="0 0 24 24" width="30" height="30"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>
                  : <svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z" fill="currentColor" /></svg>}
              </button>
            </div>
            {editor && <SongEdit editor={editor} song={given} now={time.now} />}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function SongEdit({ editor, song, now }: { editor: SongEditor; song: PlayerSong | null; now: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState(song?.title ?? "");
  const [artist, setArtist] = useState(song?.artist ?? "");
  useEffect(() => { setTitle(song?.title ?? ""); setArtist(song?.artist ?? ""); }, [song?.src]); // eslint-disable-line react-hooks/exhaustive-deps
  const file = useRef<HTMLInputElement>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return setErr("That file is over 15 MB. Try a shorter or smaller one.");
    setBusy("Uploading…"); setErr(null);
    const e = await editor.upload(f);
    setBusy(null); if (e) setErr(e);
  };
  const saveMeta = () => { if (song && (title !== song.title || artist !== song.artist)) editor.setMeta(title.trim().slice(0, 80), artist.trim().slice(0, 80)); };
  return (
    <div className="song-edit">
      {song && (
        <>
          <input className="song-field" value={title} maxLength={80} placeholder="Song name" onChange={(e) => setTitle(e.target.value)} onBlur={saveMeta} />
          <input className="song-field" value={artist} maxLength={80} placeholder="Artist" onChange={(e) => setArtist(e.target.value)} onBlur={saveMeta} />
        </>
      )}
      <div className="song-edit-row">
        <button className="song-chip" onClick={() => file.current?.click()} disabled={!!busy}>{busy ?? (song ? "Change song" : "Add a song")}</button>
        {song && <button className="song-chip" onClick={async () => { setBusy("Saving…"); await editor.setStart(Math.floor(now)); setBusy(null); }}>Start from {mmss(now)}</button>}
        {song && <button className="song-chip ghost" onClick={() => editor.remove()}>Remove</button>}
      </div>
      <input ref={file} type="file" accept="audio/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {err && <div className="song-err">{err}</div>}
      <div className="song-hint">From your phone or computer (MP3 or M4A, up to 15 MB). Songs from Apple Music or Spotify can't be picked.</div>
    </div>
  );
}
