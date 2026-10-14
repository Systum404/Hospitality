import { useCallback, useEffect, useState } from "react";
import {
  Pencil, Plus, Trash2,
} from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Badge } from "../../../components/ui/Badge.jsx";
import { PaginatedTableBody } from "../../../components/ui/TablePagination.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/Card.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { adminNavigationGroups as navigationGroups, adminProfile as profile } from "../adminConfig.js";
import {
  createTaxSlab, deleteTaxSlab, getTaxSlabs, updateTaxSlab, updateTaxSlabStatus,
} from "../services/taxSlabsService.js";

const emptyDraft = () => ({ name: "", rate: "", appliesTo: "", status: "active" });
const rateExceedsMaximum = (value) => {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) > 100 || (Number(whole) === 100 && /[1-9]/.test(fraction));
};

function TaxSlabForm({ draft, errors, onChange }) {
  return (
    <div className="tax-slab-form">
      <Input label="Tax Slab Name *" name="tax-slab-name" onChange={(event) => onChange({ name: event.target.value })} placeholder="e.g. GST 5%" value={draft.name} />
      {errors.name ? <span className="tax-form-error">{errors.name}</span> : null}
      <Input label="Rate (%) *" max="100" min="0.01" name="tax-slab-rate" onChange={(event) => onChange({ rate: event.target.value })} placeholder="e.g. 5" step="0.01" type="number" value={draft.rate} />
      {errors.rate ? <span className="tax-form-error">{errors.rate}</span> : null}
      <Input label="Applies To *" name="tax-slab-applies-to" onChange={(event) => onChange({ appliesTo: event.target.value })} placeholder="e.g. Food items" value={draft.appliesTo} />
      {errors.appliesTo ? <span className="tax-form-error">{errors.appliesTo}</span> : null}
      <Select label="Status" name="tax-slab-status" onChange={(event) => onChange({ status: event.target.value })} value={draft.status}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
      {errors.duplicate ? <span className="tax-form-error tax-form-error--panel">{errors.duplicate}</span> : null}
    </div>
  );
}

