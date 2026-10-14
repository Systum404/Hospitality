import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, CheckCircle2, CircleDashed, UserMinus, UsersRound } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent } from "../../../components/ui/Card.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getReceptionAttendance, saveReceptionAttendance } from "../services/receptionService.js";
import { receptionNavigationGroups, receptionProfile } from "../receptionConfig.js";

const statusVariants = { present: "success", absent: "danger", unmarked: "neutral" };
const statusLabels = { present: "Present", absent: "Absent", unmarked: "Unmarked" };

function AttendanceMetric({ icon: Icon, label, value }) {
  return <Card className="attendance-stat"><CardContent><SemanticIcon icon={Icon} semantic={label} size="lg" /><div><strong>{value}</strong><small>{label}</small></div></CardContent></Card>;
}

export function Attendance({ navigationGroups = receptionNavigationGroups, profile = receptionProfile, title = "Reception Dashboard" }) {
  const { signOut, user } = useAuth();
  const [date, setDate] = useState("");
  const [records, setRecords] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async (selectedDate = date) => {
    setLoadError("");
    try {
      const data = await getReceptionAttendance(user.hotelId, selectedDate);
      setRecords(data.users);
      if (!selectedDate) setDate(data.date);
    } catch (error) {
      if (error.status === 401) return signOut();
      setRecords([]);
      setLoadError(error.message || "Attendance records could not be loaded.");
    }
  }, [date, signOut, user.hotelId]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => (records || []).reduce((totals, record) => ({
    ...totals,
    [record.attendanceStatus]: totals[record.attendanceStatus] + 1,
  }), { present: 0, absent: 0, unmarked: 0 }), [records]);

  const canCorrect = user.role === "Manager" || user.role === "Admin";

  const save = async (record, status) => {
    setBusyUserId(record.id);
    try {
      await saveReceptionAttendance(user.hotelId, { userId: record.id, attendanceDate: date, status });
      await load(date);
      setToast({ title: record.attendanceStatus === "unmarked" ? "Attendance recorded" : "Attendance corrected", message: `${record.name} was marked ${status}.`, variant: "success" });
    } catch (error) {
      if (error.status === 401) return signOut();
      setToast({ title: "Unable to update attendance", message: error.message || "Please try again.", variant: "error" });
    } finally {
      setBusyUserId("");
      setConfirmation(null);
    }
  };

  const requestStatus = (record, status) => {
    if (status === "present" && record.attendanceStatus === "unmarked") return save(record, status);
    setConfirmation({ record, status });
  };

  return <AppShell navigationGroups={navigationGroups} profile={profile} title={title}>
    <main className="attendance-page">
      <header className="attendance-header"><div><p className="eyebrow">Reception staff</p><h2>Staff Attendance</h2><Breadcrumb /><p>Record daily attendance for hotel users.</p></div><div className="attendance-header__actions"><Input aria-label="Attendance date" onChange={(event) => { setDate(event.target.value); setRecords(null); }} type="date" value={date} /></div></header>
      {loadError ? <EmptyState description={loadError} icon={CalendarCheck2} title="Unable to load attendance" /> : records ? <>
        <section aria-label="Attendance summary" className="attendance-stats"><AttendanceMetric icon={UsersRound} label="Total Staff" value={records.length} /><AttendanceMetric icon={CheckCircle2} label="Present" value={summary.present} /><AttendanceMetric icon={UserMinus} label="Absent" value={summary.absent} /><AttendanceMetric icon={CircleDashed} label="Unmarked" value={summary.unmarked} /></section>
        <Card className="attendance-table-card"><CardContent><div className="attendance-table-wrap"><table className="attendance-table"><thead><tr><th>Staff Name</th><th>Role</th><th>Email</th><th>Attendance</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={5} items={records}>{(record) => <tr key={record.id}><td><div className="attendance-person"><span>{record.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{record.name}</strong><small>{record.isActive ? "Active user" : "Historical user"}</small></div></div></td><td>{record.roles.join(", ") || "—"}</td><td>{record.email}</td><td><Badge variant={statusVariants[record.attendanceStatus]}>{statusLabels[record.attendanceStatus]}</Badge></td><td><div className="attendance-actions">{record.attendanceStatus === "unmarked" ? <><Button disabled={Boolean(busyUserId)} icon={CheckCircle2} onClick={() => requestStatus(record, "present")} size="sm" variant="success">Present</Button><Button disabled={Boolean(busyUserId)} icon={UserMinus} onClick={() => requestStatus(record, "absent")} size="sm" variant="danger">Absent</Button></> : canCorrect && record.isActive ? <Button disabled={Boolean(busyUserId)} icon={record.attendanceStatus === "present" ? UserMinus : CheckCircle2} onClick={() => requestStatus(record, record.attendanceStatus === "present" ? "absent" : "present")} size="sm" variant={record.attendanceStatus === "present" ? "danger" : "success"}>{record.attendanceStatus === "present" ? "Mark Absent" : "Mark Present"}</Button> : <span>Recorded</span>}</div></td></tr>}</PaginatedTableBody></table></div>{records.length === 0 ? <EmptyState description="No active users are assigned to this hotel." icon={UsersRound} title="No staff available" /> : null}</CardContent></Card>
      </> : <LoadingState label="Loading staff attendance" />}
      <Modal actions={<><Button disabled={Boolean(busyUserId)} onClick={() => setConfirmation(null)} variant="ghost">Cancel</Button><Button disabled={Boolean(busyUserId)} onClick={() => save(confirmation.record, confirmation.status)} variant={confirmation?.status === "absent" ? "danger" : "success"}>{confirmation?.status === "absent" ? "Mark Absent" : "Mark Present"}</Button></>} description={confirmation ? confirmation.record.name : ""} isOpen={Boolean(confirmation)} onClose={() => !busyUserId && setConfirmation(null)} title={confirmation?.record.attendanceStatus === "unmarked" ? `Mark staff member ${confirmation?.status}?` : "Correct attendance status?"}><p className="modal-copy">{confirmation?.record.attendanceStatus === "unmarked" ? `This records a ${confirmation?.status} attendance status for the selected hotel date.` : `This changes the recorded attendance status to ${confirmation?.status} for the selected hotel date.`}</p></Modal>
      {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}
    </main>
  </AppShell>;
}
