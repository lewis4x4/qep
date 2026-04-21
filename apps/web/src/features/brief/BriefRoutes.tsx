/**
 * /brief/* route tree for the Stakeholder Build Hub.
 *
 * Wraps the audience-gated surfaces (Dashboard, Feedback inbox) with the
 * floating "Got feedback?" button that should be present on every /brief
 * route. New sub-views (Decisions, Ask-the-Brain) hook in here.
 */
import { NavLink, Route, Routes } from "react-router-dom";
import { BriefDashboardPage } from "./pages/BriefDashboardPage";
import { BriefFeedbackPage } from "./pages/BriefFeedbackPage";
import { BriefDecisionsPage } from "./pages/BriefDecisionsPage";
import { BriefAskPage } from "./pages/BriefAskPage";
import { FeedbackButton } from "./components/FeedbackButton";
import { NotificationBell } from "./components/NotificationBell";

export interface BriefRoutesProps {
  userId: string;
  stakeholderName: string | null;
  subrole: "owner" | "primary_contact" | "technical" | "admin" | null;
  canAdminister: boolean;
}

export function BriefRoutes({
  userId,
  stakeholderName,
  subrole,
  canAdminister,
}: BriefRoutesProps) {
  return (
    <div className="min-h-[100dvh] bg-background">
      <BriefNav userId={userId} />
      <Routes>
        <Route
          index
          element={
            <BriefDashboardPage
              userId={userId}
              stakeholderName={stakeholderName}
              subrole={subrole}
            />
          }
        />
        <Route
          path="feedback"
          element={<BriefFeedbackPage userId={userId} canAdminister={canAdminister} />}
        />
        <Route path="decisions" element={<BriefDecisionsPage />} />
        <Route path="ask" element={<BriefAskPage />} />
      </Routes>
    </div>
  );
}

const NAV_ITEMS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/brief", label: "Today", end: true },
  { to: "/brief/feedback", label: "Feedback" },
  { to: "/brief/decisions", label: "Decisions" },
  { to: "/brief/ask", label: "Ask" },
];

function BriefNav({ userId }: { userId: string }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-4 py-2 sm:gap-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-full px-3 py-1.5 text-sm font-medium transition ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <div className="ml-auto flex flex-shrink-0 items-center gap-2">
          <NotificationBell userId={userId} />
          <FeedbackButton />
        </div>
      </div>
    </nav>
  );
}