export function AdminTaxSlabsPage() {
  const { signOut, user } = useAuth();
  const [taxSlabs, setTaxSlabs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("add");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState({});
  const [deleteSlab, setDeleteSlab] = useState(null);
  const [toast, setToast] = useState(null);

  const handleRequestError = useCallback(async (error) => {
    if (error?.status === 401) {
      await signOut().catch(() => {});
      return;
    }
    setToast({ title: "Unable to complete request", message: error?.message || "Please try again.", variant: "error" });
  }, [signOut]);

  const loadTaxSlabs = useCallback(async ({ signal } = {}) => {
    if (!user?.hotelId) {
      setTaxSlabs([]);
      setIsLoading(false);
      setToast({ title: "Unable to load tax slabs", message: "Your account does not have an available hotel context.", variant: "error" });
      return;
    }
    setIsLoading(true);
    try {
      const serverTaxSlabs = await getTaxSlabs(user.hotelId, { signal });
      setTaxSlabs(serverTaxSlabs.map((slab) => ({
        ...slab,
        appliesTo: slab.applicable_on,
        status: slab.is_active ? "active" : "inactive",
      })));
    } catch (error) {
      if (error?.name !== "AbortError") {
        setTaxSlabs([]);
        await handleRequestError(error);
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [handleRequestError, user?.hotelId]);

  useEffect(() => {
    const controller = new AbortController();
    loadTaxSlabs({ signal: controller.signal });
    return () => controller.abort();
  }, [loadTaxSlabs]);

  const openAdd = () => { setEditorMode("add"); setEditingId(null); setDraft(emptyDraft()); setErrors({}); setEditorOpen(true); };
  const openEdit = (slab) => { setEditorMode("edit"); setEditingId(slab.id); setDraft({ name: slab.name, rate: String(slab.rate), appliesTo: slab.appliesTo, status: slab.status }); setErrors({}); setEditorOpen(true); };
  const closeEditor = () => { setEditorOpen(false); setErrors({}); };
  const updateDraft = (change) => { setDraft((current) => ({ ...current, ...change })); setErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(change).map((key) => [key, ""])), duplicate: "" })); };

  const saveTaxSlab = async () => {
    if (!user?.hotelId || isSubmitting) return;
    const nextErrors = {};
    const name = draft.name.trim();
    const appliesTo = draft.appliesTo.trim();
    if (!name) nextErrors.name = "Tax slab name is required.";
    if (draft.rate === "") nextErrors.rate = "Rate is required.";
    else if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(draft.rate) || /^0+(?:\.0+)?$/.test(draft.rate)) nextErrors.rate = "Rate must be a positive percentage with up to 2 decimal places.";
    else if (rateExceedsMaximum(draft.rate)) nextErrors.rate = "Rate cannot exceed 100%.";
    if (!appliesTo) nextErrors.appliesTo = "Applies To is required.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    const input = {
      applicable_on: appliesTo,
      is_active: draft.status === "active",
      name,
      rate: draft.rate,
    };
    setIsSubmitting(true);
    try {
      if (editorMode === "edit") {
        const original = taxSlabs.find((slab) => slab.id === editingId);
        const detailsChanged = !original || original.name !== name || original.rate !== draft.rate || original.appliesTo !== appliesTo;
        if (detailsChanged) await updateTaxSlab(user.hotelId, editingId, { applicable_on: appliesTo, name, rate: draft.rate });
        if (!original || original.is_active !== input.is_active) await updateTaxSlabStatus(user.hotelId, editingId, input.is_active);
      } else await createTaxSlab(user.hotelId, input);
      closeEditor();
      await loadTaxSlabs();
      setToast({ title: editorMode === "edit" ? "Tax slab updated" : "Tax slab added", message: `${name} now applies to ${appliesTo}.` });
    } catch (error) {
      await handleRequestError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!user?.hotelId || !deleteSlab || isSubmitting) return;
    const removed = deleteSlab;
    setIsSubmitting(true);
    try {
      await deleteTaxSlab(user.hotelId, removed.id);
      setDeleteSlab(null);
      await loadTaxSlabs();
      setToast({ title: "Tax slab deleted", message: `${removed.name} was removed.` });
    } catch (error) {
      await handleRequestError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell navigationGroups={navigationGroups} profile={profile} title="Tax Slabs">
      <div className="tax-slabs-page">
        <header className="tax-slabs-page__header"><div><p className="eyebrow">Financial configuration</p><h2>Tax Slabs</h2><Breadcrumb /><p>Configure GST and service charge rates</p></div><Button icon={Plus} onClick={openAdd}>Add Tax Slab</Button></header>
        <Card className="tax-slabs-card">
          <CardHeader><div className="tax-slabs-card__heading"><div><CardTitle>Configured tax slabs</CardTitle><p>{taxSlabs.length} rates available for hotel billing</p></div><span>{taxSlabs.filter((slab) => slab.status === "active").length} active</span></div></CardHeader>
          <CardContent>{isLoading ? <LoadingState label="Loading tax slabs" /> : <div className="tax-slabs-table-wrap"><table className="tax-slabs-table"><thead><tr><th>Name</th><th>Rate</th><th>Applies To</th><th>Status</th><th>Actions</th></tr></thead>{taxSlabs.length ? <PaginatedTableBody colSpan={5} items={taxSlabs}>{(slab) => <tr className={slab.status === "inactive" ? "tax-slab-row--inactive" : ""} key={slab.id}><td><strong>{slab.name}</strong></td><td><span className="tax-rate-badge">{slab.rate}%</span></td><td>{slab.appliesTo}</td><td><Badge variant={slab.status === "active" ? "success" : "neutral"}>{slab.status}</Badge></td><td><div className="tax-slab-actions"><button aria-label={`Edit ${slab.name}`} className="icon-button" disabled={isSubmitting} onClick={() => openEdit(slab)} title="Edit" type="button"><Pencil size={16} /></button><button aria-label={`Delete ${slab.name}`} className="icon-button tax-slab-delete" disabled={isSubmitting} onClick={() => setDeleteSlab(slab)} title="Delete" type="button"><Trash2 size={16} /></button></div></td></tr>}</PaginatedTableBody> : <tbody><tr><td colSpan={5}>No tax slabs configured.</td></tr></tbody>}</table></div>}</CardContent>
        </Card>
      </div>
      <Modal actions={<><Button disabled={isSubmitting} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={saveTaxSlab}>{editorMode === "add" ? "Add Tax Slab" : "Save Changes"}</Button></>} description={editorMode === "add" ? "Define a billing rate and where it applies." : "Update this tax slab’s billing configuration."} isOpen={editorOpen} onClose={closeEditor} title={editorMode === "add" ? "Add Tax Slab" : "Edit Tax Slab"}><TaxSlabForm draft={draft} errors={errors} onChange={updateDraft} /></Modal>
      <Modal actions={<><Button disabled={isSubmitting} onClick={() => setDeleteSlab(null)} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={confirmDelete} variant="danger">Delete Tax Slab</Button></>} description="Are you sure you want to delete this tax slab?" isOpen={Boolean(deleteSlab)} onClose={() => setDeleteSlab(null)} title="Delete Tax Slab?" />
      {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} /></div> : null}
    </AppShell>
  );
}
