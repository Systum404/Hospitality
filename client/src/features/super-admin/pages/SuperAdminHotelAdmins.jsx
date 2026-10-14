import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Building2, Copy, KeyRound, MailPlus, RefreshCw, ShieldCheck, UserCheck, UserX, XCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { CompanyPage } from "../components/CompanyPage.jsx";
import {
  createAdminInvitation,
  listAdminInvitations,
  listAllCompanyHotels,
  listHotelAdmins,
  resendAdminInvitation,
  resetCompanyUserPassword,
  revokeAdminInvitation,
  setCompanyIdentityActive,
  setHotelAdminAssignmentActive,
} from "../services/companyControlPlaneService.js";

const emptyInvite = () => ({ email: "", full_name: "", mobile_number: "" });
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

function DeliveryPanel({ delivery, onClose, title = "Invitation ready" }) {
  const [copied, setCopied] = useState(false);
  const absoluteUrl = delivery?.invitation_url ? new URL(delivery.invitation_url, window.location.origin).toString() : "";
  useEffect(() => { setCopied(false); }, [absoluteUrl]);
  const copy = async () => { await navigator.clipboard.writeText(absoluteUrl); setCopied(true); };
  const close = () => { setCopied(false); onClose(); };
  return <Modal actions={<Button onClick={close}>Done</Button>} description="Email delivery is not configured. Copy this one-time invitation URL and share it through an approved secure channel." isOpen={Boolean(delivery)} onClose={close} title={title}><div className="company-secret-panel"><label htmlFor="invitation-url">Invitation URL</label><div><input id="invitation-url" readOnly value={absoluteUrl} /><Button icon={Copy} onClick={copy} variant="secondary">{copied ? "Copied" : "Copy"}</Button></div><p>The application does not persist this URL in browser storage.</p></div></Modal>;
}

function TemporaryPasswordPanel({ resetResult, onClose }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [resetResult]);
  const copy = async () => { await navigator.clipboard.writeText(resetResult.temporaryPassword); setCopied(true); };
  const close = () => { setCopied(false); onClose(); };
  return <Modal actions={<Button onClick={close}>I have stored it securely</Button>} description="This temporary password is displayed once. The user must replace it at the next sign-in." isOpen={Boolean(resetResult)} onClose={close} title="Temporary password created"><div className="company-secret-panel"><label htmlFor="temporary-password">Temporary password</label><div><input id="temporary-password" readOnly type="text" value={resetResult?.temporaryPassword || ""} /><Button icon={Copy} onClick={copy} variant="secondary">{copied ? "Copied" : "Copy"}</Button></div><p>Do not place this credential in email logs, URLs, notes, or browser storage.</p></div></Modal>;
}

export function InvitationHotelContext({ hotel }) {
  if (!hotel) return null;
  return <div aria-label="Invitation hotel" className="company-invitation-hotel-context"><Building2 aria-hidden="true" size={20} /><div><span>Invitation hotel</span><strong>{hotel.name}</strong><small>{hotel.code}</small><p>The new Hotel Admin invitation will be created for this hotel.</p></div></div>;
}

