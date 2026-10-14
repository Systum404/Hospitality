import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BedDouble, BellRing, CalendarDays, Clock3, DoorOpen, IndianRupee, ReceiptIndianRupee, TableProperties, UserRoundPlus, UsersRound, UtensilsCrossed } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { MetricCard } from "../../../components/ui/MetricCard.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { useNotificationRefresh } from "../../notifications/NotificationRefreshProvider.jsx";
import { formatReceptionDashboardMoney as money, getReceptionDashboardNotificationPreview } from "../receptionDashboardPresentation.js";
import { getReceptionDashboard } from "../services/receptionService.js";
import { receptionNavigationGroups, receptionProfile } from "../receptionConfig.js";

const metricIcons = { collections: IndianRupee, guests: UsersRound, rooms: DoorOpen, available: BedDouble, checkins: UserRoundPlus, bills: ReceiptIndianRupee };
const statusVariants = { pending: "warning", preparing: "warning", ready: "success", reserved: "warning", confirmed: "success" };
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
const displayTime = (value, timezone) => value ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value)) : "—";
const displayBookingDate = value => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)) : "—";
const displayNotificationTime = (value, timezone) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)) : "—";

function ReceptionSectionCard({ action, children, className = "", title }) {
  return <Card className={`reception-section-card ${className}`.trim()}><CardHeader><div className="reception-card-heading"><CardTitle>{title}</CardTitle>{action || null}</div></CardHeader><CardContent>{children}</CardContent></Card>;
}

function QuickActions() {
  const navigate = useNavigate();
  const actions = [
    { icon: UserRoundPlus, title: "Guest Check-In", description: "Register new guest arrival", to: "/reception/guest-check-in" },
    { icon: TableProperties, title: "Table Management", description: "View & manage table status", to: "/reception/tables" },
    { icon: BedDouble, title: "Room Booking", description: "New room reservation", to: "/reception/room-booking" },
    { icon: ReceiptIndianRupee, title: "Billing & Payment", description: "Process bills & room orders", to: "/reception/billing" },
  ];
  return <section className="reception-quick-actions"><h3>Quick Actions</h3><div>{actions.map(({ icon, title, description, to }) => <button key={title} onClick={() => navigate(to)} type="button"><SemanticIcon icon={icon} semantic={title} /><div><strong>{title}</strong><small>{description}</small></div><ArrowRight aria-hidden="true" className="reception-quick-actions__arrow" size={16} /></button>)}</div></section>;
}

function RecentCheckIns({ items, timezone }) {
  const navigate = useNavigate();
  return <ReceptionSectionCard action={<Button className="view-all-link" onClick={() => navigate("/reception/room-booking")} size="sm" variant="ghost">View All <ArrowRight size={15} /></Button>} className="reception-checkins" title="Recent Check-Ins">{items.length ? <div className="reception-checkin-list">{items.map(item => <article key={item.id}><span className="reception-avatar">{initials(item.guestName)}</span><div><strong>{item.guestName}</strong><p><CopyableIdentifier label="booking ID" value={item.bookingNumber} /> · Room {item.roomNumber} · {item.guests} guests</p></div><time>{displayTime(item.checkedInAt, timezone)}</time></article>)}</div> : <EmptyState description="Completed guest check-ins will appear here." icon={UserRoundPlus} title="No recent check-ins" />}</ReceptionSectionCard>;
}

function CheckoutAlerts({ items }) {
  return <ReceptionSectionCard className="reception-balanced-card" title="Pending Checkouts">{items.length ? <div className="reception-operational-list">{items.map(item => <article key={item.id}><div><strong>{item.guestName}</strong><small>Room {item.roomNumber} · Due {displayBookingDate(item.dueAt)}{item.activeRoomOrderCount ? ` · ${item.activeRoomOrderCount} active orders` : ""}</small></div><div><b>{item.billBalance === null ? "No bill" : money(item.billBalance)}</b><Badge variant="warning">Due</Badge></div></article>)}</div> : <EmptyState description="Due checked-in stays will appear here." icon={Clock3} title="No pending checkouts" />}</ReceptionSectionCard>;
}

function TodaysArrivals({ items }) {
  return <ReceptionSectionCard className="reception-balanced-card" title="Today's Bookings">{items.length ? <div className="reception-operational-list">{items.map(item => <article key={item.id}><div><strong>{item.guestName}</strong><small><CopyableIdentifier label="booking ID" value={item.bookingNumber} /> · Room {item.roomNumber}</small></div><div><b>{displayBookingDate(item.arrivalAt)}</b><Badge variant={statusVariants[item.status]}>{item.status}</Badge></div></article>)}</div> : <EmptyState description="Reserved and confirmed arrivals will appear here." icon={CalendarDays} title="No arrivals today" />}</ReceptionSectionCard>;
}

