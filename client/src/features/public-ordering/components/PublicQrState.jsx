import { AlertCircle, LoaderCircle, QrCode } from "lucide-react";

export function PublicQrState({ action, description, loading = false, title }) {
  const Icon = loading ? LoaderCircle : title?.toLowerCase().includes("unavailable") ? AlertCircle : QrCode;
  return (
    <section className="public-order-state" role={loading ? "status" : "alert"}>
      <Icon aria-hidden="true" className={loading ? "is-spinning" : ""} size={30} />
      <h1>{title}</h1>
      <p>{description}</p>
      {action || null}
    </section>
  );
}
