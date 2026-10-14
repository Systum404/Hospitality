import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellRing, ChevronLeft, ChevronRight, LogOut, Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthContext.jsx";
import { useNotificationRefresh } from "../../features/notifications/NotificationRefreshProvider.jsx";
import { SearchInput } from "../ui/SearchInput.jsx";
import { SemanticIcon } from "../ui/SemanticIcon.jsx";
import { UserProfileMini } from "./UserProfileMini.jsx";

function notificationTime(value, timezone) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
}

export function Header({ collapsed = false, collapsible = false, onSidebarControlClick, profile, title = "Hotel Management System" }) {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { busy: notificationBusy, data: notificationData, error: notificationError, loading: notificationLoading, markAllRead, markRead, refresh: loadNotifications, supported: supportsNotifications } = useNotificationRefresh();
  const resolvedProfile = { ...profile, name: user?.name || profile?.name };
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const notificationRef = useRef(null);
  const notificationButtonRef = useRef(null);
  const profileRef = useRef(null);
  const profileButtonRef = useRef(null);
  const notifications = useMemo(() => notificationData.notifications.map(item => ({
    ...item,
    description: item.message,
    icon: BellRing,
    time: notificationTime(item.createdAt, notificationData.timezone),
    tone: "blue",
  })), [notificationData]);
  const unreadCount = notificationData.unreadCount;

  useEffect(() => {
    if (!notificationOpen) return undefined;
    const closeOutside = (event) => { if (!notificationRef.current?.contains(event.target)) setNotificationOpen(false); };
    const closeOnEscape = (event) => { if (event.key === "Escape") { setNotificationOpen(false); notificationButtonRef.current?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [notificationOpen]);
  useEffect(() => {
    if (!profileOpen) return undefined;
    const closeOutside = (event) => { if (!profileRef.current?.contains(event.target)) setProfileOpen(false); };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setProfileOpen(false);
      profileButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    requestAnimationFrame(() => profileRef.current?.querySelector('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  const logout = async () => {
    setProfileOpen(false);
    try {
      await signOut();
    } catch {
      // Local authentication state is cleared even if the server is unreachable.
    } finally {
      navigate("/login", { replace: true });
    }
  };
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  return (
    <header className="header">
      <div className="header__title">{collapsible ? <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="icon-button header__sidebar-toggle" onClick={onSidebarControlClick} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} type="button">{collapsed ? <ChevronRight aria-hidden="true" size={17} /> : <ChevronLeft aria-hidden="true" size={17} />}</button> : null}<h1>{title}</h1></div>
      <div className="header__actions">
        <SearchInput className="header__search" />
        {supportsNotifications ? <div className="header-notifications" ref={notificationRef}>
          <button aria-controls="header-notification-popover" aria-expanded={notificationOpen} aria-haspopup="dialog" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"} className="icon-button header__notifications semantic-icon-control semantic-icon-control--amber" onClick={() => { setProfileOpen(false); setNotificationOpen((open) => { if (!open) void loadNotifications(); return !open; }); }} ref={notificationButtonRef} type="button"><Bell aria-hidden="true" size={19} />{unreadCount ? <span>{unreadCount}</span> : null}</button>
          {notificationOpen ? <section aria-label="Notifications" className="notification-popover" id="header-notification-popover" role="dialog">
            <header><div><h2>Notifications</h2><p>{unreadCount ? `${unreadCount} unread` : "You're all caught up"}</p></div><button aria-label="Close notifications" className="icon-button" onClick={() => { setNotificationOpen(false); notificationButtonRef.current?.focus(); }} type="button"><X aria-hidden="true" size={17} /></button></header>
            <div className="notification-popover__list">{notificationLoading && !notifications.length ? <p className="notification-popover__empty">Loading notifications...</p> : notificationError && !notifications.length ? <p className="notification-popover__empty" role="alert">{notificationError}</p> : notifications.length ? notifications.map(({ description, icon, id, isRead, time, title: itemTitle, tone }) => <button className={`notification-item ${isRead ? "is-read" : "is-unread"}`} disabled={notificationBusy} key={id} onClick={() => markRead(id)} type="button"><SemanticIcon className="notification-item__icon" icon={icon} semantic={itemTitle} size="sm" tone={tone} /><span><strong>{itemTitle}</strong><small>{description}</small><time>{time}</time></span>{!isRead ? <i aria-label="Unread" /> : null}</button>) : <p className="notification-popover__empty">No new notifications.</p>}</div>
            {notifications.length ? <footer><button disabled={!unreadCount || notificationBusy} onClick={markAllRead} type="button">Mark all as read</button></footer> : null}
          </section> : null}
        </div> : null}
        <button aria-label="Toggle fullscreen" className="icon-button header__fullscreen semantic-icon-control semantic-icon-control--blue" onClick={toggleFullscreen} type="button"><Maximize2 size={19} /></button>
        <div className="header-profile" ref={profileRef}>
          <button aria-controls="header-profile-menu" aria-expanded={profileOpen} aria-haspopup="menu" aria-label={`Open profile menu for ${resolvedProfile.name}`} className="header-profile__trigger" onClick={() => { setNotificationOpen(false); setProfileOpen((open) => !open); }} ref={profileButtonRef} type="button"><UserProfileMini compact {...resolvedProfile} /></button>
          {profileOpen ? <div aria-label="Profile options" className="header-profile__menu" id="header-profile-menu" role="menu">
            <div className="header-profile__identity"><span aria-hidden="true" className="avatar">{resolvedProfile.initials}</span><div><strong>{resolvedProfile.name}</strong><small>{resolvedProfile.title}</small></div></div>
            <button className="header-profile__logout" onClick={logout} role="menuitem" type="button"><LogOut aria-hidden="true" size={17} /><span>Logout</span></button>
          </div> : null}
        </div>
      </div>
    </header>
  );
}
