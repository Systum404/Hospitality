import { CheckCircle2, Info, X } from "lucide-react";

export function Toast({ message, onDismiss, title = "Saved", variant = "success" }) {
  const Icon = variant === "success" ? CheckCircle2 : Info;
  const statusTone = /deactivated/i.test(title) ? "deactivated" : /activated/i.test(title) ? "activated" : "";
  const StatusIcon = statusTone === "deactivated" ? X : Icon;

  return (
    <div className={`toast toast--${variant}${statusTone ? ` toast--${statusTone}` : ""}`} role="status">
      <StatusIcon aria-hidden="true" size={20} />
      <div><strong>{title}</strong><span>{message}</span></div>
      <button aria-label="Dismiss notification" className="icon-button" onClick={onDismiss} type="button"><X size={17} /></button>
    </div>
  );
}
