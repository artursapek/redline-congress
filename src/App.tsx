import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./lib/theme";
import { HomePage } from "./pages/HomePage";
import { BillViewerPage } from "./pages/BillViewerPage";
import { CongressPage } from "./pages/CongressPage";

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/recent" element={<HomePage />} />
          <Route path="/passed" element={<HomePage />} />
          <Route path="/noteworthy" element={<HomePage />} />
          <Route path="/:congress" element={<CongressPage />} />
          <Route path="/:congress/:type" element={<CongressPage />} />
          <Route
            path="/:congress/:type/:number"
            element={<BillViewerPage />}
          />
          <Route
            path="/:congress/:type/:number/:spec"
            element={<BillViewerPage />}
          />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;
