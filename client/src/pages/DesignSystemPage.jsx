import { useState } from "react";
import { BedDouble, CalendarDays, CircleDollarSign, Coffee, Plus, Sparkles } from "lucide-react";
import { AppShell } from "../components/layout/AppShell.jsx";
import { Badge } from "../components/ui/Badge.jsx";
import { Button } from "../components/ui/Button.jsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/Card.jsx";
import { DataTable } from "../components/ui/DataTable.jsx";
import { EmptyState } from "../components/ui/EmptyState.jsx";
import { Input } from "../components/ui/Input.jsx";
import { LoadingState } from "../components/ui/LoadingState.jsx";
import { MetricCard } from "../components/ui/MetricCard.jsx";
import { Modal } from "../components/ui/Modal.jsx";
import { SearchInput } from "../components/ui/SearchInput.jsx";
import { Select } from "../components/ui/Select.jsx";
import { Textarea } from "../components/ui/Textarea.jsx";
import { Toast } from "../components/ui/Toast.jsx";
import lobbyHero from "../assets/aazira-lobby-hero.png";

const palette = [
  { name: "Ivory", token: "ivory", value: "#FAFAF8" },
  { name: "Sky", token: "sky", value: "#E8F2FA" },
  { name: "Light Blue", token: "light-blue", value: "#D6E6F7" },
  { name: "Blue", token: "blue", value: "#8DBAF2" },
  { name: "Primary Blue", token: "primary-blue", value: "#2563EB" },
  { name: "Navy Blue", token: "navy-blue", value: "#1E3A8A" },
  { name: "Deep Blue", token: "deep-blue", value: "#0F172A" },
  { name: "White", token: "white", value: "#FFFFFF" },
];
const rows = [
  { id: "1", guest: "Ananya Sharma", room: "Suite 304", status: "Occupied", amount: "₹18,450" },
  { id: "2", guest: "Noah Wilson", room: "Garden 112", status: "Reserved", amount: "₹12,800" },
  { id: "3", guest: "Riya Kapoor", room: "Deluxe 218", status: "Available", amount: "—" },
];
const columns = [
  { key: "guest", label: "Guest" }, { key: "room", label: "Room" },
  { key: "status", label: "Status", render: (row) => <Badge variant={row.status === "Occupied" ? "info" : row.status === "Reserved" ? "warning" : "success"}>{row.status}</Badge> },
  { key: "amount", label: "Amount" }, { key: "actions", label: "", render: () => <Button size="sm" variant="ghost">View</Button> },
];

export function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  return (
    <AppShell title="Design System">
      <div className="design-system-page">
      <div className="page-intro design-hero">
        <div className="design-hero__copy"><p className="eyebrow">AAZIRA Foundation</p><h2>Hotel operations,<br />with a sense of place.</h2><span className="editorial-rule" /><p>A reusable visual language for calm,<br />capable hospitality teams.</p></div>
        <div className="design-hero__visual"><img alt="Sunlit premium hotel lobby" src={lobbyHero} /></div>
        <div className="design-hero__action"><p className="eyebrow">Show toast</p><span className="editorial-rule" /><Button icon={Sparkles} onClick={() => setToastVisible(true)}>Show toast</Button></div>
      </div>

      <section className="showcase-section palette-section"><div className="section-heading"><p className="eyebrow">Foundation</p><h3>Color palette</h3></div><div className="palette-grid">{palette.map(({ name, token, value }) => <div className="palette-swatch" key={token}><span className={`palette-swatch__color palette-swatch__color--${token}`} /><strong>{name}</strong><small>{value}</small></div>)}</div></section>

      <section className="showcase-section showcase-section--split"><div><div className="section-heading"><p className="eyebrow">Typography</p><h3>Clear hierarchy, warm character</h3></div><div className="type-sample"><h1>Guest-first operations.</h1><h2>Every shift, beautifully organised.</h2><h3>Thoughtful details build trust.</h3><p>AAZIRA pairs decisive information with a composed, welcoming experience for every hotel team.</p><small>Small interface text · 13px medium</small></div></div><Card><CardHeader><CardTitle>Button system</CardTitle><CardDescription>Purposeful hierarchy with quiet interaction feedback.</CardDescription></CardHeader><CardContent><div className="button-stack"><Button icon={Plus}>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="success">Success</Button></div></CardContent></Card></section>

      <section className="showcase-section"><div className="section-heading"><p className="eyebrow">Components</p><h3>Metrics and status</h3></div><div className="metrics-grid"><MetricCard description="vs yesterday" icon={CircleDollarSign} label="Today’s revenue" trend="12.5%" value="₹45,820" /><MetricCard description="across the property" icon={BedDouble} label="Rooms occupied" trend="4.1%" value="68%" /><MetricCard description="arriving today" icon={CalendarDays} label="Upcoming stays" trend="8 bookings" value="24" /></div><div className="badge-row"><Badge variant="success">Paid</Badge><Badge variant="warning">Pending</Badge><Badge variant="danger">Attention</Badge><Badge variant="info">Occupied</Badge><Badge>Preparing</Badge></div></section>

      <section className="showcase-section showcase-section--split"><Card><CardHeader><CardTitle>Form controls</CardTitle><CardDescription>Consistent fields designed for high-focus operational work.</CardDescription></CardHeader><CardContent><div className="form-grid"><Input label="Guest name" name="guest-name" placeholder="e.g. Aarav Mehta" /><Select label="Stay type" name="stay-type" defaultValue=""><option disabled value="">Choose a stay type</option><option>Leisure</option><option>Business</option></Select><Textarea className="form-grid__full" label="Guest note" name="guest-note" placeholder="Add a helpful note…" rows="3" /></div></CardContent><CardFooter><Button variant="outline">Save draft</Button><Button>Continue</Button></CardFooter></Card><Card><CardHeader><CardTitle>Search and feedback</CardTitle><CardDescription>Small states keep the interface communicative.</CardDescription></CardHeader><CardContent><SearchInput /><div className="state-stack"><LoadingState label="Refreshing availability" /><EmptyState description="New requests will appear here when they arrive." icon={Coffee} title="No concierge requests" /></div></CardContent></Card></section>

      <section className="showcase-section"><div className="section-heading"><p className="eyebrow">Data display</p><h3>Table foundation</h3></div><Card className="table-card"><CardContent><DataTable columns={columns} rows={rows} /></CardContent></Card></section>

      <section className="showcase-section"><Card className="interaction-card"><CardHeader><CardTitle>Modal and toast foundation</CardTitle><CardDescription>Reusable feedback patterns for future workflows, without business logic.</CardDescription></CardHeader><CardFooter><Button onClick={() => setModalOpen(true)} variant="outline">Open modal</Button><Button onClick={() => setToastVisible(true)}>Trigger toast</Button></CardFooter></Card></section>
      </div>

      <Modal actions={<><Button onClick={() => setModalOpen(false)} variant="ghost">Cancel</Button><Button onClick={() => setModalOpen(false)}>Confirm</Button></>} description="This is a foundation component for future operational flows." isOpen={modalOpen} onClose={() => setModalOpen(false)} title="A composed modal" ><p className="modal-copy">Its content, actions, and close behavior are ready to be composed into later AAZIRA workflows.</p></Modal>
      {toastVisible ? <div className="toast-region"><Toast message="The notification foundation is ready to use." onDismiss={() => setToastVisible(false)} /></div> : null}
    </AppShell>
  );
}
