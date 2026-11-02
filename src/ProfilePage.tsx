import { useRef, useState, type ChangeEvent } from "react";
import type { Profile } from "./auth";
import Avatar from "./Avatar";
import { supabase } from "./supabase";

// Center-crops and shrinks the picked photo to a 256px JPEG before upload.
async function toAvatarJpeg(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read image"))), "image/jpeg", 0.85),
  );
}

export default function ProfilePage({ profile, email, onChange }: { profile: Profile; email?: string; onChange: (p: Profile) => void }) {
  const [name, setName] = useState(profile.username);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (patch: Partial<Profile>) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", profile.id)
      .select("id, username, avatar_url")
      .single();
    if (error) setMessage(error.code === "23505" ? "That name is taken, try another." : error.message);
    else {
      onChange(data);
      setMessage("Saved");
    }
  };

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;
    setBusy(true);
    setMessage(null);
    try {
      const path = `${profile.id}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, await toAvatarJpeg(file), { contentType: "image/jpeg" });
      if (error) throw error;
      await save({ avatar_url: supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl });
    } catch (err) {
      setMessage((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="page">
      <h2>Profile</h2>
      <button className="avatar-pick" onClick={() => fileRef.current?.click()} disabled={busy}>
        <Avatar url={profile.avatar_url} color="me" size={96} />
        <span>{busy ? "Uploading…" : "Change photo"}</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />

      <label className="field">
        Player name
        <div className="row">
          <input value={name} maxLength={20} minLength={2} onChange={(e) => setName(e.target.value)} />
          <button className="pill" disabled={name.trim() === profile.username || name.trim().length < 2} onClick={() => save({ username: name.trim() })}>
            Save
          </button>
        </div>
      </label>
      {email && <div className="muted">{email}</div>}
      {message && <p className="form-msg">{message}</p>}
      <button className="pill ghost" onClick={() => supabase?.auth.signOut()}>
        Log out
      </button>
    </div>
  );
}
