import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Power, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { SearchInput } from "../../../components/ui/SearchInput.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { Textarea } from "../../../components/ui/Textarea.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { CompanyPage } from "../components/CompanyPage.jsx";
import { createCompanyHotel, listAllCompanyHotels, setCompanyHotelActive, updateCompanyHotel } from "../services/companyControlPlaneService.js";

const requiredFields = ["name", "type", "address_line", "city", "state_province", "country", "postal_code", "phone", "official_email", "timezone", "currency_code"];
const optionalFields = ["logo_url", "website", "tax_registration_number", "description", "check_in_time", "check_out_time"];
const emptyHotel = () => Object.fromEntries([...requiredFields, ...optionalFields].map((field) => [field, ""]));

function HotelForm({ draft, errors, onChange }) {
  const field = (name, label, type = "text") => <Input hint={errors[name]} label={`${label}${requiredFields.includes(name) ? " *" : ""}`} name={`hotel-${name}`} onChange={(event) => onChange(name, event.target.value)} type={type} value={draft[name] ?? ""} />;
  return <div className="company-form-grid">{field("name", "Hotel name")}{field("type", "Hotel type")}{field("official_email", "Official email", "email")}{field("phone", "Phone")}{field("address_line", "Address")} {field("city", "City")}{field("state_province", "State / province")}{field("country", "Country")}{field("postal_code", "Postal code")}{field("timezone", "IANA timezone")}{field("currency_code", "Currency code")}{field("logo_url", "Logo URL", "url")}{field("website", "Website", "url")}{field("tax_registration_number", "Tax registration number")}{field("check_in_time", "Check-in time", "time")}{field("check_out_time", "Check-out time", "time")}<Textarea className="company-form-grid__wide" label="Description" onChange={(event) => onChange("description", event.target.value)} rows="3" value={draft.description} /></div>;
}

