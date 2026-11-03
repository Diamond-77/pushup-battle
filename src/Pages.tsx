import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import { CLANS, clanById, type Clan } from "./clans";
import { CLAN_DAYS, PLAYER_SONGS, START_RESPECT, respectTitle } from "./config";
import SongPlayer from "./SongPlayer";
import { supabase } from "./supabase";
import { useEffect, useState, type ReactNode } from "react";
import { daysLeft, type useClan } from "./useClan";
import { Crest, Knot, METALS, Pauldron, SideGuard } from "./ArmorFrame";
import type { Profile } from "./auth";

// Full-page screens drawn over the 3D palace.

const FlagIcon = ({ size = 26 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 21V4M6 4h11l-2.5 4L17 12H6" />
  </svg>
);

export function HomePage({ profile, clan, onBattle, onTrain, challenges }: { profile: Profile; clan: Clan | null; onBattle: () => void; onTrain: () => void; challenges?: ReactNode }) {
  return (
    <div className="page home-page clear">
      <div className="home-top">
        <div className="plaque">
          <Avatar url={profile.avatar_url} color="me" size={46} legendary={profile.legendary} />
          <div>
            <div className="plaque-name">{profile.username}</div>
            {profile.title && <div className="title-badge">{profile.title}</div>}
            <div className="respect">
              {profile.respect ?? START_RESPECT} <span className="respect-word">Respect</span>
              <span className="rank-title">{respectTitle(profile.respect ?? START_RESPECT)}</span>
            </div>
          </div>
        </div>
        <div className="banner-col">
        <div className="clan-banner" style={clan ? { background: `linear-gradient(180deg, ${clan.color}, #2a1810)` } : undefined}>
          <span className="clan-glyph">{clan ? <ClanLogo clan={clan} size={34} /> : <FlagIcon />}</span>
          <span className="clan-banner-text">{clan ? clan.name : "Lone warrior"}</span>
        </div>
        {challenges}
        </div>
      </div>
      <div className="spacer" />
      <div className="home-actions">
        <button className="game-btn red big" onClick={onBattle}>
          Battle
        </button>
        <button className="game-btn jade" onClick={onTrain}>
          Train
        </button>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const WEATHER_LABEL = { storm: "Storm and lightning", sunset: "Golden sunset", night: "Moonlit night", day: "Clear day" };

type ClanState = ReturnType<typeof useClan>;

export function ClanPage({ clan, preview, onPreview, onMembers }: { clan: ClanState; preview: Clan; onPreview: (c: Clan) => void; onMembers: (c: Clan) => void }) {
  const [popup, setPopup] = useState<"join" | "locked" | null>(null);
  const [busy, setBusy] = useState(false);
  const m = clan.membership;
  const mine = m?.clan.id === preview.id;
  const tabs = (
    <div className="clan-tabs">
      {CLANS.map((c) => (
        <button key={c.id} className={c.id === preview.id ? "on" : ""} style={{ ["--accent" as string]: c.color }} onClick={() => { onPreview(c); setPopup(null); }}>
          {c.name}
        </button>
      ))}
    </div>
  );
  const membersBtn = (
    <button className="game-btn wood" onClick={() => onMembers(preview)}>
      Members
    </button>
  );

  // Your own clan
  if (m && mine) {
    return (
      <div className="page clear">
        {tabs}
        <div className="clan-head panel">
          <ClanLogo clan={m.clan} size={58} />
          <div>
            <div className="brush-title">{m.clan.name}</div>
            <div className="muted">{m.clan.motto}</div>
          </div>
        </div>
        <div className="stat-row">
          <span className="stat-chip">{plural(clan.counts[m.clan.id] ?? 1, "member")}</span>
          <span className="stat-chip gold">{clan.respect[m.clan.id] ?? 0} Respect</span>
        </div>
        <div className="look-hint">Drag to look around · pinch to zoom</div>
        <div className="spacer" />
        <div className="row stretch">
          {membersBtn}
          <button className="game-btn red" disabled>
            Clan war
          </button>
        </div>
        <div className="soon-strip">Clan wars and chat · coming soon</div>
      </div>
    );
  }

  const join = async () => {
    setBusy(true);
    await clan.join(preview.id);
    setBusy(false);
    setPopup(null);
  };

  return (
    <div className="page clear">
      {tabs}
      <div className="look-hint">{m ? `Scouting a rival empire` : "Choose your clan"} · drag to look around</div>
      <div className="spacer" />
      <div className="clan-card panel" style={{ ["--accent" as string]: preview.color }}>
        <div className="clan-card-top">
          <ClanLogo clan={preview} size={40} />
          <div className="brush-title grow">{preview.name}</div>
          <span className="stat-chip">{plural(clan.counts[preview.id] ?? 0, "member")}</span>
        </div>
        <div className="muted small"><b className="gold-text">{clan.respect[preview.id] ?? 0} clan Respect</b></div>
        <div className="muted">{preview.motto} <span className="small">· {WEATHER_LABEL[preview.weather]}</span></div>
        {clan.error && <p className="form-msg error">{clan.error}</p>}
        <div className="row stretch">
          {membersBtn}
          <button className="game-btn jade" disabled={busy || clan.loading} onClick={() => setPopup(m ? "locked" : "join")}>
            {m ? "Switch clan" : `Join ${preview.name}`}
          </button>
        </div>
      </div>
      {!m && (
        <div className="lone-strip">
          <b>Lone Warrior</b> · you fight alone until you join a clan
        </div>
      )}

      {popup && (
        <div className="modal-back" onClick={() => !busy && setPopup(null)}>
          <div className="modal panel" onClick={(e) => e.stopPropagation()}>
            <ClanLogo clan={popup === "locked" ? m!.clan : preview} size={64} />
            {popup === "join" ? (
              <>
                <div className="modal-title">Join {preview.name}?</div>
                <p className="modal-text">
                  Once you join, you are sworn to {preview.name} for <b>{CLAN_DAYS} days</b>. You can't leave or switch clans until then.
                </p>
                <div className="row stretch">
                  <button className="game-btn wood" disabled={busy} onClick={() => setPopup(null)}>Not now</button>
                  <button className="game-btn jade" disabled={busy} onClick={join}>{busy ? "Joining…" : "Join"}</button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">Still sworn to {m!.clan.name}</div>
                <p className="modal-text">
                  Your oath lasts {CLAN_DAYS} days. You can switch to {preview.name} in <b>{plural(daysLeft(m!.expiresAt), "day")}</b>.
                </p>
                <button className="game-btn wood" onClick={() => setPopup(null)}>OK</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Ranked = { id: string; username: string; avatar_url: string | null; respect: number; title?: string | null; legendary?: boolean; throne_motto?: string | null };

// A short burst of petals and light when the throne page opens for a special king, gone in about 3.5 s.
function ThroneCelebration({ color }: { color: string }) {
  const [show, setShow] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShow(false), 3800); return () => clearTimeout(t); }, []);
  if (!show) return null;
  return (
    <div className="throne-celebrate" style={{ ["--c" as string]: color }} aria-hidden="true">
      <div className="tc-rays" />
      {Array.from({ length: 34 }, (_, i) => {
        const a = (i / 34) * Math.PI * 2 + (i % 3) * 0.2;
        const d = 150 + (i * 37) % 120;
        return <i key={i} style={{ ["--x" as string]: `${Math.cos(a) * d}px`, ["--y" as string]: `${Math.sin(a) * d - 40}px`, ["--r" as string]: `${(i * 53) % 360}deg`, animationDelay: `${(i % 6) * 0.05}s` }} className={i % 3 === 0 ? "gold" : ""} />;
      })}
    </div>
  );
}

// The line the player on the throne writes. Only they can edit it, and only while they sit there.
function ThroneMotto({ king, mine }: { king: Ranked; mine: boolean }) {
  const [text, setText] = useState(king.throne_motto ?? "");
  const [saved, setSaved] = useState(king.throne_motto ?? "");
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(king.throne_motto ?? ""); setSaved(king.throne_motto ?? ""); }, [king.id, king.throne_motto]);
  const save = async () => {
    if (!supabase) return;
    const v = text.trim().slice(0, 80);
    const { error } = await supabase.from("profiles").update({ throne_motto: v || null }).eq("id", king.id);
    if (error) { setErr(/column|schema cache/i.test(error.message) ? "Run challenges.sql first" : error.message); return; }
    setSaved(v); setText(v); setEdit(false); setErr(null);
  };
  if (edit) return (
    <div className="throne-motto editing">
      <input className="motto-input" maxLength={80} value={text} autoFocus placeholder="Words from the throne…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <div className="row"><button className="pill ghost" onClick={() => { setEdit(false); setText(saved); }}>Cancel</button><button className="pill" onClick={save}>Save</button></div>
      {err && <div className="form-msg small">{err}</div>}
    </div>
  );
  if (!saved && !mine) return null;
  return (
    <div className="throne-motto">
      {saved ? <q>{saved}</q> : <span className="muted small">Write a line for the throne</span>}
      {mine && <button className="motto-edit" onClick={() => setEdit(true)} aria-label="Edit throne words">✎</button>}
    </div>
  );
}

// The throne: the player with the most Respect sits on it. Clans are ranked by their members' total.
// The throne takes on the king's clan: its colours here, its palace behind the page.
export function ThronePage({ clanRespect, myId, onPlayer, onKingClan }: { clanRespect: Record<string, number>; myId: string; onPlayer: (id: string) => void; onKingClan?: (c: Clan | null) => void }) {
  const [view, setView] = useState<"players" | "clans">("players");
  const [top, setTop] = useState<Ranked[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    supabase?.from("profiles").select("*").order("respect", { ascending: false }).limit(30)
      .then(({ data, error }) => (error ? setFailed(true) : setTop((data ?? []) as Ranked[])));
  }, []);
  const king = top?.[0];
  // every listed player's clan, for the badge beside their name
  const [clanOf, setClanOf] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!top?.length || !supabase) return;
    supabase.from("clan_members").select("user_id, clan_id").in("user_id", top.map((p) => p.id)).gt("expires_at", new Date().toISOString())
      .then(({ data }) => setClanOf(Object.fromEntries((data ?? []).map((r: { user_id: string; clan_id: string }) => [r.user_id, r.clan_id]))));
  }, [top]);
  const [kingClan, setKingClan] = useState<Clan | null>(null);
  useEffect(() => {
    if (!king || !supabase) return;
    supabase.from("clan_members").select("clan_id").eq("user_id", king.id).gt("expires_at", new Date().toISOString()).maybeSingle()
      .then(({ data }) => { const c = clanById(data?.clan_id); setKingClan(c); onKingClan?.(c); });
  }, [king?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const clans = [...CLANS].sort((a, b) => (clanRespect[b.id] ?? 0) - (clanRespect[a.id] ?? 0));
  return (
    <div className="page dim throne-page">
      <div className="brush-title page-title">Throne</div>
      <div className="seg">
        <button className={view === "players" ? "on" : ""} onClick={() => setView("players")}>Warriors</button>
        <button className={view === "clans" ? "on" : ""} onClick={() => setView("clans")}>Clans</button>
      </div>
      {view === "players" ? (
        <>
          <div className="throne-wrap" style={{ ["--m-glow" as string]: METALS[kingClan?.id ?? "lone"].glow }}>
          {king && <Crest clan={kingClan?.id ?? "lone"} m={METALS[kingClan?.id ?? "lone"]} />}
          {king && (
            <>
              <SideGuard clan={kingClan?.id ?? "lone"} />
              <SideGuard clan={kingClan?.id ?? "lone"} right />
              <Pauldron clan={kingClan?.id ?? "lone"} m={METALS[kingClan?.id ?? "lone"]} />
              <Pauldron clan={kingClan?.id ?? "lone"} m={METALS[kingClan?.id ?? "lone"]} right />
            </>
          )}
          {king && PLAYER_SONGS[king.username]?.celebrate && <ThroneCelebration key={king.id} color={METALS[kingClan?.id ?? "lone"].glow} />}
          {king && PLAYER_SONGS[king.username]?.throne && <SongPlayer song={PLAYER_SONGS[king.username].throne!} className="throne-song" />}
          <div className={`throne-seat ${kingClan ? `themed theme-${kingClan.id}` : ""} ${king && PLAYER_SONGS[king.username]?.celebrate ? "special" : ""}`}>
            {king && PLAYER_SONGS[king.username]?.celebrate && <div className="throne-sweep" />}
            {kingClan && <div className="theme-fx" />}
            {kingClan?.id === "arasaka" && <div className="ara-run" />}
            <div className="throne-label">THE THRONE</div>
            {king ? <button className="member-row center-row" onClick={() => onPlayer(king.id)}><Avatar url={king.avatar_url} color="me" size={132} legendary={king.legendary} glow={METALS[kingClan?.id ?? "lone"].glow} /></button> : <div className="throne-empty">?</div>}
            <div className="throne-holder">{king ? king.username : failed ? "Respect isn't set up yet" : "…"}</div>
            {king && <div className="respect">{king.respect} <span className="respect-word">Respect</span> <span className="rank-title">{respectTitle(king.respect)}</span></div>}
            {king && <ThroneMotto king={king} mine={king.id === myId} />}
            {king && (
              <div className="throne-clan">
                {kingClan ? <><ClanLogo clan={kingClan} size={30} /><span>{kingClan.name}</span></> : <span>Lone Warrior</span>}
              </div>
            )}
          </div>
          {king && <Knot m={METALS[kingClan?.id ?? "lone"]} />}
          </div>
          <div className="parchment">
            <ol className="rank-list">
              {(top ?? []).slice(1).map((p, i) => (
                <li key={p.id} className={p.id === myId ? "me" : ""} onClick={() => onPlayer(p.id)}>
                  <span className="rank-no">{i + 2}</span>
                  <Avatar url={p.avatar_url} color="neutral" size={46} legendary={p.legendary} />
                  <div className="pl-text">
                    <div className="pl-name">{p.username}</div>
                    <div className="pl-status">{respectTitle(p.respect)}</div>
                  </div>
                  {(() => { const c = clanById(clanOf[p.id]); return c ? <span className="rank-clan" title={c.name}><ClanLogo clan={c} size={26} /></span> : <span className="rank-clan lone" title="Lone Warrior" />; })()}
                  <b className="gold-text">{p.respect}</b>
                </li>
              ))}
            </ol>
            {top && top.length <= 1 && <div className="muted">Win battles to stand in line for the throne.</div>}
          </div>
        </>
      ) : (
        <div className="clan-pyramid">
          {[clans.slice(0, 1), clans.slice(1)].map((row, r) => (
            <div key={r} className="cp-row">
              {row.map((c) => {
                const place = clans.indexOf(c) + 1;
                return (
                  <div key={c.id} className={`cp-card place-${place}`} style={{ ["--c" as string]: c.color, ["--m-glow" as string]: METALS[c.id]?.glow }}>
                    <Crest clan={c.id} m={METALS[c.id] ?? METALS.lone} />
                    {place === 1 && <div className="cp-crown">THE THRONE</div>}
                    <div className="cp-place">{place === 1 ? "1st" : place === 2 ? "2nd" : "3rd"}</div>
                    <ClanLogo clan={c} size={place === 1 ? 88 : 60} />
                    <div className="brush-title cp-name">{c.name}</div>
                    <div className="cp-respect"><b>{clanRespect[c.id] ?? 0}</b> Respect</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
