import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, Download, IndianRupee, ReceiptIndianRupee, ShoppingBag } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { MetricCard } from "../../../components/ui/MetricCard.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { billingMoney } from "../../billing/utils/billingLinePresentation.js";
import { adminNavigationGroups as navigationGroups, adminProfile as profile } from "../adminConfig.js";
import { getAdminReport } from "../services/adminReportsService.js";

export const adminReportRangeLabels = { today: "Today", yesterday: "Yesterday", week: "This Week", month: "This Month", year: "This Year" };

const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csvRow = values => values.map(csvCell).join(",");

export function buildAdminReportCsv(report) {
  if (!report) return "";
  const rows = [
    ["Hotel Admin Report"], ["Range", report.meta.range], ["From", report.meta.from], ["To", report.meta.to],
    ["Timezone", report.meta.timezone], ["Generated At", report.meta.generatedAt], [],
    ["Summary", "Value", "Prior-period change (%)"],
    ["Collections", report.summary.collections, report.summary.comparisons.collections],
    ["Orders", report.summary.orders, report.summary.comparisons.orders],
    ["Average Bill", report.summary.averageBill, report.summary.comparisons.averageBill],
    ["Outstanding", report.summary.outstanding, ""], ["Active Orders", report.summary.activeOrders, ""],
    ["Completed Orders", report.summary.completedOrders, ""], [], ["Order Source", "Count"],
    ["Room Service", report.orderBreakdown.roomService], ["Restaurant", report.orderBreakdown.restaurant],
    ["Captain", report.orderBreakdown.captain], ["Dining Table QR", report.orderBreakdown.diningTableQr], [],
    ["Billing Type", "Count", "Total", "Outstanding"],
    ["Room", report.billingBreakdown.room.count, report.billingBreakdown.room.total, report.billingBreakdown.room.outstanding],
    ["Restaurant", report.billingBreakdown.restaurant.count, report.billingBreakdown.restaurant.total, report.billingBreakdown.restaurant.outstanding],
    [], ["Trend Bucket", "Collections", "Orders"], ...report.trend.map(entry => [entry.label, entry.collections, entry.orders]),
    [], ["Top Item", "Quantity", "Subtotal"], ...report.topItems.map(item => [item.name, item.quantity, item.subtotal]),
    [], ["Category", "Quantity", "Subtotal", "Percentage"], ...report.categories.map(category => [category.name, category.quantity, category.subtotal, category.percentage]),
    ["Unresolved historical item quantity", report.meta.categoryCoverage.unresolvedQuantity],
  ];
  return `\uFEFF${rows.map(csvRow).join("\r\n")}`;
}

export function downloadAdminReportCsv(report, documentObject = document, urlObject = URL) {
  const url = urlObject.createObjectURL(new Blob([buildAdminReportCsv(report)], { type: "text/csv;charset=utf-8" }));
  const link = documentObject.createElement("a");
  link.href = url;
  link.download = `hotel-admin-report-${report.meta.range}-${report.meta.from}-${report.meta.to}.csv`;
  documentObject.body.appendChild(link);
  link.click();
  link.remove();
  urlObject.revokeObjectURL(url);
}

function comparison(value) {
  if (value == null) return "No prior-period baseline";
  return `${value > 0 ? "+" : ""}${value}% vs prior period`;
}

function ReportTrendChart({ values }) {
  const collectionMaximum = Math.max(...values.map(entry => Number(entry.collections)), 1);
  const orderMaximum = Math.max(...values.map(entry => Number(entry.orders)), 1);
  return <div className="reports-sales-chart" role="img" aria-label="Collections and orders trend">{values.map(entry => <div className="reports-sales-chart__column" key={entry.key}>
    <span title={`${billingMoney(entry.collections)} collections · ${entry.orders} orders`}>{billingMoney(entry.collections)} · {entry.orders}</span>
    <div className="reports-sales-chart__track"><i className="is-collections" style={{ height: `${Math.max(Number(entry.collections) ? 8 : 0, Number(entry.collections) / collectionMaximum * 100)}%` }} /><i className="is-orders" style={{ height: `${Math.max(Number(entry.orders) ? 8 : 0, Number(entry.orders) / orderMaximum * 100)}%` }} /></div>
    <strong>{entry.label}</strong>
  </div>)}</div>;
}

function BreakdownTable({ report }) {
  const rows = [
    ["Active orders", report.summary.activeOrders, "—", "—"], ["Completed orders", report.summary.completedOrders, "—", "—"],
    ["Room service orders", report.orderBreakdown.roomService, "—", "—"], ["Restaurant orders", report.orderBreakdown.restaurant, "—", "—"],
    ["Room bills", report.billingBreakdown.room.count, billingMoney(report.billingBreakdown.room.total), billingMoney(report.billingBreakdown.room.outstanding)],
    ["Restaurant bills", report.billingBreakdown.restaurant.count, billingMoney(report.billingBreakdown.restaurant.total), billingMoney(report.billingBreakdown.restaurant.outstanding)],
  ];
  return <div className="reports-table-wrap"><table className="reports-table reports-table--compact"><thead><tr><th>Breakdown</th><th>Count</th><th>Total</th><th>Outstanding</th></tr></thead><tbody>{rows.map(row => <tr key={row[0]}>{row.map((value, index) => <td key={`${row[0]}-${index}`}>{index === 0 ? <strong>{value}</strong> : value}</td>)}</tr>)}</tbody></table></div>;
}

