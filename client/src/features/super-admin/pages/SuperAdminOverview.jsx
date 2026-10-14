import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CircleCheckBig, CircleOff, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../../components/ui/Badge.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { MetricCard } from "../../../components/ui/MetricCard.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { CompanyPage } from "../components/CompanyPage.jsx";
import { listAllCompanyHotels, listHotelAdmins } from "../services/companyControlPlaneService.js";

export function SuperAdminOverview() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [hotels, setHotels] = useState([]);
  const [adminCount, setAdminCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listAllCompanyHotels();
      setHotels(result.items);
      const adminLists = await Promise.all(result.items.map((hotel) => listHotelAdmins(hotel.id)));
      setAdminCount(adminLists.reduce((sum, resultItem) => sum + resultItem.admins.length, 0));
    } catch (error) {
      if (error.status === 401) return signOut();
      setToast({ title: "Unable to load company overview", message: error.message, variant: "error" });
    } finally { setLoading(false); }
  }, [signOut]);
  useEffect(() => { load(); }, [load]);
  const counts = useMemo(() => ({ active: hotels.filter((hotel) => hotel.status === "ACTIVE").length, inactive: hotels.filter((hotel) => hotel.status === "INACTIVE").length }), [hotels]);

  return <CompanyPage description="Company-wide hotel and administrator oversight." title="Company Overview">
    {loading ? <LoadingState label="Loading company overview" /> : <>
      <div className="company-metrics"><MetricCard description="Hotels registered in AAZIRA" icon={Building2} label="Total Hotels" value={hotels.length} /><MetricCard description="Available for hotel operations" icon={CircleCheckBig} iconTone="green" label="Active Hotels" value={counts.active} /><MetricCard description="Operational access suspended" icon={CircleOff} iconTone="amber" label="Inactive Hotels" value={counts.inactive} /><MetricCard description="Assignments across all hotels" icon={ShieldCheck} iconTone="blue" label="Hotel Admins" value={adminCount ?? "—"} /></div>
      <Card><CardHeader><div className="company-section-heading"><div><CardTitle>Hotels</CardTitle><p>Recently created company properties</p></div><Button onClick={() => navigate("/company/hotels")} variant="secondary">Manage Hotels</Button></div></CardHeader><CardContent><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Hotel</th><th>Location</th><th>Status</th><th>Rooms</th></tr></thead><tbody>{hotels.slice(0, 6).map((hotel) => <tr key={hotel.id}><td><strong>{hotel.name}</strong><small className="company-table-subtext">{hotel.code}</small></td><td>{[hotel.city, hotel.country].filter(Boolean).join(", ")}</td><td><Badge variant={hotel.status === "ACTIVE" ? "success" : "neutral"}>{hotel.status.toLowerCase()}</Badge></td><td>{hotel.room_count}</td></tr>)}</tbody></table></div></CardContent></Card>
    </>}
    {toast ? <div className="toast-region"><Toast {...toast} onDismiss={() => setToast(null)} /></div> : null}
  </CompanyPage>;
}
