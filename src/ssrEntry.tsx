import { renderToString } from "react-dom/server";
import { Route, Routes, StaticRouter } from "react-router-dom";
import { ThemeProvider } from "./lib/theme";
import { withServerInitialData, type InitialData } from "./lib/initialData";
import { HomePage } from "./pages/HomePage";
import { CongressPage } from "./pages/CongressPage";

/**
 * Server-renders the homepage and Congress list pages with the real React
 * components, so the HTML the browser paints first is identical to what the
 * client app renders (no layout shift when it mounts). Bill pages keep their
 * lightweight SEO markup: the viewer is client-only.
 */
export function renderAppHtml(url: string, data: InitialData): string {
  return withServerInitialData(data, () =>
    renderToString(
      <ThemeProvider>
        <StaticRouter location={url}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/recent" element={<HomePage />} />
            <Route path="/passed" element={<HomePage />} />
            <Route path="/noteworthy" element={<HomePage />} />
            <Route path="/:congress" element={<CongressPage />} />
            <Route path="/:congress/:type" element={<CongressPage />} />
          </Routes>
        </StaticRouter>
      </ThemeProvider>,
    ),
  );
}
