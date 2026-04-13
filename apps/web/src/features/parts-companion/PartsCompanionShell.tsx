import { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { AppErrorBoundary } from "../../components/AppErrorBoundary";
import { CompanionSidebar } from "./components/CompanionSidebar";
import { CompanionTopBar } from "./components/CompanionTopBar";
import { AiAssistantPanel } from "./components/AiAssistantPanel";
import { NewRequestFlow } from "./components/NewRequestFlow";

/**
 * PartsCompanionShell — desktop-first two-panel layout.
 * Left sidebar nav + main content + optional right AI panel.
 * Registers global keyboard shortcuts.
 */
export function PartsCompanionShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Derive active tab from URL
  const activeTab = location.pathname.includes("/lookup")
    ? "lookup"
    : location.pathname.includes("/machines")
      ? "machines"
      : "queue";

  // Global keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't intercept when typing in inputs
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "/":
          e.preventDefault();
          navigate("/parts/companion/lookup");
          break;
        case "q":
        case "Q":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setSidebarCollapsed((prev) => !prev);
          }
          break;
        case "a":
        case "A":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setAiPanelOpen((prev) => !prev);
          }
          break;
        case "n":
        case "N":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            setNewRequestOpen(true);
          }
          break;
        case "Escape":
          if (newRequestOpen) {
            setNewRequestOpen(false);
          } else if (aiPanelOpen) {
            setAiPanelOpen(false);
          }
          break;
      }

      // Cmd+K — command palette / focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        navigate("/parts/companion/lookup");
      }
    },
    [navigate, aiPanelOpen, newRequestOpen],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F8FA] font-sans">
      {/* Left Sidebar */}
      <CompanionSidebar
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((p) => !p)}
        onNavigate={(tab) => navigate(`/parts/companion/${tab}`)}
        aiPanelOpen={aiPanelOpen}
        onToggleAi={() => setAiPanelOpen((p) => !p)}
      />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <CompanionTopBar
          title={
            activeTab === "queue"
              ? "Queue"
              : activeTab === "lookup"
                ? "Parts Lookup"
                : "Machines"
          }
          aiPanelOpen={aiPanelOpen}
          onToggleAi={() => setAiPanelOpen((p) => !p)}
        />

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <AppErrorBoundary>
              <Outlet />
            </AppErrorBoundary>
          </div>

          {/* AI Assistant Panel */}
          {aiPanelOpen && (
            <AiAssistantPanel onClose={() => setAiPanelOpen(false)} />
          )}
        </div>
      </div>
      {/* New Request FAB */}
      <button
        onClick={() => setNewRequestOpen(true)}
        className="fixed bottom-6 z-40 w-13 h-13 rounded-[14px] border-none bg-qep-orange text-white cursor-pointer flex items-center justify-center transition-all duration-200 hover:scale-105"
        style={{
          right: aiPanelOpen ? 384 : 24,
          boxShadow: "0 4px 20px rgba(232,119,34,0.4)",
        }}
      >
        <Plus size={24} />
      </button>

      {/* New Request Modal */}
      {newRequestOpen && (
        <NewRequestFlow onClose={() => setNewRequestOpen(false)} />
      )}
    </div>
  );
}
