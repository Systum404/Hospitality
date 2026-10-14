import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Textarea } from "../../../components/ui/Textarea.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getHotelSettings, updateHotelBillingSettings, updateHotelMetadata } from "../../settings/services/hotelSettingsService.js";
import { adminNavigationGroups as navigationGroups, adminProfile as profile } from "../adminConfig.js";

const metadataFields = ["name", "type", "address_line", "city", "state_province", "country", "postal_code", "phone", "official_email", "timezone", "logo_url", "website", "tax_registration_number", "description", "check_in_time", "check_out_time"];
const requiredFields = new Set(["name", "type", "address_line", "city", "state_province", "country", "postal_code", "phone", "official_email", "timezone"]);
const labels = { name: "Hotel Name", type: "Hotel Type", address_line: "Address", city: "City", state_province: "State / Province", country: "Country", postal_code: "Postal Code", phone: "Phone", official_email: "Official Email", timezone: "IANA Timezone", logo_url: "Logo URL", website: "Website", tax_registration_number: "Tax Registration Number", description: "Description", check_in_time: "Check-in Time", check_out_time: "Check-out Time" };
function Toggle({ checked, disabled, label, onChange }) { return <div className="settings-toggle-row"><div><strong>{label}</strong><span>Apply a configurable service charge to eligible restaurant food charges.</span></div><button aria-checked={checked} aria-label={label} className={`settings-switch ${checked ? "is-on" : ""}`} disabled={disabled} onClick={() => onChange(!checked)} role="switch" type="button"><i /></button></div>; }

export function AdminSettingsPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [hotel, setHotel] = useState(null);
  const [billing, setBilling] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!user?.hotelId) return;
    const controller = new AbortController();
    getHotelSettings(user.hotelId, { signal: controller.signal }).then(result => { setData(result); setHotel(result.hotel); setBilling(result.billing); }).catch(failure => { if (failure.name !== "AbortError") setError(failure.message); });
    return () => controller.abort();
  }, [user?.hotelId]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const hotelInput = Object.fromEntries(metadataFields.map(field => [field, hotel[field] === "" && !requiredFields.has(field) ? null : hotel[field]]));
      const [hotelResult, billingResult] = await Promise.all([
        updateHotelMetadata(user.hotelId, hotelInput),
        updateHotelBillingSettings(user.hotelId, { service_charge_enabled: billing.service_charge_enabled, service_charge_rate: billing.service_charge_rate, default_tax_slab_id: billing.default_tax_slab_id || null }),
      ]);
      setHotel(hotelResult.hotel); setBilling(billingResult.billing); setToast({ title: "Settings saved", message: "Authoritative hotel settings were updated." });
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <AppShell navigationGroups={navigationGroups} profile={profile} title="Settings"><div className="settings-page">
    <header className="settings-page__header"><div><p className="eyebrow">Hotel administration</p><h2>Settings</h2><Breadcrumb /><p>Authoritative hotel information and billing defaults</p></div><Button disabled={busy || !data} icon={Save} onClick={save}>{busy ? "Saving…" : "Save Changes"}</Button></header>
    {error ? <p role="alert">{error}</p> : null}
    {!data ? error ? <EmptyState title="Unable to load settings" description={error} /> : <LoadingState label="Loading hotel settings" /> : <section className="settings-primary-grid">
      <Card className="settings-card settings-hotel-card"><CardHeader><CardTitle>Hotel Information</CardTitle><p>Stored hotel metadata used by operational workflows</p></CardHeader><CardContent><div className="settings-form">
        {metadataFields.map(field => field === "description" || field === "address_line" ? <Textarea key={field} label={labels[field]} rows={field === "description" ? 4 : 3} value={hotel[field] ?? ""} onChange={event => setHotel(current => ({ ...current, [field]: event.target.value }))} /> : <Input key={field} label={labels[field]} type={field === "official_email" ? "email" : field.endsWith("_time") ? "time" : field.endsWith("_url") || field === "website" ? "url" : "text"} value={hotel[field] ?? ""} onChange={event => setHotel(current => ({ ...current, [field]: event.target.value }))} />)}
      </div></CardContent></Card>
      <Card className="settings-card settings-billing-card"><CardHeader><CardTitle>Billing Preferences</CardTitle><p>Defaults for new draft bills; staff retain draft selection control</p></CardHeader><CardContent><div className="settings-preference-list">
        <Toggle checked={billing.service_charge_enabled} disabled={busy} label="Service Charge" onChange={value => setBilling(current => ({ ...current, service_charge_enabled: value }))} />
        <Input disabled={!billing.service_charge_enabled || busy} label="Service Charge Rate (%)" max="100" min="0" step="0.01" type="number" value={billing.service_charge_rate} onChange={event => setBilling(current => ({ ...current, service_charge_rate: event.target.value }))} />
        <Select disabled={busy} label="Default Tax" value={billing.default_tax_slab_id ?? ""} onChange={event => setBilling(current => ({ ...current, default_tax_slab_id: event.target.value || null }))}><option value="">No default tax</option>{data.active_tax_options.map(tax => <option key={tax.id} value={tax.id}>{tax.name} · {tax.rate}%</option>)}</Select>
      </div></CardContent></Card>
    </section>}
  </div>{toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} /></div> : null}</AppShell>;
}
