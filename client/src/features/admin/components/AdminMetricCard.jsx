import { CircleDollarSign, ClipboardList, CookingPot, MenuSquare, Store, TableProperties, UsersRound } from "lucide-react";
import { MetricCard } from "../../../components/ui/MetricCard.jsx";

const icons = { revenue: CircleDollarSign, orders: CookingPot, staff: UsersRound, tables: TableProperties, menu: MenuSquare, vendors: Store };

export function AdminMetricCard({ metric }) {
  return <MetricCard description={metric.detail} featured={metric.tone === "featured"} icon={icons[metric.id] || ClipboardList} label={metric.label} trend={metric.trend} value={metric.value} />;
}
