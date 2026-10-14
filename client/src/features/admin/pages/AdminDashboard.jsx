import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getAdminDashboard } from "../services/adminService.js";
import { ActiveVendors } from "../components/ActiveVendors.jsx";
import { AdminDashboardAdditions } from "../components/AdminDashboardAdditions.jsx";
import { AdminDashboardUtilities } from "../components/AdminDashboardUtilities.jsx";
import { AdminMetricCard } from "../components/AdminMetricCard.jsx";
import { OperationalSnapshot } from "../components/OperationalSnapshot.jsx";
import { RecentOrders } from "../components/RecentOrders.jsx";
import { RevenueOverview } from "../components/RevenueOverview.jsx";
import { adminNavigationGroups, adminProfile } from "../adminConfig.js";

export function AdminDashboard() {
  const { signOut, user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user?.hotelId) return undefined;
    const controller = new AbortController();
    setError("");
    getAdminDashboard(user.hotelId, { signal: controller.signal }).then(setDashboard).catch((requestError) => {
      if (requestError.name === "AbortError") return;
      if (requestError.status === 401) return signOut();
      setError(requestError.message || "Unable to load dashboard data.");
    });
    return () => controller.abort();
  }, [signOut, user?.hotelId]);

  const formatMoney = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
  const percentage = (value, total) => total ? `${Math.round((value / total) * 100)}%` : "0%";
  const collectionTrend = dashboard ? (() => {
    const current = Number(dashboard.metrics.monthCollections);
    const previous = Number(dashboard.metrics.previousMonthCollections);
    if (!previous) return current ? "New" : "0%";
    const change = Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
    return `${change > 0 ? "+" : ""}${change}%`;
  })() : "0%";
  const metrics = dashboard ? [
    { id: "revenue", label: "Total collections", value: formatMoney(dashboard.metrics.monthCollections), detail: "This month", trend: collectionTrend, tone: "featured" },
    { id: "orders", label: "Active orders", value: String(dashboard.metrics.activeOrders), detail: `${dashboard.metrics.preparingOrders} in kitchen`, trend: "Live", tone: "info" },
    { id: "staff", label: "Total staff", value: String(dashboard.metrics.totalStaff), detail: `${dashboard.metrics.presentStaff} present today`, trend: percentage(dashboard.metrics.presentStaff, dashboard.metrics.totalStaff), tone: "success" },
    { id: "tables", label: "Total tables", value: String(dashboard.metrics.totalTables), detail: `${dashboard.metrics.occupiedTables} occupied now`, trend: percentage(dashboard.metrics.occupiedTables, dashboard.metrics.totalTables), tone: "warning" },
    { id: "menu", label: "Menu items", value: String(dashboard.metrics.menuItems), detail: `${dashboard.metrics.menuCategories} categories`, trend: "Current", tone: "neutral" },
    { id: "vendors", label: "Active vendors", value: String(dashboard.metrics.activeVendors), detail: `${dashboard.metrics.inactiveVendors} inactive`, trend: "Active", tone: "success" },
  ] : [];
  const snapshot = dashboard ? [
    { label: "Occupancy", value: `${dashboard.operationalSnapshot.occupancyPercent}%`, detail: `${dashboard.operationalSnapshot.occupiedRooms} of ${dashboard.operationalSnapshot.totalActiveRooms} active rooms checked in`, tone: "info", badge: "Current" },
    { label: "Orders today", value: String(dashboard.operationalSnapshot.ordersToday), detail: `${dashboard.operationalSnapshot.activeOrders} orders currently active`, tone: "info", badge: "Current" },
    { label: "Staff present", value: `${dashboard.operationalSnapshot.presentStaff} / ${dashboard.operationalSnapshot.totalStaff}`, detail: "Recorded for the hotel-local date", tone: "neutral", badge: "Recorded" },
    { label: "Low stock items", value: String(dashboard.operationalSnapshot.lowStockCount), detail: dashboard.operationalSnapshot.lowStockCount ? "Requires review" : "No low-stock items", tone: dashboard.operationalSnapshot.lowStockCount ? "warning" : "success", badge: dashboard.operationalSnapshot.lowStockCount ? "Review" : "Clear" },
    { label: "Pending approvals", value: "—", detail: "Not configured", tone: "neutral", badge: "Unavailable" },
  ] : [];

  const dateLabel = dashboard ? new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dashboard.meta.localDate}T00:00:00.000Z`)) : "";

  if (!dashboard && !error) return <AppShell navigationGroups={adminNavigationGroups} profile={adminProfile} title="Hotel Management System"><LoadingState label="Preparing your workspace" /></AppShell>;
  if (error) return <AppShell navigationGroups={adminNavigationGroups} profile={adminProfile} title="Hotel Management System"><div className="route-state" role="alert"><h2>Unable to load the Admin Dashboard.</h2><p>{error}</p></div></AppShell>;

  return (
    <AppShell navigationGroups={adminNavigationGroups} profile={adminProfile} title="Hotel Management System">
      <div className="admin-workspace">
        <section className="admin-workspace__hero">
          <div>
            <h2>Admin Dashboard</h2>
            <Breadcrumb />
          </div>
          <p className="admin-workspace__date dashboard-heading-date"><CalendarDays aria-hidden="true" size={15} />{dateLabel}</p>
        </section>
        <section className="admin-workspace__metrics">
          {metrics.map((metric) => <AdminMetricCard key={metric.id} metric={metric} />)}
        </section>
        <section className="admin-workspace__tables">
          <RecentOrders orders={dashboard.recentOrders} timezone={dashboard.meta.timezone} />
          <ActiveVendors vendors={dashboard.vendors} />
        </section>
        <AdminDashboardAdditions roomBookings={dashboard.roomBookings} staffActivity={dashboard.staffActivity} />
        <section className="admin-workspace__insights">
          <RevenueOverview revenue={dashboard.revenueOverview} />
          <OperationalSnapshot items={snapshot} />
        </section>
        <AdminDashboardUtilities alerts={dashboard.alerts} />
      </div>
    </AppShell>
  );
}
