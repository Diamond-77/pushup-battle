import { useEffect, useRef, useState, type PointerEvent } from "react";

// Drag to move, slider or pinch to zoom, then save a 256px square JPEG.
const FRAME = 260;

export default function AvatarCropper({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (b: Blob) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? Math.max(FRAME / img.naturalWidth, FRAME / img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = (img?.naturalWidth ?? 0) * scale, h = (img?.naturalHeight ?? 0) * scale;
  // keep the frame covered by the picture
  const clamp = (o: { x: number; y: number }) => ({
    x: Math.min((w - FRAME) / 2, Math.max(-(w - FRAME) / 2, o.x)),
    y: Math.min((h - FRAME) / 2, Math.max(-(h - FRAME) / 2, o.y)),
  });
  const pos = clamp(off);

  const down = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
  };
  const move = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoom(Math.min(4, Math.max(1, (pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d)));
    } else if (pointers.current.size === 1) {
      setOff((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
    }
  };
  const up = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = () => {
    if (!img) return;
    const out = 256, k = out / FRAME;
    const c = document.createElement("canvas");
    c.width = c.height = out;
    const x = c.getContext("2d")!;
    x.drawImage(img, (FRAME / 2 + pos.x - w / 2) * k, (FRAME / 2 + pos.y - h / 2) * k, w * k, h * k);
    c.toBlob((b) => b && onSave(b), "image/jpeg", 0.88);
  };

  return (
    <div className="modal-back">
      <div className="modal panel cropper">
        <div className="modal-title">Adjust your photo</div>
        <div className="crop-frame" style={{ width: FRAME, height: FRAME }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}>
          {img && <img src={img.src} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(${pos.x - w / 2 + FRAME / 2}px, ${pos.y - h / 2 + FRAME / 2}px)` }} />}
          <svg className="crop-ring" viewBox="0 0 100 100" preserveAspectRatio="none">
            {/* dark outside, clear hexagon: the shape your avatar is shown in */}
            <path fillRule="evenodd" fill="rgba(0,0,0,0.55)" d="M0 0H100V100H0Z M50 2 L91 26 L91 74 L50 98 L9 74 L9 26 Z" />
            <path fill="none" stroke="#e8b84a" strokeWidth="1" vectorEffect="non-scaling-stroke" d="M50 2 L91 26 L91 74 L50 98 L9 74 L9 26 Z" />
          </svg>
        </div>
        <input className="crop-zoom" type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
        <div className="muted small">Drag to move · pinch or slide to zoom</div>
        <div className="row stretch">
          <button className="game-btn wood" onClick={onCancel}>Cancel</button>
          <button className="game-btn jade" disabled={!img} onClick={save}>Use photo</button>
        </div>
      </div>
    </div>
  );
}
