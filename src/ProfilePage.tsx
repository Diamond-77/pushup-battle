import { useEffect, useRef, useState, type ChangeEvent } from "react";
import AvatarCropper from "./AvatarCropper";
import { HistoryList, SocialRow } from "./PlayerPage";
import { loadHistory, loadSocial, type HistoryRow, type Social } from "./social";
import type { Profile } from "./auth";
import Avatar from "./Avatar";
import ClanLogo from "./ClanLogo";
import { CONTACT_EMAIL, CONTACT_WHATSAPP } from "./config";
import type { Membership } from "./useClan";
import { supabase } from "./supabase";

type Props = { profile: Profile; email?: string; onChange: (p: Profile) => void; membership: Membership | null };

export default function ProfilePage({ profile, email, onChange, membership }: Props) {
  const [name, setName] = useState(profile.username);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [social, setSocial] = useState<Social | null>(null);
  const [hist, setHist] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    loadSocial(profile.id, profile.id).then(setSocial);
    loadHistory(profile.id).then(setHist);
  }, [profile.id]);

  const save = async (patch: Partial<Profile>) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", profile.id)
      .select("*")
      .single();
    if (error) setMessage(error.code === "23505" ? "That name is taken, try another." : error.message);
    else {
      onChange(data);
      setMessage("Saved");
    }
  };

  const pickPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same photo again still opens the cropper
    if (file) setCropping(file);
  };
  const upload = async (jpeg: Blob) => {
    setCropping(null);
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      const path = `${profile.id}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, jpeg, { contentType: "image/jpeg" });
      if (error) throw error;
      await save({ avatar_url: supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl });
    } catch (err) {
      setMessage((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="page dim">
      <div className="brush-title page-title">Profile</div>
      <div className={`profile-hero ${profile.legendary ? "legendary-card" : ""}`}>
        <button className="avatar-pick" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Avatar url={profile.avatar_url} color="me" size={104} legendary={profile.legendary} />
          <span>{busy ? "Uploading…" : "Change photo"}</span>
        </button>
        <div className="brush-title profile-name">{profile.username}</div>
        {profile.title && <div className="title-badge big">{profile.legendary ? "Legendary · " : ""}{profile.title}</div>}
        {membership ? (
          <div className="clan-chip">
            <ClanLogo clan={membership.clan} size={30} />
            <div>
              <b>{membership.clan.name}</b>
            </div>
          </div>
        ) : (
          <div className="clan-chip"><div><b>Lone Warrior</b><span>no clan</span></div></div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
      {cropping && <AvatarCropper file={cropping} onCancel={() => setCropping(null)} onSave={upload} />}
      <SocialRow s={social} mine />

      <label className="field">
        Player name
        <div className="row">
          <input value={name} maxLength={20} minLength={2} onChange={(e) => setName(e.target.value)} />
          <button className="pill" disabled={name.trim() === profile.username || name.trim().length < 2} onClick={() => save({ username: name.trim() })}>
            Save
          </button>
        </div>
      </label>
      <label className="field">
        Bio
        <textarea className="bio-input" maxLength={160} rows={3} placeholder="Tell other warriors about yourself" value={bio} onChange={(e) => setBio(e.target.value)} />
        <div className="row bio-foot">
          <span className="muted small">{bio.length}/160</span>
          <button className="pill" disabled={bio.trim() === (profile.bio ?? "")} onClick={() => save({ bio: bio.trim() })}>Save bio</button>
        </div>
      </label>
      {email && <div className="muted">{email}</div>}
      {message && <p className="form-msg">{message}</p>}
      {/* Only on the developer (legendary) account, as asked */}
      {profile.legendary && (
      <div className="panel report">
        <div className="section-title">Found a bug? Report it</div>
        <div className="row stretch">
          <a className="game-btn wood" href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Pushup Battle issue")}`}>
            Email
          </a>
          <a className="game-btn jade whatsapp" href={`https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent("Hi! Pushup Battle issue: ")}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        </div>
      </div>
      )}
      <HistoryList rows={hist} />
      <button className="pill ghost" onClick={() => supabase?.auth.signOut()}>
        Log out
      </button>
    </div>
  );
}
