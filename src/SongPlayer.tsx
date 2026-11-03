import { useEffect, useRef, useState } from "react";
import { SONG_VOLUME, type PlayerSong } from "./config";
import { setSongActive, useSoundPrefs } from "./music";

const key = (src: string) => `pb_song_off:${src}`;
const readOff = (src: string) => { try { return localStorage.getItem(key(src)) === "1"; } catch { return false; } };

// A small round speaker button that plays a player's song on loop (from its start point), quietly.
export default function SongPlayer({ song, className = "" }: { song: PlayerSong; className?: string }) {
  const prefs = useSoundPrefs();
  const [off, setOff] = useState(() => readOff(song.src) || !prefs.music);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const start = song.start ?? 0;

  useEffect(() => {
    const a = new Audio(song.src);
    a.preload = "auto";
    a.volume = 0;
    a.addEventListener("loadedmetadata", () => { try { a.currentTime = start; } catch { /* not seekable yet */ } }, { once: true });
    a.addEventListener("ended", () => { a.currentTime = start; a.play().catch(() => {}); });
    audio.current = a;
    return () => { a.pause(); a.removeAttribute("src"); a.load(); audio.current = null; };
  }, [song.src, start]);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    let active = false, fadeT = 0, cancelled = false;
    const fadeIn = () => {
      let v = 0;
      fadeT = window.setInterval(() => { v = Math.min(SONG_VOLUME, v + SONG_VOLUME / 20); a.volume = v; if (v >= SONG_VOLUME) clearInterval(fadeT); }, 60);
    };
    const go = () => {
      if (cancelled) return;
      if (a.currentTime < start && a.readyState >= 1) { try { a.currentTime = start; } catch { /* ignore */ } }
      a.play().then(() => { if (cancelled) return a.pause(); active = true; setSongActive(true); setPlaying(true); fadeIn(); })
        .catch(() => window.addEventListener("pointerdown", go, { once: true })); // browsers wait for a first tap
    };
    const hide = () => { if (document.hidden) a.pause(); else if (active) a.play().catch(() => {}); };
    if (!off) { go(); document.addEventListener("visibilitychange", hide); }
    return () => {
      cancelled = true;
      clearInterval(fadeT);
      window.removeEventListener("pointerdown", go);
      document.removeEventListener("visibilitychange", hide);
      a.pause();
      setPlaying(false);
      if (active) setSongActive(false);
    };
  }, [off, start]);

  const toggle = () => {
    setOff((o) => { try { localStorage.setItem(key(song.src), o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  };
  return (
    <button className={`song-btn ${playing ? "on" : ""} ${className}`} onClick={toggle} aria-label={off ? "Play song" : "Mute song"}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
        {off ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <><path d="M15.5 9a4 4 0 0 1 0 6" /><path d="M18 6.5a7.5 7.5 0 0 1 0 11" /></>}
      </svg>
    </button>
  );
}
