import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import DashboardPage from "./pages/DashboardPage";
import SearchPage from "./pages/SearchPage";
import UserMemoryPage from "./pages/UserMemoryPage";
import AgentMemoryPage from "./pages/AgentMemoryPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ProposalsPage from "./pages/ProposalsPage";
import ProposalDetailPage from "./pages/ProposalDetailPage";
import AgentsPage from "./pages/AgentsPage";
import TasksPage from "./pages/TasksPage";

// Heavy routes — code-split so D3 / markdown / mermaid stay out of the initial bundle.
const GraphPage = lazy(() => import("./pages/GraphPage"));
const EntryPage = lazy(() => import("./pages/EntryPage"));

function RouteFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <Spinner size={22} color="var(--accent)" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/user-memory" element={<UserMemoryPage />} />
        <Route path="/agent-memory" element={<AgentMemoryPage />} />
        <Route path="/knowledge" element={<KnowledgeBasePage />} />
        <Route path="/proposals" element={<ProposalsPage />} />
        <Route path="/proposals/:id" element={<ProposalDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/graph" element={<Suspense fallback={<RouteFallback />}><GraphPage /></Suspense>} />
        <Route path="/entry/:id" element={<Suspense fallback={<RouteFallback />}><EntryPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
