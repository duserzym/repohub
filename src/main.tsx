import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./lib/state";
import "./styles/app.css";
import { applyCachedAppearance } from "./lib/themes";

applyCachedAppearance();

const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: 30 * 60_000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <App />
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>,
);
