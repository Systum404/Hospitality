import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "./services/notificationService.js";
import { createNotificationPoller, supportsStaffNotificationPolling } from "./notificationRefresh.js";

const emptyNotificationData = Object.freeze({ notifications: [], unreadCount: 0, timezone: null });
const NotificationRefreshContext = createContext(null);

export function NotificationRefreshProvider({ children }) {
  const { signOut, user } = useAuth();
  const supported = supportsStaffNotificationPolling(user);
  const [data, setData] = useState(emptyNotificationData);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(supported);
  const [busy, setBusy] = useState(false);
  const pollerRef = useRef(null);
  const signOutStartedRef = useRef(false);

  const stopAndSignOut = useCallback(async () => {
    if (signOutStartedRef.current) return;
    signOutStartedRef.current = true;
    pollerRef.current?.stop();
    await signOut().catch(() => {});
  }, [signOut]);

  useEffect(() => {
    signOutStartedRef.current = false;
    if (!supported) {
      setData(emptyNotificationData);
      setError("");
      setLoading(false);
      return undefined;
    }

    let initialRequest = true;
    setData(emptyNotificationData);
    setLoading(true);
    setError("");
    const poller = createNotificationPoller({
      load: ({ signal }) => getNotifications(user.hotelId, { signal }),
      onData: (nextData) => {
        setData(nextData);
        setError("");
      },
      onError: async (requestError) => {
        if (requestError.status === 401) {
          await stopAndSignOut();
          return false;
        }
        setError(requestError.message || "Notifications could not be loaded.");
        return true;
      },
      onSettled: () => {
        if (initialRequest) {
          initialRequest = false;
          setLoading(false);
        }
      },
    });
    pollerRef.current = poller;
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [stopAndSignOut, supported, user?.hotelId]);

  const refresh = useCallback(() => pollerRef.current?.refresh() || Promise.resolve(), []);
  const refreshAfterCurrent = useCallback(() => pollerRef.current?.refreshAfterCurrent() || Promise.resolve(), []);

  const markRead = useCallback(async (notificationId) => {
    if (!supported || busy) return;
    setBusy(true);
    setError("");
    try {
      await markNotificationRead(user.hotelId, notificationId);
      await refreshAfterCurrent();
    } catch (requestError) {
      if (requestError.status === 401) await stopAndSignOut();
      else setError(requestError.message || "Notification could not be updated.");
    } finally {
      setBusy(false);
    }
  }, [busy, refreshAfterCurrent, stopAndSignOut, supported, user?.hotelId]);

  const markAllRead = useCallback(async () => {
    if (!supported || busy || !data.unreadCount) return;
    setBusy(true);
    setError("");
    try {
      await markAllNotificationsRead(user.hotelId);
      await refreshAfterCurrent();
    } catch (requestError) {
      if (requestError.status === 401) await stopAndSignOut();
      else setError(requestError.message || "Notifications could not be updated.");
    } finally {
      setBusy(false);
    }
  }, [busy, data.unreadCount, refreshAfterCurrent, stopAndSignOut, supported, user?.hotelId]);

  return <NotificationRefreshContext.Provider value={{ busy, data, error, loading, markAllRead, markRead, refresh, supported }}>{children}</NotificationRefreshContext.Provider>;
}

export function useNotificationRefresh() {
  const context = useContext(NotificationRefreshContext);
  if (!context) throw new Error("useNotificationRefresh must be used inside NotificationRefreshProvider");
  return context;
}
