import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import WorldMap from "./WorldMap";

// Stand-alone test page for the open-world map (world.html), kept apart from the live app.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorldMap />
  </StrictMode>,
);
