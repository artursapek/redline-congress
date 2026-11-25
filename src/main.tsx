import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";
import App from "./App";

// Automatically recover if a new deploy rotated lazy-loaded Vite chunk hashes
// while a visitor still had an older tab open.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