export function SuperAdminHotelAdmins() {
  const { signOut, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hotels, setHotels] = useState([]);
  const [hotelId, setHotelId] = useState(searchParams.get("hotel") || "");
  const [admins, setAdmins] = useState([]);
  const [globalAdmins, setGlobalAdmins] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState(emptyInvite);
  const [confirm, setConfirm] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [toast, setToast] = useState(null);
  const report = useCallback(async (error) => { if (error.status === 401) return signOut(); setToast({ title: "Unable to complete request", message: error.message, variant: "error" }); }, [signOut]);
  const loadGlobalAdmins = useCallback(async (availableHotels) => {
    const results = await Promise.all(availableHotels.map(async (hotel) => (await listHotelAdmins(hotel.id)).admins));
    const identities = new Map();
    results.flat().forEach((admin) => identities.set(admin.user.id, { user: admin.user }));
    setGlobalAdmins([...identities.values()].sort((left, right) => left.user.name.localeCompare(right.user.name)));
  }, []);
  useEffect(() => { listAllCompanyHotels().then(async ({ items }) => { setHotels(items); setHotelId((current) => current || items[0]?.id || ""); await loadGlobalAdmins(items); }).catch(report).finally(() => setLoading(false)); }, [loadGlobalAdmins, report]);
  const load = useCallback(async () => {
    if (!hotelId) { setAdmins([]); setInvitations([]); return; }
    setLoading(true);
    try { const [adminData, invitationData] = await Promise.all([listHotelAdmins(hotelId), listAdminInvitations(hotelId)]); setAdmins(adminData.admins); setInvitations(invitationData.invitations); }
    catch (error) { await report(error); } finally { setLoading(false); }
  }, [hotelId, report]);
  useEffect(() => { load(); }, [load]);
  const selectedHotel = useMemo(() => hotels.find((hotel) => hotel.id === hotelId), [hotelId, hotels]);
  const chooseHotel = (value) => { setHotelId(value); setSearchParams(value ? { hotel: value } : {}); };
  const sendInvitation = async () => { if (!invite.full_name.trim() || !invite.email.trim() || !invite.mobile_number.trim()) return setToast({ title: "Invitation incomplete", message: "Name, email, and mobile number are required.", variant: "error" }); setBusy(true); try { const result = await createAdminInvitation(hotelId, { full_name: invite.full_name.trim(), email: invite.email.trim().toLowerCase(), mobile_number: invite.mobile_number.trim() }); setInviteOpen(false); setInvite(emptyInvite()); setDelivery(result.delivery); await load(); } catch (error) { await report(error); } finally { setBusy(false); } };
  const resend = async (invitation) => { setBusy(true); try { const result = await resendAdminInvitation(invitation.id); setDelivery(result.delivery); await load(); } catch (error) { await report(error); } finally { setBusy(false); } };
  const runConfirmed = async () => {
    setBusy(true);
    try {
      if (confirm.type === "assignment") await setHotelAdminAssignmentActive(hotelId, confirm.admin.assignment_id, confirm.active);
      if (confirm.type === "identity") await setCompanyIdentityActive(confirm.admin.user.id, confirm.active);
      if (confirm.type === "revoke") await revokeAdminInvitation(confirm.invitation.id);
      if (confirm.type === "password") {
        setResetResult(await resetCompanyUserPassword(confirm.admin.user.id));
      }
      setToast({ title: "Change saved", message: confirm.message }); setConfirm(null); await load(); await loadGlobalAdmins(hotels);
    } catch (error) { await report(error); } finally { setBusy(false); }
  };
  const resetPassword = (admin) => setConfirm({
    type: "password",
    admin,
    title: "Reset user password?",
    message: `${admin.user.name}'s current password and sessions will be invalidated. A one-time temporary password will be returned and a permanent password will be required at next sign-in.`,
  });

  return <CompanyPage actions={<Button disabled={!hotelId || selectedHotel?.status !== "ACTIVE"} icon={MailPlus} onClick={() => setInviteOpen(true)}>Invite Hotel Admin</Button>} description="Manage hotel-scoped assignments separately from global user identities." title="Hotel Admins & Users">
    <div className="company-hotel-picker"><Select label="Hotel" onChange={(event) => chooseHotel(event.target.value)} value={hotelId}><option value="">Select a hotel</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name} ({hotel.code})</option>)}</Select>{selectedHotel ? <Badge variant={selectedHotel.status === "ACTIVE" ? "success" : "neutral"}>{selectedHotel.status.toLowerCase()}</Badge> : null}</div>
    {loading ? <LoadingState label="Loading Hotel Admins" /> : <div className="company-admin-sections">
      <Card><CardHeader><div className="company-section-heading"><div><CardTitle>Global identities</CardTitle><p>Company-wide user accounts. Hotel access is managed through assignments below.</p></div></div></CardHeader><CardContent>{globalAdmins.length ? <div className="company-identity-grid">{globalAdmins.map((identity) => <article key={identity.user.id}><header><div><strong>{identity.user.name}</strong><span>{identity.user.email}</span></div><Badge variant={identity.user.is_active ? "success" : "neutral"}>{identity.user.is_active ? "identity active" : "identity inactive"}</Badge></header><CopyableIdentifier label="user ID" value={identity.user.id} /><footer><Button disabled={busy} icon={identity.user.is_active ? UserX : UserCheck} onClick={() => setConfirm({ type: "identity", admin: { user: identity.user }, active: !identity.user.is_active, title: `${identity.user.is_active ? "Deactivate" : "Reactivate"} global identity?`, message: identity.user.is_active ? `${identity.user.name} will be unable to sign in and active Hotel Admin assignments across all hotels will be disabled.` : `${identity.user.name} will be able to sign in and eligible assignments will be restored by the backend.` })} size="sm" variant="secondary">{identity.user.is_active ? "Deactivate Identity" : "Reactivate Identity"}</Button><Button disabled={busy || identity.user.id === user.id} icon={KeyRound} onClick={() => setConfirm({ type: "password", admin: { user: identity.user }, title: "Reset user password?", message: `${identity.user.name}'s current password and sessions will be invalidated. A one-time temporary password will be returned and a permanent password will be required at next sign-in.` })} size="sm" variant="secondary">Reset Password</Button></footer></article>)}</div> : <EmptyState description="Hotel Admin identities appear after invitations are created." icon={ShieldCheck} title="No global Hotel Admin identities" />}</CardContent></Card>
      <Card><CardHeader><div className="company-section-heading"><div><CardTitle>Hotel Admin assignments</CardTitle><p>Assignment status controls access to this hotel. Identity status controls the account globally.</p></div></div></CardHeader><CardContent>{admins.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Identity</th><th>Assignment</th><th>Identity status</th><th>Actions</th></tr></thead><tbody>{admins.map((admin) => {
        const assignmentActive = admin.status === "ACTIVE";
        const identityActive = admin.user.is_active;
        return <tr key={admin.assignment_id}><td><strong>{admin.user.name}</strong><span>{admin.user.email}</span><CopyableIdentifier label="user ID" value={admin.user.id} /></td><td><Badge variant={assignmentActive ? "success" : "danger"}>{admin.status.toLowerCase()}</Badge><CopyableIdentifier label="assignment ID" value={admin.assignment_id} /></td><td><Badge variant={identityActive ? "success" : "neutral"}>{identityActive ? "active" : "inactive"}</Badge></td><td><div className="company-row-actions"><button aria-label={`${assignmentActive ? "Deactivate" : "Reactivate"} assignment for ${admin.user.name}`} className={`icon-button company-assignment-action--${assignmentActive ? "deactivate" : "reactivate"}`} disabled={busy || selectedHotel?.status !== "ACTIVE"} onClick={() => setConfirm({ type: "assignment", admin, active: !assignmentActive, title: `${assignmentActive ? "Deactivate" : "Reactivate"} assignment?`, message: `${admin.user.name}'s hotel assignment was updated.` })} title="Change hotel assignment status" type="button"><Ban size={16} /></button><button aria-label={`${identityActive ? "Deactivate" : "Reactivate"} identity for ${admin.user.name}`} className={`icon-button company-assignment-action--${identityActive ? "deactivate" : "reactivate"}`} disabled={busy} onClick={() => setConfirm({ type: "identity", admin, active: !identityActive, title: `${identityActive ? "Deactivate" : "Reactivate"} global identity?`, message: `${admin.user.name}'s global identity was updated.` })} title="Change global identity status" type="button">{identityActive ? <UserX size={16} /> : <UserCheck size={16} />}</button><button aria-label={`Reset password for ${admin.user.name}`} className="icon-button company-assignment-action--reset" disabled={busy || admin.user.id === user.id} onClick={() => resetPassword(admin)} title="Reset password" type="button"><KeyRound size={16} /></button></div></td></tr>;
      })}</tbody></table></div> : <EmptyState description="Create an invitation to onboard this hotel's first administrator." icon={ShieldCheck} title="No Hotel Admin assignments" />}</CardContent></Card>
      <Card><CardHeader><CardTitle>Invitations</CardTitle></CardHeader><CardContent>{invitations.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Email</th><th>Status</th><th>Created</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td><Badge variant={invitation.status === "PENDING" ? "warning" : invitation.status === "ACCEPTED" ? "success" : "neutral"}>{invitation.status.toLowerCase()}</Badge></td><td>{formatDate(invitation.created_at)}</td><td>{formatDate(invitation.expires_at)}</td><td><div className="company-row-actions"><button aria-label={`Resend invitation to ${invitation.email}`} className="icon-button" disabled={busy || invitation.status !== "PENDING"} onClick={() => resend(invitation)} title="Resend invitation" type="button"><RefreshCw size={16} /></button><button aria-label={`Revoke invitation to ${invitation.email}`} className="icon-button" disabled={busy || invitation.status !== "PENDING"} onClick={() => setConfirm({ type: "revoke", invitation, title: "Revoke invitation?", message: `The invitation for ${invitation.email} was revoked.` })} title="Revoke invitation" type="button"><XCircle size={16} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState description="No invitation history exists for this hotel." icon={MailPlus} title="No invitations" />}</CardContent></Card>
    </div>}
    <Modal actions={<><Button disabled={busy} onClick={() => setInviteOpen(false)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={sendInvitation}>Create Invitation</Button></>} description="Only a new Hotel Admin identity can be invited. Existing-user assignment remains intentionally unsupported." isOpen={inviteOpen} onClose={() => !busy && setInviteOpen(false)} title="Invite Hotel Admin"><InvitationHotelContext hotel={selectedHotel} /><div className="company-form-grid"><Input label="Full name *" onChange={(event) => setInvite((current) => ({ ...current, full_name: event.target.value }))} value={invite.full_name} /><Input label="Email *" onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} type="email" value={invite.email} /><Input label="Mobile number *" onChange={(event) => setInvite((current) => ({ ...current, mobile_number: event.target.value }))} value={invite.mobile_number} /></div></Modal>
    <Modal actions={<><Button disabled={busy} onClick={() => setConfirm(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={runConfirmed} variant="danger">Confirm</Button></>} description="The server will enforce authorization, hotel scope, lifecycle rules, and audit logging." isOpen={Boolean(confirm)} onClose={() => !busy && setConfirm(null)} title={confirm?.title || "Confirm change"}><p>{confirm?.message}</p></Modal>
    <DeliveryPanel delivery={delivery} onClose={() => setDelivery(null)} title="Invitation ready" />
    <TemporaryPasswordPanel onClose={() => setResetResult(null)} resetResult={resetResult} />
    {toast ? <div className="toast-region"><Toast {...toast} onDismiss={() => setToast(null)} /></div> : null}
  </CompanyPage>;
}
