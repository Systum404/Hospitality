import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, BedDouble, Pencil, Plus, Trash2 } from "lucide-react";
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
import { adminNavigationGroups, adminProfile } from "../adminConfig.js";
import { createRoom, deleteRoom, getRooms, updateRoom, updateRoomStatus } from "../services/roomService.js";

const emptyDraft = () => ({ room_number: "", room_type: "", floor_number: "0", capacity: "2", status: "active", base_price: "0.00", description: "" });
const decimal = /^-?(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const badgeVariant = (status) => status === "active" ? "success" : status === "inactive" ? "neutral" : "info";

function RoomForm({ draft, errors, onChange }) {
  const statuses = [...new Set(["active", "inactive", draft.status].filter(Boolean))];
  return <div className="inventory-form"><div className="inventory-form__row"><Input label="Room Number *" onChange={(event) => onChange({ room_number: event.target.value })} placeholder="e.g. 101" value={draft.room_number} /><Input label="Room Type" onChange={(event) => onChange({ room_type: event.target.value })} placeholder="e.g. Deluxe" value={draft.room_type} /></div>{errors.room_number ? <span className="inventory-form-error">{errors.room_number}</span> : null}<div className="inventory-form__row"><Input label="Floor" onChange={(event) => onChange({ floor_number: event.target.value })} type="number" value={draft.floor_number} /><Input label="Capacity" onChange={(event) => onChange({ capacity: event.target.value })} type="number" value={draft.capacity} /></div>{errors.floor_number || errors.capacity ? <span className="inventory-form-error">{errors.floor_number || errors.capacity}</span> : null}<div className="inventory-form__row"><Input label="Base Price" onChange={(event) => onChange({ base_price: event.target.value })} step="0.01" type="number" value={draft.base_price} /><Select label="Status *" onChange={(event) => onChange({ status: event.target.value })} value={draft.status}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</Select></div>{errors.base_price || errors.status ? <span className="inventory-form-error">{errors.base_price || errors.status}</span> : null}<label className="field"><span className="field__label">Description</span><textarea className="field__control field__control--textarea" onChange={(event) => onChange({ description: event.target.value })} rows="3" value={draft.description} /></label></div>;
}

export function RoomManagementPage({ navigationGroups = adminNavigationGroups, profile = adminProfile }) {
  const { signOut, user } = useAuth();
  const [rooms, setRooms] = useState([]); const [isLoading, setIsLoading] = useState(true); const [query, setQuery] = useState(""); const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState(null); const [draft, setDraft] = useState(emptyDraft); const [errors, setErrors] = useState({}); const [deleteTarget, setDeleteTarget] = useState(null); const [busy, setBusy] = useState(false); const [toast, setToast] = useState(null);
  const report = useCallback(async (error, title = "Unable to complete request") => { if (error?.status === 401) { await signOut().catch(() => {}); return; } setToast({ title, message: error?.message || "Please try again.", variant: "error" }); }, [signOut]);
  const load = useCallback(async ({ signal } = {}) => { if (!user?.hotelId) { setRooms([]); setIsLoading(false); return; } setIsLoading(true); try { setRooms(await getRooms(user.hotelId, { signal })); } catch (error) { if (error?.name !== "AbortError") { setRooms([]); await report(error, "Unable to load rooms"); } } finally { if (!signal?.aborted) setIsLoading(false); } }, [report, user?.hotelId]);
  useEffect(() => { const controller = new AbortController(); load({ signal: controller.signal }); return () => controller.abort(); }, [load]);
  const statuses = useMemo(() => ["all", ...new Set(rooms.map((room) => room.status))], [rooms]);
  const visible = useMemo(() => { const needle = query.trim().toLowerCase(); return rooms.filter((room) => (filter === "all" || room.status === filter) && (!needle || [room.room_number, room.room_type || "", room.status].some((value) => value.toLowerCase().includes(needle)))); }, [filter, query, rooms]);
  const change = (next) => { setDraft((value) => ({ ...value, ...next })); setErrors({}); };
  const closeEditor = () => { if (!busy) { setEditor(null); setErrors({}); } };
  const openAdd = () => { setDraft(emptyDraft()); setErrors({}); setEditor({ mode: "add" }); };
  const openEdit = (room) => { setDraft({ room_number: room.room_number, room_type: room.room_type || "", floor_number: String(room.floor_number), capacity: String(room.capacity), status: room.status, base_price: room.base_price, description: room.description || "" }); setErrors({}); setEditor({ mode: "edit", id: room.id }); };
  const payload = () => ({ room_number: draft.room_number.trim(), room_type: draft.room_type.trim() || null, floor_number: Number(draft.floor_number), capacity: Number(draft.capacity), status: draft.status, base_price: draft.base_price, description: draft.description.trim() || null });
  const validate = () => { const next = {}; if (!draft.room_number.trim()) next.room_number = "Room number is required."; if (!draft.status.trim()) next.status = "Status is required."; for (const field of ["floor_number", "capacity"]) if (!Number.isInteger(Number(draft[field]))) next[field] = `${field === "floor_number" ? "Floor" : "Capacity"} must be an integer.`; if (!decimal.test(draft.base_price)) next.base_price = "Base price must be a decimal with at most two decimal places."; setErrors(next); return !Object.keys(next).length; };
  const save = async () => { if (!user?.hotelId || !editor || busy || !validate()) return; setBusy(true); try { const input = payload(); if (editor.mode === "add") await createRoom(user.hotelId, input); else await updateRoom(user.hotelId, editor.id, input); setEditor(null); await load(); setToast({ title: editor.mode === "add" ? "Room added" : "Room updated", message: `${input.room_number} was saved successfully.` }); } catch (error) { await report(error); } finally { setBusy(false); } };
  const changeStatus = async (room) => { if (!user?.hotelId || busy) return; const next = room.status === "active" ? "inactive" : "active"; setBusy(true); try { await updateRoomStatus(user.hotelId, room.id, next); await load(); setToast({ title: `Room ${next}`, message: `${room.room_number} status was updated.` }); } catch (error) { await report(error); } finally { setBusy(false); } };
  const confirmDelete = async () => { if (!user?.hotelId || !deleteTarget || busy) return; setBusy(true); try { await deleteRoom(user.hotelId, deleteTarget.id); setDeleteTarget(null); await load(); setToast({ title: "Room deleted", message: `${deleteTarget.room_number} was removed.` }); } catch (error) { await report(error); } finally { setBusy(false); } };
  return (
    <AppShell navigationGroups={navigationGroups} profile={profile} title="Room Management">
      <div className="inventory-page">
        <header className="inventory-page__header"><div><p className="eyebrow">Hotel setup</p><h2>Room Management</h2><Breadcrumb /><p>{rooms.length} {rooms.length === 1 ? "room" : "rooms"}</p></div><Button icon={Plus} onClick={openAdd}>Add Room</Button></header>
        <div className="inventory-controls"><div className="search-with-filter"><SearchInput className="inventory-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search rooms..." value={query} /><FilterButton><div aria-label="Filter rooms by status" className="inventory-filter-tabs" role="group">{statuses.map((status) => <button aria-pressed={filter === status} className={filter === status ? "is-active" : ""} key={status} onClick={() => setFilter(status)} type="button">{status === "all" ? "All" : status}</button>)}</div></FilterButton></div></div>
        {isLoading ? <LoadingState label="Loading rooms" /> : visible.length ? <Card className="inventory-table-card"><CardHeader><div className="inventory-table-heading"><div><CardTitle>Rooms</CardTitle><p>{visible.length} {visible.length === 1 ? "room" : "rooms"} shown</p></div></div></CardHeader><CardContent><div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Capacity</th><th>Base Price</th><th>Status</th><th>Actions</th></tr></thead><PaginatedTableBody colSpan={7} items={visible}>{(room) => <tr key={room.id}><td><strong>{room.room_number}</strong></td><td>{room.room_type || "—"}</td><td>{room.floor_number}</td><td>{room.capacity}</td><td>₹{room.base_price}</td><td><Badge variant={badgeVariant(room.status)}>{room.status}</Badge></td><td><div className="inventory-actions"><button aria-label={`Change status for ${room.room_number}`} className={`icon-button status-action status-action--${room.status === "active" ? "active" : "inactive"}`} disabled={busy} onClick={() => changeStatus(room)} title="Change status" type="button"><Ban size={16} /></button><button aria-label={`Edit ${room.room_number}`} className="icon-button" disabled={busy} onClick={() => openEdit(room)} title="Edit" type="button"><Pencil size={16} /></button><button aria-label={`Delete ${room.room_number}`} className="icon-button inventory-delete" disabled={busy} onClick={() => setDeleteTarget(room)} title="Delete" type="button"><Trash2 size={16} /></button></div></td></tr>}</PaginatedTableBody></table></div></CardContent></Card> : <EmptyState description={rooms.length ? "Try another search term or status filter." : "Add the first room to make it available for room bookings."} icon={BedDouble} title="No rooms found" />}
      </div>
      <Modal actions={<><Button disabled={busy} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={busy} onClick={save}>{editor?.mode === "add" ? "Add Room" : "Save Changes"}</Button></>} description={editor?.mode === "add" ? "Add a room to this hotel." : "Update this room's details."} isOpen={Boolean(editor)} onClose={closeEditor} title={editor?.mode === "add" ? "Add Room" : "Edit Room"}>{editor ? <RoomForm draft={draft} errors={errors} onChange={change} /> : null}</Modal>
      <Modal actions={<><Button disabled={busy} onClick={() => setDeleteTarget(null)} variant="ghost">Cancel</Button><Button disabled={busy} onClick={confirmDelete} variant="danger">Delete</Button></>} description={deleteTarget ? `Delete room ${deleteTarget.room_number}? Rooms with bookings or QR codes cannot be deleted.` : ""} isOpen={Boolean(deleteTarget)} onClose={() => !busy && setDeleteTarget(null)} title="Delete Room?" />
      {toast ? <div className="toast-region"><Toast {...toast} onDismiss={() => setToast(null)} /></div> : null}
    </AppShell>
  );
}
