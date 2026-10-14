import { ArrowUpRight } from "lucide-react";
import { SemanticIcon } from "./SemanticIcon.jsx";

export function MetricCard({ action, description, featured = false, icon: Icon, iconTone, label, trend, value }) {
  return (
    <article className={`metric-card ${featured ? "metric-card--featured" : ""}`}>
      <div className="metric-card__top">
        {Icon ? <SemanticIcon className="metric-card__icon" icon={Icon} semantic={label} tone={iconTone} /> : null}
      </div>
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__label">{label}</span>
      <div className="metric-card__bottom">
        <span className="metric-card__description">{description}</span>
        {trend ? <span className="metric-card__trend"><ArrowUpRight aria-hidden="true" size={15} />{trend}</span> : null}
        {action || null}
      </div>
    </article>
  );
}
