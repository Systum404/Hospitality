import { RevenueChart } from "../../../components/shared/RevenueChart.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";

export function RevenueOverview({ revenue }) {
  const total = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(revenue.totalCollections));
  return <Card className="admin-revenue-overview"><CardHeader><CardTitle>Revenue overview</CardTitle><CardDescription>Monthly recorded collections for {revenue.year}.</CardDescription></CardHeader><CardContent><div className="chart-key"><span><i />Monthly collections</span><strong>{total}</strong></div><RevenueChart labels={revenue.labels} values={revenue.values} /></CardContent></Card>;
}
