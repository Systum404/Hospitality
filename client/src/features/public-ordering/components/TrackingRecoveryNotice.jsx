import { LocateFixed, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui/Button.jsx";

export function TrackingRecoveryNotice({ capability, onDismiss }) {
  return (
    <aside aria-label="Current order tracking" className="public-tracking-recovery">
      <div>
        <strong>Already placed an order?</strong>
        <p>Continue tracking the latest order from this browser session.</p>
      </div>
      <div>
        <Link className="button button--primary button--md" to={`/order-tracking#${capability}`}><span className="button__icon"><LocateFixed aria-hidden="true" size={17} /></span><span>Continue tracking</span></Link>
        <Button aria-label="Dismiss order tracking recovery" icon={X} onClick={onDismiss} variant="ghost">Dismiss</Button>
      </div>
    </aside>
  );
}