export function AdminReportsPage() {
  const { signOut, user } = useAuth();
  const [range, setRange] = useState("today");
  const [result, setResult] = useState({ report: null, loading: true, error: "" });
  useEffect(() => {
    if (!user?.hotelId) { setResult({ report: null, loading: false, error: "An authenticated hotel is required." }); return undefined; }
    const controller = new AbortController();
    setResult({ report: null, loading: true, error: "" });
    getAdminReport(user.hotelId, range, { signal: controller.signal })
      .then(report => setResult({ report, loading: false, error: "" }))
      .catch(async error => {
        if (error.name === "AbortError") return;
        if (error.status === 401) { await signOut().catch(() => {}); return; }
        setResult({ report: null, loading: false, error: error.message || "Unable to load report data." });
      });
    return () => controller.abort();
  }, [range, signOut, user?.hotelId]);

  const report = result.report;
  const summary = useMemo(() => report ? [
    { label: "Collections", value: billingMoney(report.summary.collections), description: comparison(report.summary.comparisons.collections), icon: IndianRupee },
    { label: "Orders", value: new Intl.NumberFormat("en-IN").format(report.summary.orders), description: comparison(report.summary.comparisons.orders), icon: ShoppingBag },
    { label: "Average Bill", value: billingMoney(report.summary.averageBill), description: comparison(report.summary.comparisons.averageBill), icon: ReceiptIndianRupee },
    { label: "Outstanding", value: billingMoney(report.summary.outstanding), description: "Non-void bill balances", icon: AlertTriangle },
  ] : [], [report]);
  const noActivity = report ? report.summary.orders === 0 && Number(report.summary.collections) === 0 && Number(report.summary.outstanding) === 0 && report.topItems.length === 0 : false;
  const topQuantity = Math.max(...(report?.topItems.map(item => item.quantity) || [0]), 1);

  return <AppShell navigationGroups={navigationGroups} profile={profile} title="Reports"><div className="reports-page">
    <header className="reports-page__header"><div><p className="eyebrow">Performance insights</p><h2>Reports</h2><Breadcrumb /><p>Collections, orders, billing, and menu performance</p></div><div aria-label="Select report period" className="reports-period-tabs" role="group">{Object.entries(adminReportRangeLabels).map(([value, label]) => <button aria-pressed={range === value} className={range === value ? "is-active" : ""} disabled={result.loading} key={value} onClick={() => setRange(value)} type="button">{label}</button>)}</div></header>
    {result.loading ? <LoadingState label="Loading Hotel Admin reports" /> : result.error || !report ? <EmptyState description={result.error || "Please try again."} icon={AlertTriangle} title="Unable to load report data" /> : <>
      <div className="reports-export-row"><p>{report.meta.from} to {report.meta.to} · {report.meta.timezone}</p><Button icon={Download} onClick={() => downloadAdminReportCsv(report)} size="sm" variant="outline">Export CSV</Button></div>
      <section aria-label={`${adminReportRangeLabels[range]} report summary`} className="reports-summary-grid">{summary.map(metric => <MetricCard {...metric} key={metric.label} />)}</section>
      {noActivity ? <EmptyState description="No payments, orders, or outstanding bills were found for this period." icon={BarChart3} title="No report activity" /> : <>
        <section className="reports-insights-grid"><Card className="reports-chart-card"><CardHeader><CardTitle>Collections &amp; Orders Trend</CardTitle></CardHeader><CardContent><ReportTrendChart values={report.trend} /></CardContent></Card><Card className="reports-top-items"><CardHeader><CardTitle>Top Items</CardTitle></CardHeader><CardContent>{report.topItems.length ? <ol>{report.topItems.map((item, index) => <li key={item.name}><span className="reports-item-rank">#{index + 1}</span><div><div className="reports-item-copy"><span><strong>{item.name}</strong><small>{item.quantity} items</small></span><b>{billingMoney(item.subtotal)}</b></div><div className="reports-item-progress"><i style={{ width: `${item.quantity / topQuantity * 100}%` }} /></div></div></li>)}</ol> : <EmptyState description="Completed order items will appear here." title="No top items" />}</CardContent></Card></section>
        <Card className="reports-bills-card"><CardHeader><CardTitle>Order Lifecycle &amp; Billing Breakdown</CardTitle></CardHeader><CardContent><BreakdownTable report={report} /></CardContent></Card>
        <Card className="reports-bills-card reports-category-card"><CardHeader><CardTitle>Category Distribution</CardTitle></CardHeader><CardContent>{report.categories.length ? <div className="reports-table-wrap"><table className="reports-table reports-table--compact"><thead><tr><th>Category</th><th>Quantity</th><th>Subtotal</th><th>Share</th></tr></thead><tbody>{report.categories.map(category => <tr key={category.name}><td><strong>{category.name}</strong></td><td>{category.quantity}</td><td>{billingMoney(category.subtotal)}</td><td>{category.percentage}%</td></tr>)}</tbody></table></div> : <EmptyState description="Completed categorized order items will appear here." title="No category distribution" />}</CardContent></Card>
      </>}
    </>}
  </div></AppShell>;
}
