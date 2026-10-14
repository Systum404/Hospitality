export function UserProfileMini({ compact = false, initials = "RS", name = "Reception", title = "Receptionist" }) {
  return (
    <div className={`user-profile-mini ${compact ? "user-profile-mini--compact" : ""}`}>
      <span aria-hidden="true" className="avatar">{initials}</span>
      <span className="user-profile-mini__details"><strong>{name}</strong><small>{title}</small></span>
    </div>
  );
}
