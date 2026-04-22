import "./instrument";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "@/lib/theme-store";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installDynamicImportRecovery } from "./lib/dynamic-import-recovery";

installDynamicImportRecovery();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
