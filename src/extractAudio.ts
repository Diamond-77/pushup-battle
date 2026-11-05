// Takes the sound out of a video (MP4, MOV, WebM…) right on the phone and turns it into a small MP3,
// so a profile song can come from a video. Nothing is sent anywhere until the MP3 is ready.

const MAX_SECONDS = 10 * 60; // keep at most the first 10 minutes
const KBPS = 128;

export const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(f.name);

export async function videoToMp3(f: File): Promise<File> {
  const buf = await f.arrayBuffer();
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    // the callback form also works on older Safari
    audio = await new Promise<AudioBuffer>((ok, fail) => ctx.decodeAudioData(buf, ok, fail));
  } catch {
    throw new Error("Couldn't find any sound in that video. Try another video or an MP3.");
  } finally {
    ctx.close().catch(() => {});
  }
  const rate = audio.sampleRate;
  const len = Math.min(audio.length, Math.floor(MAX_SECONDS * rate));
  if (len < rate) throw new Error("That video's sound is too short.");

  // mix down to mono
  const chans = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(1, rate, KBPS);
  const parts: BlobPart[] = [];
  const BLOCK = 1152 * 20;
  const pcm = new Int16Array(BLOCK);
  for (let start = 0; start < len; start += BLOCK) {
    const n = Math.min(BLOCK, len - start);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const ch of chans) v += ch[start + i];
      v /= chans.length;
      pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
    }
    const out = enc.encodeBuffer(n === BLOCK ? pcm : pcm.subarray(0, n));
    if (out.length) parts.push(new Uint8Array(out));
    if ((start / BLOCK) % 25 === 0) await new Promise((r) => setTimeout(r)); // let the page breathe
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  const name = f.name.replace(/\.[^.]+$/, "") + ".mp3";
  return new File(parts, name, { type: "audio/mpeg" });
}
