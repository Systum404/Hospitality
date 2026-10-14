import { useState } from "react";
import { NotificationRefreshProvider } from "../../features/notifications/NotificationRefreshProvider.jsx";
import { Header } from "./Header.jsx";
import { PageContainer } from "./PageContainer.jsx";
import { Sidebar } from "./Sidebar.jsx";

export function AppShell({ children, navigationGroups, profile, title }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("aazira-admin-sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  const collapsible = Boolean(navigationGroups);
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try { localStorage.setItem("aazira-admin-sidebar-collapsed", String(next)); } catch { /* Keep the in-memory preference. */ }
      return next;
    });
  };

  return (
    <NotificationRefreshProvider><div className={`app-shell ${collapsible && sidebarCollapsed ? "app-shell--sidebar-collapsed" : ""}`.trim()}>
      <Sidebar collapsed={collapsible && sidebarCollapsed} isOpen={sidebarOpen} navigationGroups={navigationGroups} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen ? <button aria-label="Close navigation" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} type="button" /> : null}
      <div className="app-shell__main"><Header collapsed={collapsible && sidebarCollapsed} collapsible={collapsible} onSidebarControlClick={() => { if (window.matchMedia("(max-width: 1024px)").matches) setSidebarOpen((open) => !open); else toggleSidebarCollapsed(); }} profile={profile} title={title} /><PageContainer>{children}</PageContainer></div>
    </div></NotificationRefreshProvider>
  );
}