export function SuperAdminHotels() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [hotels, setHotels] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState(emptyHotel);
  const [errors, setErrors] = useState({});
  const [pendingTransition, setPendingTransition] = useState(null);
  const [toast, setToast] = useState(null);
  const report = useCallback(async (error) => { if (error.status === 401) return signOut(); setToast({ title: "Unable to complete request", message: error.message, variant: "error" }); }, [signOut]);
  const load = useCallback(async () => { setLoading(true); try { setHotels((await listAllCompanyHotels()).items); } catch (error) { await report(error); } finally { setLoading(false); } }, [report]);
  useEffect(() => { load(); }, [load]);
  const visible = useMemo(() => { const needle = query.trim().toLowerCase(); return hotels.filter((hotel) => (status === "ALL" || hotel.status === status) && (!needle || [hotel.name, hotel.code, hotel.city, hotel.country, hotel.official_email].some((value) => String(value || "").toLowerCase().includes(needle)))); }, [hotels, query, status]);
  const openCreate = () => { setDraft(emptyHotel()); setErrors({}); setEditor({ mode: "create" }); };
  const openEdit = (hotel) => { setDraft(Object.fromEntries([...requiredFields, ...optionalFields].map((key) => [key, hotel[key] ?? ""]))); setErrors({}); setEditor({ mode: "edit", hotel }); };
  const updateDraft = (field, value) => { setDraft((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); };
  const save = async () => {
    const nextErrors = Object.fromEntries(requiredFields.filter((field) => !String(draft[field] || "").trim()).map((field) => [field, "Required"]));
    if (Object.keys(nextErrors).length) return setErrors(nextErrors);
    setBusy(true);
    try {
      const payload = editor.mode === "create"
        ? Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== ""))
        : Object.fromEntries(Object.entries(draft).map(([field, value]) => [field, optionalFields.includes(field) && value === "" ? null : value]));
      if (editor.mode === "create") await createCompanyHotel(payload); else await updateCompanyHotel(editor.hotel.id, payload);
      setEditor(null); await load(); setToast({ title: editor.mode === "create" ? "Hotel created" : "Hotel updated", message: `${draft.name} was saved successfully.` });
    } catch (error) { await report(error); } finally { setBusy(false); }
  };
  const transition = async () => { const active = pendingTransition.status !== "ACTIVE"; setBusy(true); try { await setCompanyHotelActive(pendingTransition.id, active); setPendingTransition(null); await load(); setToast({ title: active ? "Hotel activated" : "Hotel deactivated", message: `${pendingTransition.name} is now ${active ? "active" : "inactive"}.` }); } catch (error) { await report(error); } finally { setBusy(false); } };

  return <CompanyPage actions={<Button icon={Plus} onClick={openCreate}>Create Hotel</Button>} description="Create properties, maintain metadata, and control hotel lifecycle." title="Hotels">
    <div className="company-toolbar"><SearchInput onChange={(event) => setQuery(event.target.value)} placeholder="Search hotels by name, code, or location..." value={query} /><Select aria-label="Filter hotels by status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></div>
    {loading ? <LoadingState label="Loading hotels" /> : visible.length ? <Card><CardContent><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Hotel</th><th>Location</th><th>Contact</th><th>Plan</th><th>Status</th><th>Rooms</th><th>Actions</th></tr></thead><tbody>{visible.map((hotel) => <tr key={hotel.id}><td><strong>{hotel.name}</strong><CopyableIdentifier label="hotel ID" value={hotel.id} /><small className="company-table-subtext">{hotel.code}</small></td><td>{[hotel.city, hotel.state_province, hotel.country].filter(Boolean).join(", ")}</td><td><span>{hotel.official_email}</span><small className="company-table-subtext">{hotel.phone}</small></td><td><Badge variant={hotel.plan === "PREMIUM" ? "info" : hotel.plan === "FREE" ? "success" : "warning"}>{hotel.plan.toLowerCase()}</Badge></td><td><Badge variant={hotel.status === "ACTIVE" ? "success" : "neutral"}>{hotel.status.toLowerCase()}</Badge></td><td>{hotel.room_count}</td><td><div className="company-row-actions"><button aria-label={`View ${hotel.name}`} className="icon-button" onClick={() => navigate(`/company/hotels/${hotel.id}`)} title="View details" type="button"><Building2 size={16} /></button><button aria-label={`Edit ${hotel.name}`} className="icon-button" onClick={() => openEdit(hotel)} title="Edit hotel" type="button"><Pencil size={16} /></button><button aria-label={`${hotel.status === "ACTIVE" ? "Deactivate" : "Activate"} ${hotel.name}`} className="icon-button" onClick={() => setPendingTransition(hotel)} title={hotel.status === "ACTIVE" ? "Deactivate hotel" : "Activate hotel"} type="button"><Power size={16} /></button></div></td></tr>)}</tbody></table></div></CardContent></Card> : <EmptyState description="Try another search or create the first hotel." icon={Building2} title="No hotels found" />}
    <Modal actions={<><Button disabled={busy} onClick={() => setEditor(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={save}>{editor?.mode === "create" ? "Create Hotel" : "Save Changes"}</Button></>} className="company-hotel-editor-modal" description="Only company-approved hotel metadata is sent to the existing API." isOpen={Boolean(editor)} onClose={() => !busy && setEditor(null)} title={editor?.mode === "create" ? "Create Hotel" : "Edit Hotel"}><HotelForm draft={draft} errors={errors} onChange={updateDraft} /></Modal>
    <Modal actions={<><Button disabled={busy} onClick={() => setPendingTransition(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={transition} variant={pendingTransition?.status === "ACTIVE" ? "danger" : "primary"}>{pendingTransition?.status === "ACTIVE" ? "Deactivate" : "Activate"}</Button></>} description={pendingTransition ? `${pendingTransition.status === "ACTIVE" ? "Deactivate" : "Activate"} ${pendingTransition.name}? The backend remains authoritative for lifecycle safety.` : ""} isOpen={Boolean(pendingTransition)} onClose={() => !busy && setPendingTransition(null)} title="Confirm hotel status change"><div className="company-warning"><ShieldAlert aria-hidden="true" size={20} /><p>This action affects operational access for this hotel and is audit logged.</p></div></Modal>
    {toast ? <div className="toast-region"><Toast {...toast} onDismiss={() => setToast(null)} /></div> : null}
  </CompanyPage>;
}
