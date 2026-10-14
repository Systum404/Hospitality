import { Badge } from "../../../components/ui/Badge.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";

export function OperationalSnapshot({ items }) {
  return <Card className="admin-snapshot"><CardHeader><CardTitle>Operational snapshot</CardTitle><CardDescription>Current hotel-local operational signals.</CardDescription></CardHeader><CardContent><div className="snapshot-list">{items.map((item) => <article key={item.label}><div><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div><Badge variant={item.tone}>{item.badge}</Badge></article>)}</div></CardContent></Card>;
}
