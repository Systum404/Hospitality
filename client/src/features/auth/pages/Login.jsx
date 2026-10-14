import { useState } from "react";
import { Building2, Eye, EyeOff, Hotel, LockKeyhole, LogIn, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../components/ui/Button.jsx";
import { dashboardForUser, useAuth } from "../AuthContext.jsx";
import { changeRequiredPassword } from "../services/authService.js";

export function Login() {
  const navigate = useNavigate();
  const { selectContext, signIn } = useAuth();
  const [form, setForm] = useState({ identifier: "", password: "", remember: false });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState(null);
  const [contextSelection, setContextSelection] = useState(null);
  const [passwordChange, setPasswordChange] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setMessage(null);
  };
  const finish = (user) => {
    const destination = dashboardForUser(user);
    if (!destination) throw Object.assign(new Error("Unsupported account role."), { code: "UNSUPPORTED_ACCOUNT_ROLE" });
    navigate(destination, { replace: true });
  };
  const showError = (error) => {
    if (error?.code === "ACCOUNT_CONTEXT_REQUIRED" && error.payload?.contextSelection) {
      setContextSelection(error.payload.contextSelection); setPasswordChange(null); setMessage(null); return;
    }
    if (error?.code === "PASSWORD_CHANGE_REQUIRED" && error.payload?.passwordChange) {
      setPasswordChange(error.payload.passwordChange); setContextSelection(null); setMessage(null); return;
    }
    const messages = { ACCOUNT_CONTEXT_UNAVAILABLE: "This account does not have an available role.", CONTEXT_SELECTION_INVALID: "That context selection expired. Please sign in again.", HOTEL_INACTIVE: "This hotel is inactive. Contact a company administrator.", PASSWORD_CHANGE_INVALID: "That password-change request expired. Please sign in again.", UNSUPPORTED_ACCOUNT_ROLE: "This account role is not supported by this application." };
    setMessage({ text: messages[error?.code] || (error?.code === "INVALID_CREDENTIALS" || error?.status === 401 ? "Invalid username or password." : error?.message || "Unable to sign in right now. Please try again."), tone: "error" });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    const identifier = form.identifier.trim();
    const nextErrors = {};
    if (!identifier) nextErrors.identifier = "Email is required.";
    if (!form.password) nextErrors.password = "Password is required.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true); setMessage(null);
    try { finish(await signIn({ ...form, identifier })); }
    catch (error) { showError(error); setForm((current) => ({ ...current, identifier, password: "" })); }
    finally { setSubmitting(false); }
  };
  const chooseContext = async (assignmentId) => {
    if (submitting) return;
    setSubmitting(true); setMessage(null);
    try { finish(await selectContext({ assignmentId, challenge: contextSelection.challenge })); }
    catch (error) { showError(error); if (error?.code === "CONTEXT_SELECTION_INVALID") setContextSelection(null); }
    finally { setSubmitting(false); }
  };
  const updatePassword = async (event) => {
    event.preventDefault();
    const nextErrors = {};
    if (newPassword.length < 8 || newPassword.length > 1024) nextErrors.newPassword = "Use 8 to 1024 characters.";
    if (newPassword !== confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSubmitting(true); setMessage(null);
    try {
      await changeRequiredPassword({ challenge: passwordChange.challenge, newPassword });
      setPasswordChange(null); setNewPassword(""); setConfirmPassword("");
      try { finish(await signIn({ identifier: form.identifier.trim(), password: newPassword, remember: form.remember })); }
      catch (error) { showError(error); }
    } catch (error) { showError(error); if (error?.code === "PASSWORD_CHANGE_INVALID") setPasswordChange(null); }
    finally { setSubmitting(false); }
  };

  return <main className="login-page">
    <section aria-labelledby="login-title" className="login-panel">
      <div className="login-brand"><span aria-hidden="true">A</span><div><strong>AAZIRA</strong><small>Hotel Management System</small></div></div>
      <div className="login-heading"><p className="eyebrow">Secure staff access</p><h1 id="login-title">{contextSelection ? "Choose your workspace" : passwordChange ? "Create a permanent password" : "Welcome Back"}</h1><p>{contextSelection ? "Select the role and property you want to use for this session." : passwordChange ? "Your temporary password must be replaced before access is granted." : "Sign in to continue to your dashboard."}</p></div>
      {message ? <div className={`login-message login-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}><LockKeyhole aria-hidden="true" size={17} /><span>{message.text}</span></div> : null}
      {contextSelection ? <div className="login-context-list">{contextSelection.assignments.map((assignment) => <button className="login-context-option" disabled={submitting} key={assignment.assignmentId} onClick={() => chooseContext(assignment.assignmentId)} type="button"><span className="login-context-option__icon">{assignment.scope === "COMPANY" ? <ShieldCheck aria-hidden="true" size={20} /> : <Building2 aria-hidden="true" size={20} />}</span><span><strong>{assignment.role}</strong><small>{assignment.hotel ? `${assignment.hotel.name} · ${assignment.hotel.code}` : "Company-wide access"}</small></span></button>)}<Button disabled={submitting} onClick={() => setContextSelection(null)} variant="ghost">Back to sign in</Button></div> : passwordChange ? <form className="login-form" noValidate onSubmit={updatePassword}><PasswordField error={errors.newPassword} id="new-password" label="New password" onChange={setNewPassword} value={newPassword} /><PasswordField error={errors.confirmPassword} id="confirm-password" label="Confirm new password" onChange={setConfirmPassword} value={confirmPassword} /><Button className="login-submit" disabled={submitting} icon={LockKeyhole} type="submit">{submitting ? "Updating..." : "Update Password & Continue"}</Button></form> : <form className="login-form" noValidate onSubmit={submit}>
        <div className="login-field"><label htmlFor="login-identifier">Email</label><div className={errors.identifier ? "login-control has-error" : "login-control"}><Mail aria-hidden="true" size={18} /><input autoComplete="username" autoFocus id="login-identifier" onChange={(event) => update("identifier", event.target.value)} placeholder="Enter your email" type="email" value={form.identifier} /></div>{errors.identifier ? <small className="login-field-error">{errors.identifier}</small> : null}</div>
        <div className="login-field"><label htmlFor="login-password">Password</label><div className={errors.password ? "login-control has-error" : "login-control"}><LockKeyhole aria-hidden="true" size={18} /><input autoComplete="current-password" id="login-password" onChange={(event) => update("password", event.target.value)} placeholder="Enter your password" type={passwordVisible ? "text" : "password"} value={form.password} /><button aria-label={passwordVisible ? "Hide password" : "Show password"} onClick={() => setPasswordVisible((visible) => !visible)} title={passwordVisible ? "Hide password" : "Show password"} type="button">{passwordVisible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}</button></div>{errors.password ? <small className="login-field-error">{errors.password}</small> : null}</div>
        <div className="login-options"><label><input checked={form.remember} onChange={(event) => update("remember", event.target.checked)} type="checkbox" /><span>Remember me</span></label><button onClick={() => setMessage({ text: "Please contact your administrator to reset your password.", tone: "info" })} type="button">Forgot password?</button></div>
        <Button className="login-submit" disabled={submitting} icon={LogIn} type="submit">{submitting ? "Signing in..." : "Sign In"}</Button>
      </form>}
      <p className="login-help">Don&apos;t have access? Contact your administrator.</p>
    </section>
    <aside aria-label="AAZIRA hospitality" className="login-visual"><div className="login-visual__content"><span><Hotel aria-hidden="true" size={20} /> Hotel operations</span><h2>Thoughtful hospitality starts with a clear view of every detail.</h2><p>One connected workspace for your front desk, restaurant floor, kitchen, and management team.</p></div></aside>
  </main>;
}

function PasswordField({ error, id, label, onChange, value }) {
  return <div className="login-field"><label htmlFor={id}>{label}</label><div className={error ? "login-control has-error" : "login-control"}><LockKeyhole aria-hidden="true" size={18} /><input autoComplete="new-password" id={id} onChange={(event) => onChange(event.target.value)} type="password" value={value} /></div>{error ? <small className="login-field-error">{error}</small> : null}</div>;
}
