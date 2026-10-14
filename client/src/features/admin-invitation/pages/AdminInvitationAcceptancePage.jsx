import { useEffect, useState } from "react";
import { Building2, CheckCircle2, LockKeyhole, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../../components/ui/Button.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { acceptAdminInvitation, inspectAdminInvitation, selectAdminInvitationPlan } from "../services/adminInvitationAcceptanceService.js";
import "../styles/adminInvitationAcceptance.css";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const emptyForm = { confirmPassword: "", fullName: "", mobileNumber: "", password: "" };

function safeMessage(error) {
  if (error?.code === "ADMIN_INVITATION_INVALID" || error?.status === 404) return "This invitation is invalid, expired, or no longer available.";
  return error?.message || "Unable to verify this invitation. Please try again.";
}

const PLAN_FEATURES = {
  FREE: ["1 Hotel Admin", "1 Manager", "1 Reception", "1 Kitchen", "10 Captains"],
  PREMIUM: ["Unlimited Hotel Admins", "Unlimited Managers", "Unlimited Reception", "Unlimited Kitchen", "Unlimited Captains"],
};

export function InvitationAcceptanceForm({ errors = {}, form = emptyForm, invitation, onChange = () => {}, onPlan = () => {}, onSubmit = () => {}, planBusy = false, submitting = false }) {
  return <section aria-labelledby="invitation-title" className="admin-invitation-panel">
    <div className="admin-invitation-brand"><span aria-hidden="true">A</span><div><strong>AAZIRA</strong><small>Hotel Management System</small></div></div>
    <header><p className="eyebrow">Hotel Admin invitation</p><h1 id="invitation-title">Set up your account</h1><p>Create your password to activate Hotel Admin access.</p></header>
    <div className="admin-invitation-hotel"><Building2 aria-hidden="true" size={20} /><div><span>Hotel</span><strong>{invitation.hotel.name}</strong><small>{invitation.hotel.code}</small></div></div>
    <dl className="admin-invitation-details"><div><dt>Role</dt><dd>Hotel Admin</dd></div><div><dt>Email</dt><dd>{invitation.email}</dd></div></dl>
    <section aria-labelledby="plan-selection-title" className="admin-invitation-plans"><div><h2 id="plan-selection-title">Choose hotel plan</h2><p>Select the access plan for this hotel. Payment arrangements are handled separately.</p></div><div className="admin-invitation-plan-grid">{Object.entries(PLAN_FEATURES).map(([plan, features]) => <button aria-pressed={invitation.hotel.plan === plan} className={invitation.hotel.plan === plan ? "is-selected" : ""} disabled={planBusy || submitting} key={plan} onClick={() => onPlan(plan)} type="button"><strong>{plan}</strong><ul>{features.map(feature => <li key={feature}>{feature}</li>)}</ul><span>{invitation.hotel.plan === plan ? "Selected" : "Select plan"}</span></button>)}</div>{errors.plan ? <p className="admin-invitation-message admin-invitation-message--error" role="alert">{errors.plan}</p> : null}</section>
    <form className="admin-invitation-form" noValidate onSubmit={onSubmit}>
      <Input autoComplete="name" hint={errors.fullName} id="invitation-full-name" label="Full name *" onChange={(event) => onChange("fullName", event.target.value)} value={form.fullName} />
      <Input autoComplete="tel" hint={errors.mobileNumber} id="invitation-mobile-number" label="Mobile number *" onChange={(event) => onChange("mobileNumber", event.target.value)} type="tel" value={form.mobileNumber} />
      <Input autoComplete="new-password" hint={errors.password} id="invitation-password" label="Password *" onChange={(event) => onChange("password", event.target.value)} type="password" value={form.password} />
      <Input autoComplete="new-password" hint={errors.confirmPassword} id="invitation-confirm-password" label="Confirm password *" onChange={(event) => onChange("confirmPassword", event.target.value)} type="password" value={form.confirmPassword} />
      {errors.request ? <p className="admin-invitation-message admin-invitation-message--error" role="alert">{errors.request}</p> : null}
      <Button className="admin-invitation-submit" disabled={submitting || planBusy || invitation.hotel.plan === "UNASSIGNED"} icon={LockKeyhole} type="submit">{submitting ? "Activating..." : "Activate Hotel Admin Account"}</Button>
    </form>
  </section>;
}

export function AdminInvitationAcceptancePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [invitation, setInvitation] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [pageError, setPageError] = useState("");

  useEffect(() => {
    let active = true;
    if (!TOKEN_PATTERN.test(token)) {
      setPageError("This invitation is invalid, expired, or no longer available.");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true); setPageError("");
    inspectAdminInvitation(token)
      .then(({ invitation: current }) => { if (active) setInvitation(current); })
      .catch((error) => { if (active) setPageError(safeMessage(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const update = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "", request: "" })); };
  const choosePlan = async (plan) => {
    setPlanBusy(true); setErrors((current) => ({ ...current, plan: "", request: "" }));
    try {
      await selectAdminInvitationPlan(token, plan);
      setInvitation((current) => ({ ...current, hotel: { ...current.hotel, plan } }));
    } catch (error) { setErrors((current) => ({ ...current, plan: safeMessage(error) })); }
    finally { setPlanBusy(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (invitation.hotel.plan === "UNASSIGNED") nextErrors.plan = "Select a hotel plan before activating the account.";
    if (!form.fullName.trim()) nextErrors.fullName = "Full name is required.";
    if (!form.mobileNumber.trim()) nextErrors.mobileNumber = "Mobile number is required.";
    if (form.password.length < 8) nextErrors.password = "Password must contain at least 8 characters.";
    if (form.confirmPassword !== form.password) nextErrors.confirmPassword = "Passwords do not match.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setSubmitting(true); setErrors({});
    try {
      await acceptAdminInvitation(token, { full_name: form.fullName.trim(), mobile_number: form.mobileNumber.trim(), password: form.password });
      setAccepted(true); setForm(emptyForm);
    } catch (error) { setErrors({ request: safeMessage(error) }); }
    finally { setSubmitting(false); }
  };

  if (loading) return <main className="admin-invitation-page"><section className="admin-invitation-state"><span className="admin-invitation-spinner" /><h1>Checking invitation</h1><p>Please wait while AAZIRA verifies this one-time invitation.</p></section></main>;
  if (pageError) return <main className="admin-invitation-page"><section className="admin-invitation-state" role="alert"><LockKeyhole aria-hidden="true" size={30} /><h1>Invitation unavailable</h1><p>{pageError}</p><Button icon={RefreshCw} onClick={() => window.location.reload()} variant="secondary">Try again</Button></section></main>;
  if (accepted) return <main className="admin-invitation-page"><section className="admin-invitation-state"><CheckCircle2 aria-hidden="true" size={36} /><h1>Account activated</h1><p>Your Hotel Admin account is ready. Sign in with your email and new password.</p><Link className="button button--primary button--md" to="/login"><span>Continue to Sign In</span></Link></section></main>;
  return <main className="admin-invitation-page"><InvitationAcceptanceForm errors={errors} form={form} invitation={invitation} onChange={update} onPlan={choosePlan} onSubmit={submit} planBusy={planBusy} submitting={submitting} /></main>;
}
