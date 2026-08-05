import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

document.documentElement.dataset.theme = "atlas";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
