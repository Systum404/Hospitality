import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { CopyableIdentifier } from "../../../components/ui/CopyableIdentifier.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { CompanyPage } from "../components/CompanyPage.jsx";
import { changeCompanyHotelPlan, getCompanyHotel, listAdminInvitations, listHotelAdmins } from "../services/companyControlPlaneService.js";

const labelize = (value) => value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function SuperAdminHotelDetails() {
  const { hotelId } = useParams();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [hotel, setHotel] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [planDraft, setPlanDraft] = useState("FREE");
  const [planBusy, setPlanBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hotelData, adminData, invitationData] = await Promise.all([getCompanyHotel(hotelId), listHotelAdmins(hotelId), listAdminInvitations(hotelId)]);
      setHotel(hotelData.hotel); setPlanDraft(hotelData.hotel.plan === "PREMIUM" ? "PREMIUM" : "FREE"); setAdmins(adminData.admins); setInvitations(invitationData.invitations);
    } catch (error) { if (error.status === 401) await signOut(); else setToast({ title: "Unable to load hotel", message: error.message, variant: "error" }); }
    finally { setLoading(false); }
  }, [hotelId, signOut]);
  useEffect(() => { load(); }, [load]);
  const savePlan = async () => { setPlanBusy(true); try { await changeCompanyHotelPlan(hotelId, planDraft); await load(); setToast({ title: "Hotel plan updated", message: `${hotel.name} now uses the ${planDraft} plan.` }); } catch (error) { setToast({ title: "Unable to update plan", message: error.message, variant: "error" }); } finally { setPlanBusy(false); } };
  const detailFields = hotel ? ["type", "address_line", "city", "state_province", "country", "postal_code", "phone", "official_email", "timezone", "currency_code", "logo_url", "website", "tax_registration_number", "description", "check_in_time", "check_out_time"] : [];

  return <CompanyPage actions={<Button icon={ArrowLeft} onClick={() => navigate("/company/hotels")} variant="secondary">Back to Hotels</Button>} description="Hotel metadata and administration summary." title={hotel?.name || "Hotel Details"}>
    {loading ? <LoadingState label="Loading hotel details" /> : hotel ? <div className="company-detail-grid">
      <Card><CardHeader><div className="company-section-heading"><div><CardTitle>Property details</CardTitle><p>{hotel.code}</p></div><Badge variant={hotel.status === "ACTIVE" ? "success" : "neutral"}>{hotel.status.toLowerCase()}</Badge></div></CardHeader><CardContent><dl className="company-detail-list"><div><dt>Hotel ID</dt><dd><CopyableIdentifier label="hotel ID" value={hotel.id} /></dd></div>{detailFields.map((field) => <div key={field}><dt>{labelize(field)}</dt><dd>{hotel[field] || "—"}</dd></div>)}<div><dt>Rooms</dt><dd>{hotel.room_count}</dd></div></dl></CardContent></Card>
      <div className="company-detail-sidebar"><Card><CardHeader><CardTitle>Access plan</CardTitle></CardHeader><CardContent><div className="company-plan-control"><Badge variant={hotel.plan === "PREMIUM" ? "info" : hotel.plan === "FREE" ? "success" : "warning"}>{hotel.plan.toLowerCase()}</Badge><Select aria-label="Hotel plan" onChange={(event) => setPlanDraft(event.target.value)} value={planDraft}><option value="FREE">Free</option><option value="PREMIUM">Premium</option></Select><Button disabled={planBusy || hotel.plan === planDraft} onClick={savePlan} size="sm">{planBusy ? "Saving…" : "Update Plan"}</Button></div><div className="company-plan-usage">{Object.entries(hotel.entitlement?.usage || {}).map(([role, usage]) => <div key={role}><span>{role.replaceAll("_", " ")}</span><strong>{usage.active} / {usage.limit ?? "Unlimited"}</strong>{usage.grandfathered ? <small>{usage.grandfathered} grandfathered</small> : null}</div>)}</div></CardContent></Card><Card><CardHeader><CardTitle>Hotel administration</CardTitle></CardHeader><CardContent><div className="company-summary-line"><ShieldCheck aria-hidden="true" size={20} /><div><strong>{admins.length}</strong><span>Hotel Admin assignments</span></div></div><div className="company-summary-line"><Building2 aria-hidden="true" size={20} /><div><strong>{invitations.filter((item) => item.status === "PENDING").length}</strong><span>Pending invitations</span></div></div><Button onClick={() => navigate(`/company/hotel-admins?hotel=${hotel.id}`)} variant="secondary">Manage Hotel Admins</Button></CardContent></Card></div>
    </div> : null}
    {toast ? <div className="toast-region"><Toast {...toast} onDismiss={() => setToast(null)} /></div> : null}
  </CompanyPage>;
}
