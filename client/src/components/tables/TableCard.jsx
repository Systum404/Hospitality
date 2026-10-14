import { Badge } from "../ui/Badge.jsx";
import { Card, CardContent } from "../ui/Card.jsx";

export function TableCard({
  actions,
  className,
  guestClassName,
  guestDescription,
  guestTitle,
  headingLabel,
  statusVariant,
  styledSeparator = false,
  table,
}) {
  return (
    <Card className={`${className} ${className}--${table.status}`}>
      <CardContent>
        <header>
          {headingLabel ? <div><small>{headingLabel}</small><h3>{table.id}</h3></div> : <h3>{table.id}</h3>}
          <Badge variant={statusVariant}>{table.status}</Badge>
        </header>
        <p>{table.area} {styledSeparator ? <span>·</span> : "·"} {table.capacity} pax</p>
        <div className={guestClassName}><strong>{guestTitle}</strong><small>{guestDescription}</small></div>
        <footer>{actions}</footer>
      </CardContent>
    </Card>
  );
}
