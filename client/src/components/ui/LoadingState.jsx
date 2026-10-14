export function LoadingState({ label = "Loading" }) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-state__spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}