function ReceptionAlerts() {
  const { data, error, loading } = useNotificationRefresh();
  const items = getReceptionDashboardNotificationPreview(data);
  return <ReceptionSectionCard className="reception-alerts-card" title="Alerts & Notifications">{error && !items.length ? <EmptyState description={error} icon={BellRing} title="Unable to load notifications" /> : loading && !items.length ? <LoadingState label="Loading notifications" /> : items.length ? <div className="reception-alert-list">{items.map(item => <article className="reception-alert reception-alert--info" key={item.id}><span><BellRing aria-hidden="true" size={18} /></span><div><strong>{item.title}</strong><p>{item.message}</p></div><time>{displayNotificationTime(item.createdAt, data.timezone)}</time></article>)}</div> : <EmptyState description="New operational notifications will appear here." icon={BellRing} title="No notifications" />}</ReceptionSectionCard>;
}

function ActiveRoomOrders({ items }) {
  const navigate = useNavigate();
  return <ReceptionSectionCard action={<Button className="view-all-link" onClick={() => navigate("/reception/billing")} size="sm" variant="ghost">View All <ArrowRight size={15} /></Button>} className="reception-room-orders" title="Active Room Orders">{items.length ? <div className="reception-operational-list">{items.map(item => <article key={item.id}><div><strong><CopyableIdentifier label="order ID" value={item.orderNumber} /></strong><small>Room {item.roomNumber} · {item.itemCount} items</small></div><Badge variant={statusVariants[item.status] || "info"}>{item.status}</Badge></article>)}</div> : <EmptyState description="New room-service orders will appear here automatically." icon={UtensilsCrossed} title="No active room orders" />}</ReceptionSectionCard>;
}

export function ReceptionDashboard() {
  const { user, signOut } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setRefreshVersion(value => value + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => {
    if (!user?.hotelId) return;
    const controller = new AbortController(); setDashboard(null); setError("");
    getReceptionDashboard(user.hotelId, { signal: controller.signal }).then(setDashboard).catch(async failure => {
      if (failure.name === "AbortError") return;
      if (failure.status === 401) await signOut().catch(() => {});
      else setError(failure.message || "Reception dashboard could not be loaded.");
    });
    return () => controller.abort();
  }, [user?.hotelId, signOut, refreshVersion]);
  const metrics = useMemo(() => dashboard ? [
    { id: "collections", label: "Today's Collections", value: money(dashboard.summary.todayCollections), description: "Recorded room payments today", featured: true },
    { id: "guests", label: "Current Guests", value: String(dashboard.summary.currentGuestCount), description: `${dashboard.summary.todayCheckIns} checked in · ${dashboard.summary.todayCheckOuts} checked out today` },
    { id: "rooms", label: "Rooms Occupied", value: `${dashboard.summary.occupiedRooms}/${dashboard.summary.totalActiveRooms}`, description: "Rooms with checked-in bookings" },
    { id: "available", label: "Available Rooms", value: String(dashboard.summary.availableRooms), description: "Active and unreserved now" },
    { id: "checkins", label: "Confirmed Bookings", value: String(dashboard.summary.confirmedBookings), description: "Arriving today" },
    { id: "bills", label: "Pending Room Payments", value: money(dashboard.summary.pendingPaymentAmount), description: `${dashboard.summary.pendingPaymentCount} bills awaiting payment` },
  ] : [], [dashboard]);
  const timezone = dashboard?.meta.timezone;
  const today = timezone ? new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: timezone }).format(new Date(dashboard.meta.generatedAt)) : "";
  return <AppShell navigationGroups={receptionNavigationGroups} profile={receptionProfile} title="Reception Dashboard">
    {error ? <main className="reception-dashboard"><EmptyState description={error} icon={BellRing} title="Unable to load Reception Dashboard" /><Button onClick={() => setRefreshVersion(value => value + 1)}>Try Again</Button></main> : dashboard ? <main className="reception-dashboard">
      <header className="reception-dashboard__hero"><div><h2>Reception Dashboard</h2><Breadcrumb /></div><p className="dashboard-heading-date"><CalendarDays aria-hidden="true" size={15} />Today's Overview - {today}</p></header>
      <section aria-label="Reception overview" className="reception-metrics">{metrics.map(metric => <MetricCard description={metric.description} featured={metric.featured} icon={metricIcons[metric.id]} key={metric.id} label={metric.label} value={metric.value} />)}</section>
      <QuickActions />
      <RecentCheckIns items={dashboard.recentCheckIns} timezone={timezone} />
      <section className="reception-lower-grid"><CheckoutAlerts items={dashboard.checkoutAlerts} /><TodaysArrivals items={dashboard.arrivals} /></section>
      <ReceptionAlerts />
      <ActiveRoomOrders items={dashboard.activeRoomOrders} />
    </main> : <LoadingState label="Preparing the Reception workspace" />}
  </AppShell>;
}
