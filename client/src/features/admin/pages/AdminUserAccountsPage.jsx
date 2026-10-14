import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Eye, EyeOff, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { SearchInput } from "../../../components/ui/SearchInput.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { adminNavigationGroups as navigationGroups, adminProfile as profile } from "../adminConfig.js";
import { createUser, deleteUser, getUsers, updateUser, updateUserStatus } from "../services/userAccountsService.js";

const emptyDraft = () => ({ email: "", is_active: true, name: "", password: "", role_id: "" });
const formatDate = (value) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

function UserForm({ draft, errors, mode, onChange, passwordVisible, roles, setPasswordVisible }) {
  return <div className="user-account-form">
    <Input label="Full Name *" name="user-full-name" onChange={(event) => onChange({ name: event.target.value })} placeholder="e.g. Rahul Sharma" value={draft.name} />
    {errors.name ? <span className="user-form-error">{errors.name}</span> : null}
    <Input label="Email *" name="user-email" onChange={(event) => onChange({ email: event.target.value })} placeholder="email@hotel.com" type="email" value={draft.email} />
    {errors.email ? <span className="user-form-error">{errors.email}</span> : null}
    <div className="user-account-form__row"><Select label="Role *" name="user-role" onChange={(event) => onChange({ role_id: event.target.value })} value={draft.role_id}><option value="">Select a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select><Select label="Status" name="user-status" onChange={(event) => onChange({ is_active: event.target.value === "active" })} value={draft.is_active ? "active" : "inactive"}><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
    {errors.role_id ? <span className="user-form-error">{errors.role_id}</span> : null}
    <label className="field" htmlFor="user-password"><span className="field__label">Password {mode === "add" ? "*" : ""}</span><span className="user-password-control"><input className="field__control" id="user-password" onChange={(event) => onChange({ password: event.target.value })} placeholder={mode === "add" ? "Min 8 characters" : "Leave blank to keep unchanged"} type={passwordVisible ? "text" : "password"} value={draft.password} /><button aria-label={passwordVisible ? "Hide password" : "Show password"} className="icon-button" onClick={() => setPasswordVisible((visible) => !visible)} type="button">{passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
    {errors.password ? <span className="user-form-error">{errors.password}</span> : null}
  </div>;
}

export function AdminUserAccountsPage() {
  const { signOut, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("add");
  const [editingUser, setEditingUser] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState({});
  const [userPendingDeletion, setUserPendingDeletion] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entitlement, setEntitlement] = useState(null);

  const report = useCallback(async (requestError) => {
    if (requestError?.status === 401) { await signOut().catch(() => {}); return; }
    setToast({ title: "Unable to complete request", message: requestError?.message || "Please try again.", variant: "error" });
  }, [signOut]);
  const loadUsers = useCallback(async () => {
    if (!user?.hotelId) return;
    setLoading(true);
    try { const result = await getUsers(user.hotelId); setUsers(result.users); setRoles(result.roles); setEntitlement(result.entitlement); } catch (requestError) { await report(requestError); } finally { setLoading(false); }
  }, [report, user?.hotelId]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filters = useMemo(() => ["All", ...roles.map((role) => role.name)], [roles]);
  const counts = useMemo(() => Object.fromEntries(filters.map((role) => [role, role === "All" ? users.length : users.filter((account) => account.role?.name === role).length])), [filters, users]);
  const visibleUsers = useMemo(() => { const needle = query.trim().toLowerCase(); return users.filter((account) => (filter === "All" || account.role?.name === filter) && (!needle || account.name.toLowerCase().includes(needle) || account.email.toLowerCase().includes(needle))); }, [filter, query, users]);
  const updateDraft = (change) => { setDraft((current) => ({ ...current, ...change })); setErrors({}); };
  const openAdd = () => { setEditorMode("add"); setEditingUser(null); setDraft(emptyDraft()); setErrors({}); setPasswordVisible(false); setEditorOpen(true); };
  const openEdit = (account) => { setEditorMode("edit"); setEditingUser(account); setDraft({ email: account.email, is_active: account.is_active, name: account.name, password: "", role_id: String(account.role?.id || "") }); setErrors({}); setPasswordVisible(false); setEditorOpen(true); };
  const closeEditor = () => { if (!busy) { setEditorOpen(false); setErrors({}); setPasswordVisible(false); } };

  const saveUser = async () => {
    const nextErrors = {}; const name = draft.name.trim(); const email = draft.email.trim().toLowerCase();
    if (!name) nextErrors.name = "Full name is required.";
    if (!email) nextErrors.email = "Email is required."; else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "Enter a valid email address.";
    if (!draft.role_id) nextErrors.role_id = "Role is required.";
    if (editorMode === "add" && !draft.password) nextErrors.password = "Password is required."; else if (draft.password && draft.password.length < 8) nextErrors.password = "Password must be at least 8 characters.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setBusy(true);
    try {
      const base = { email, is_active: draft.is_active, name, role_id: Number(draft.role_id) }; const isEditing = editorMode === "edit";
      if (isEditing) { const patch = { email: base.email, name: base.name, role_id: base.role_id }; if (draft.password) patch.password = draft.password; await updateUser(user.hotelId, editingUser.id, patch); if (editingUser.is_active !== base.is_active) await updateUserStatus(user.hotelId, editingUser.id, base.is_active); } else await createUser(user.hotelId, { ...base, password: draft.password });
      setEditorOpen(false); await loadUsers(); setToast({ title: isEditing ? "User updated" : "User created", message: `${name} is registered as ${roles.find((role) => role.id === base.role_id)?.name || "the selected role"}.` });
    } catch (requestError) { await report(requestError); } finally { setBusy(false); }
  };
  const toggleUser = async (account) => { setBusy(true); try { await updateUserStatus(user.hotelId, account.id, !account.is_active); await loadUsers(); setToast({ title: account.is_active ? "User deactivated" : "User activated", message: `${account.name} status was updated.` }); } catch (requestError) { await report(requestError); } finally { setBusy(false); } };
  const confirmDelete = async () => { if (busy || !userPendingDeletion?.id) return; setBusy(true); try { await deleteUser(user.hotelId, userPendingDeletion.id); setUserPendingDeletion(null); await loadUsers(); setToast({ title: "User deleted", message: `${userPendingDeletion.name} was permanently deleted.` }); } catch (requestError) { await report(requestError); } finally { setBusy(false); } };

  return <AppShell navigationGroups={navigationGroups} profile={profile} title="User Accounts"><div className="user-accounts-page">
    <header className="user-accounts-page__header"><div><p className="eyebrow">Team administration</p><h2>User Accounts</h2><Breadcrumb /><p>{users.length} staff members registered</p></div><Button disabled={loading || busy || entitlement?.plan === "UNASSIGNED"} icon={Plus} onClick={openAdd}>Add User</Button></header>
    {entitlement ? <Card className="user-entitlement-card"><CardContent><div className="user-entitlement-summary"><div><span>Hotel access plan</span><Badge variant={entitlement.plan === "PREMIUM" ? "info" : entitlement.plan === "FREE" ? "success" : "warning"}>{entitlement.plan.toLowerCase()}</Badge></div>{Object.entries(entitlement.usage).map(([role, usage]) => <div key={role}><span>{role.replaceAll("_", " ")}</span><strong>{usage.active} / {usage.limit ?? "Unlimited"}</strong>{usage.grandfathered ? <small>{usage.grandfathered} grandfathered</small> : null}</div>)}</div></CardContent></Card> : null}
    <div className="search-with-filter search-with-filter--spaced"><SearchInput className="user-accounts-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email..." value={query} /><FilterButton><div aria-label="Filter users by role" className="user-role-tabs" role="group">{filters.map((role) => <button aria-pressed={filter === role} className={filter === role ? "is-active" : ""} key={role} onClick={() => setFilter(role)} type="button">{role} <span>({counts[role]})</span></button>)}</div></FilterButton></div>
    {loading ? <LoadingState label="Loading user accounts" /> : visibleUsers.length ? <Card className="user-accounts-card"><CardHeader><div className="user-table-heading"><div><CardTitle>Staff directory</CardTitle><p>{visibleUsers.length} {visibleUsers.length === 1 ? "account" : "accounts"} shown</p></div></div></CardHeader><CardContent><div className="user-table-wrap"><table className="user-accounts-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={6} items={visibleUsers}>{(account) => <tr className={account.is_active ? "" : "user-row--inactive"} key={account.id}><td><div className="user-account-identity"><div><strong>{account.name}</strong><small>{account.email}</small></div></div></td><td><a href={`mailto:${account.email}`}>{account.email}</a></td><td><Badge variant="info">{account.role?.name || "—"}</Badge></td><td><Badge variant={account.is_active ? "success" : "neutral"}>{account.is_active ? "active" : "inactive"}</Badge></td><td>{formatDate(account.created_at)}</td><td><div className="user-account-actions"><button aria-label={`${account.is_active ? "Deactivate" : "Activate"} ${account.name}`} className={`icon-button status-action status-action--${account.is_active ? "active" : "inactive"}`} disabled={busy} onClick={() => toggleUser(account)} title={account.is_active ? "Deactivate" : "Activate"} type="button"><Ban size={16} /></button><button aria-label={`Edit ${account.name}`} className="icon-button" disabled={busy} onClick={() => openEdit(account)} title="Edit" type="button"><Pencil size={16} /></button><button aria-label={`Delete ${account.name}`} className="icon-button user-account-delete" disabled={busy} onClick={() => setUserPendingDeletion(account)} title="Delete" type="button"><Trash2 size={16} /></button></div></td></tr>}</PaginatedTableBody></table></div></CardContent></Card> : <EmptyState description="Try another role or search term." icon={UsersRound} title="No user accounts found" />}
  </div><Modal actions={<><Button disabled={busy} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={busy} onClick={saveUser}>{editorMode === "add" ? "Create User" : "Save Changes"}</Button></>} description={editorMode === "add" ? "Create an account for an AAZIRA staff member." : "Update this staff account without changing its identity."} isOpen={editorOpen} onClose={closeEditor} title={editorMode === "add" ? "Add New User" : "Edit User"}><UserForm draft={draft} errors={errors} mode={editorMode} onChange={updateDraft} passwordVisible={passwordVisible} roles={roles} setPasswordVisible={setPasswordVisible} /></Modal><Modal actions={<><Button disabled={busy} onClick={() => setUserPendingDeletion(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={confirmDelete} variant="danger">Delete</Button></>} description={userPendingDeletion ? `Are you sure you want to permanently delete this user? ${userPendingDeletion.name}'s account and role assignment will be removed.` : "Are you sure you want to permanently delete this user?"} isOpen={Boolean(userPendingDeletion)} onClose={() => !busy && setUserPendingDeletion(null)} title="Delete User?" />{toast ? <div className="toast-region"><Toast {...toast} onDismiss={() => setToast(null)} /></div> : null}</AppShell>;
}
