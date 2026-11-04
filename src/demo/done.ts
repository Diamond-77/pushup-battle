// Kept apart from the demo itself so the 3D code only loads when the demo opens.
export const HOWTO_KEY = "pb_guide_done_v2";
export const howToDone = () => {
  try { return localStorage.getItem(HOWTO_KEY) === "1"; } catch { return false; }
};
