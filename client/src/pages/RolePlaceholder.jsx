export function RolePlaceholder({ role }) {
  return (
    <main className="role-placeholder">
      <section className="role-placeholder__panel" aria-labelledby="workspace-title">
        <p className="eyebrow">AAZIRA · Hotel Operations</p>
        <h1 id="workspace-title">{role} workspace</h1>
        <p>
          The {role.toLowerCase()} dashboard foundation is ready for the next build phase.
        </p>
      </section>
    </main>
  );
}
