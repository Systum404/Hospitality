import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { createSession, endSession, getSession, selectSessionContext } from "./services/authService.js";

const AuthContext = createContext(null);
const legacySessionKeys = ["aazira-auth-session", "aazira-auth-session-temporary"];

export const dashboardByRole = {
  Admin: "/admin/dashboard",
  Manager: "/manager/dashboard",
  Reception: "/reception/dashboard",
  Captain: "/captain/dashboard",
  Kitchen: "/kitchen/dashboard",
};

export function dashboardForUser(user) {
  if (user?.roleKey === "SUPER_ADMIN" && user?.scope === "COMPANY" && user?.hotelId === null) return "/company/overview";
  return dashboardByRole[user?.role] || null;
}

function SessionUnavailable() {
  return (
    <main className="route-state" role="alert">
      <h1>Unable to verify your session.</h1>
      <p>Please check the server connection and try again.</p>
      <button onClick={() => window.location.reload()} type="button">Try again</button>
    </main>
  );
}

function clearLegacySessions() {
  try {
    legacySessionKeys.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
  } catch {
    // Legacy browser state is never used as authentication authority.
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    clearLegacySessions();

    getSession({ signal: controller.signal })
      .then((sessionUser) => { if (active) { setUser(sessionUser); setSessionError(false); } })
      .catch((error) => {
        if (!active || error.name === "AbortError") return;
        setUser(null);
        setSessionError(error?.status !== 401);
      })
      .finally(() => { if (active) setIsLoading(false); });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const signIn = useCallback(async ({ identifier, password, remember }) => {
    const sessionUser = await createSession({ identifier, password, remember });
    setUser(sessionUser);
    setSessionError(false);
    return sessionUser;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await endSession();
    } finally {
      setUser(null);
      setSessionError(false);
    }
  }, []);

  const selectContext = useCallback(async ({ assignmentId, challenge }) => {
    const sessionUser = await selectSessionContext({ assignmentId, challenge });
    setUser(sessionUser);
    setSessionError(false);
    return sessionUser;
  }, []);

  const value = useMemo(() => ({ isAuthenticated: Boolean(user), isLoading, selectContext, sessionError, signIn, signOut, user }), [isLoading, selectContext, sessionError, signIn, signOut, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function StaffAuthBoundary() {
  return <AuthProvider><Outlet /></AuthProvider>;
}

export function ProtectedRoute({ allowedRoleKeys, allowedRoles, allowedScopes }) {
  const { isLoading, sessionError, signOut, user } = useAuth();
  const location = useLocation();
  const destination = dashboardForUser(user);
  useEffect(() => {
    if (user && !destination) signOut().catch(() => {});
  }, [destination, signOut, user]);
  if (isLoading) return null;
  if (sessionError) return <SessionUnavailable />;
  if (!user) return <Navigate replace state={{ from: location.pathname }} to="/login" />;
  if (!destination) return null;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate replace to={destination} />;
  if (allowedRoleKeys && !allowedRoleKeys.includes(user.roleKey)) return <Navigate replace to={destination} />;
  if (allowedScopes && !allowedScopes.includes(user.scope)) return <Navigate replace to={destination} />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { isLoading, sessionError, signOut, user } = useAuth();
  const destination = dashboardForUser(user);
  useEffect(() => {
    if (user && !destination) signOut().catch(() => {});
  }, [destination, signOut, user]);
  if (isLoading) return null;
  if (sessionError) return <SessionUnavailable />;
  if (user && !destination) return null;
  return user ? <Navigate replace to={destination} /> : <Outlet />;
}
