import { Inbox } from "lucide-react";
import { SemanticIcon } from "./SemanticIcon.jsx";

export function EmptyState({ action, description = "There is nothing to show here yet.", icon: Icon = Inbox, title = "No results" }) {
  return (
    <div className="empty-state">
      <SemanticIcon className="empty-state__icon" icon={Icon} semantic={title} size="lg" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action || null}
    </div>
  );
}
