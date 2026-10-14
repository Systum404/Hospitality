import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Armchair, CheckCircle2, Clock3, Coffee, Home, MapPin, Pencil, Plus, Sun, TableProperties,
  Trash2, Umbrella, UsersRound, Wind,
} from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { adminNavigationGroups, adminProfile } from "../adminConfig.js";
import {
  createDiningArea, createDiningTable, deleteDiningArea, deleteDiningTable, getDiningAreas,
  updateDiningArea, updateDiningTable,
} from "../services/areasTablesService.js";

const areaIcons = { home: Home, umbrella: Umbrella, wind: Wind, coffee: Coffee, sun: Sun, pin: MapPin };
const iconOptions = Object.entries(areaIcons);
const colorOptions = ["orange", "green", "blue", "red", "purple", "cyan", "pink"];
const filters = ["all", "available", "occupied", "reserved"];

const createDraft = () => ({ name: "", description: "", icon: "home", color: "blue", tables: [] });
const defaultPresentation = { description: "", icon: "home", color: "blue" };

function toViewArea(area, presentation) {
  return {
    ...area,
    ...defaultPresentation,
    ...presentation,
    tables: (area.tables || []).map((table) => ({
      ...table,
      code: table.table_number,
    })),
  };
}

function AreaIcon({ name, size = 20 }) {
  const Icon = areaIcons[name] || Home;
  return <Icon aria-hidden="true" size={size} />;
}

function SummaryCard({ icon: Icon, label, tone, value }) {
  const iconTone = { total: "purple", available: "green", occupied: "red", reserved: "amber" }[tone];
  return <article className={`area-summary-card area-summary-card--${tone}`}><SemanticIcon className="area-summary-card__icon" icon={Icon} semantic={label} tone={iconTone} /><span><strong>{value}</strong><small>{label}</small></span></article>;
}

function WizardProgress({ step }) {
  return <ol className="area-wizard__progress">{["Area Details", "Add Tables", "Preview & Save"].map((label, index) => { const number = index + 1; return <li className={number < step ? "is-complete" : number === step ? "is-active" : ""} key={label}><span>{number < step ? "✓" : number}</span><small>Step {number}</small><strong>{label}</strong></li>; })}</ol>;
}

function AreaWizard({ draft, errors, isOpen, mode, onAddTable, onBack, onChange, onClose, onNext, onRemoveTable, onSave, setErrors, showTableForm, step, tableDraft, setShowTableForm, setTableDraft }) {
  const actions = step === 1
    ? <div className="area-wizard__navigation"><Button onClick={onNext}>Next →</Button></div>
    : step === 2
      ? <div className="area-wizard__navigation"><Button onClick={onBack} variant="ghost">← Previous</Button><Button onClick={onNext}>Next →</Button></div>
      : <div className="area-wizard__navigation"><Button onClick={onBack} variant="ghost">← Previous</Button><Button onClick={onSave}>Save Area</Button></div>;

  return (
    <div className="area-wizard">
      <Modal actions={actions} description={mode === "edit" ? "Update area information and table configuration." : "Create a dining area in three simple steps."} isOpen={isOpen} onClose={onClose} title={mode === "edit" ? "Edit Area" : "New Area"}>
        <WizardProgress step={step} />
        {step === 1 ? <div className="area-wizard__step area-wizard__step--details"><div className="area-wizard__step-heading"><h3>Area Details</h3><p>Define the area name, icon, and colour. This will appear as a tab on captain and reception screens.</p></div><Input label="Area Name *" name="area-name" onChange={(event) => { onChange({ name: event.target.value }); setErrors((current) => ({ ...current, name: "" })); }} placeholder="e.g. Rooftop, Garden, AC Hall, Poolside..." value={draft.name} />{errors.name ? <span className="area-form-error">{errors.name}</span> : null}<label className="field"><span className="field__label">Description <em>Optional</em></span><textarea className="field__control field__control--textarea" onChange={(event) => onChange({ description: event.target.value })} placeholder="e.g. Open-air rooftop seating, capacity 24 guests" rows="3" value={draft.description} /></label><fieldset className="area-choice-group"><legend>Icon</legend><div className="area-icon-options">{iconOptions.map(([name, Icon]) => <button aria-label={`Select ${name} icon`} className={draft.icon === name ? "is-selected" : ""} key={name} onClick={() => onChange({ icon: name })} type="button"><Icon aria-hidden="true" size={20} /></button>)}</div></fieldset><fieldset className="area-choice-group"><legend>Colour Tag</legend><div className="area-color-options">{colorOptions.map((color) => <button aria-label={`Select ${color} colour`} className={`area-color area-color--${color} ${draft.color === color ? "is-selected" : ""}`} key={color} onClick={() => onChange({ color })} type="button" />)}</div></fieldset></div> : null}
        {step === 2 ? <div className="area-wizard__step area-wizard__step--tables"><div className="area-wizard__step-heading"><h3>Add Tables</h3><p>Add every table. You can always add or remove tables later from admin settings.</p></div><div className="area-wizard__table-heading"><strong>Tables in this area</strong><span>{draft.tables.length} {draft.tables.length === 1 ? "table" : "tables"}</span></div>{draft.tables.length ? <div className="area-wizard__table-list">{draft.tables.map((table) => <article key={table.id}><span><Armchair aria-hidden="true" size={18} /></span><div><strong>{table.code}</strong><small>{table.capacity} pax</small></div><button aria-label={`Remove ${table.code}`} className="icon-button" onClick={() => onRemoveTable(table.id)} type="button"><Trash2 size={16} /></button></article>)}</div> : <div className="area-wizard__empty"><Armchair aria-hidden="true" size={28} /><strong>No tables added yet</strong><span>Click “Add Table” below to start</span></div>}{showTableForm ? <div className="area-wizard__add-form"><Input label="Table number/code *" name="table-code" onChange={(event) => { setTableDraft((current) => ({ ...current, code: event.target.value })); setErrors((current) => ({ ...current, table: "" })); }} placeholder="e.g. T-01" value={tableDraft.code} /><Input label="Seating capacity *" min="1" name="table-capacity" onChange={(event) => { setTableDraft((current) => ({ ...current, capacity: event.target.value })); setErrors((current) => ({ ...current, table: "" })); }} placeholder="e.g. 4" type="number" value={tableDraft.capacity} /><Button onClick={onAddTable} size="sm">Add</Button></div> : <Button icon={Plus} onClick={() => setShowTableForm(true)} variant="outline">Add Table</Button>}{errors.table ? <span className="area-form-error">{errors.table}</span> : null}</div> : null}
        {step === 3 ? <div className="area-wizard__step area-wizard__step--preview"><div className="area-wizard__step-heading"><h3>Preview & Save</h3><p>Review the area and its tables before saving.</p></div><div className="area-preview"><div className={`area-preview__icon area-tag--${draft.color}`}><AreaIcon name={draft.icon} size={24} /></div><div><span>Area Name</span><strong>{draft.name}</strong><p>{draft.description || "No description provided."}</p></div></div><div className="area-preview__meta"><span><small>Selected icon</small><strong>{draft.icon}</strong></span><span><small>Selected colour</small><strong>{draft.color}</strong></span></div><div className="area-preview__tables"><h4>Tables</h4>{draft.tables.length ? draft.tables.map((table) => <div key={table.id}><strong>{table.code}</strong><span>{table.capacity} pax</span></div>) : <p>No tables have been added.</p>}</div></div> : null}
      </Modal>
    </div>
  );
}

export function AdminAreasTablesPage({ navigationGroups = adminNavigationGroups, profile = adminProfile }) {
  const { signOut, user } = useAuth();
  const [areas, setAreas] = useState([]);
  const [filter, setFilter] = useState("all");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState("new");
  const [editingId, setEditingId] = useState(null);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(createDraft);
  const [tableDraft, setTableDraft] = useState({ code: "", capacity: "" });
  const [showTableForm, setShowTableForm] = useState(false);
  const [errors, setErrors] = useState({});
  const [deleteArea, setDeleteArea] = useState(null);
  const [toast, setToast] = useState(null);
  const presentationByArea = useRef(new Map());

  const handleRequestError = useCallback(async (error) => {
    if (error?.status === 401) {
      await signOut().catch(() => {});
      return;
    }
    setToast({ message: error?.message || "Please try again.", title: "Unable to complete request", variant: "error" });
  }, [signOut]);

  const loadAreas = useCallback(async ({ signal } = {}) => {
    if (!user?.hotelId) {
      setAreas([]);
      setToast({ message: "Your account does not have an available hotel context.", title: "Unable to load dining areas", variant: "error" });
      return;
    }

    try {
      const serverAreas = await getDiningAreas(user.hotelId, { signal });
      setAreas(serverAreas.map((area) => toViewArea(area, presentationByArea.current.get(area.id))));
    } catch (error) {
      if (error?.name !== "AbortError") await handleRequestError(error);
    }
  }, [handleRequestError, user?.hotelId]);

  useEffect(() => {
    const controller = new AbortController();
    loadAreas({ signal: controller.signal });
    return () => controller.abort();
  }, [loadAreas]);

  const summary = useMemo(() => areas.flatMap((area) => area.tables).reduce((counts, table) => ({ ...counts, total: counts.total + 1, ...(Object.hasOwn(counts, table.status) ? { [table.status]: counts[table.status] + 1 } : {}) }), { total: 0, available: 0, occupied: 0, reserved: 0 }), [areas]);

  const visibleAreas = useMemo(() => areas.map((area) => ({ ...area, visibleTables: filter === "all" ? area.tables : area.tables.filter((table) => table.status === filter) })).filter((area) => filter === "all" || area.visibleTables.length), [areas, filter]);

  const closeWizard = () => { setWizardOpen(false); setErrors({}); setShowTableForm(false); };
  const openNewArea = () => { setWizardMode("new"); setEditingId(null); setDraft(createDraft()); setStep(1); setTableDraft({ code: "", capacity: "" }); setErrors({}); setShowTableForm(false); setWizardOpen(true); };
  const openEditArea = (area, initialStep = 1, addTable = false) => { setWizardMode("edit"); setEditingId(area.id); setDraft({ name: area.name, description: area.description, icon: area.icon, color: area.color, tables: area.tables.map((table) => ({ ...table })) }); setStep(initialStep); setTableDraft({ code: "", capacity: "" }); setErrors({}); setShowTableForm(addTable); setWizardOpen(true); };
  const updateDraft = (change) => setDraft((current) => ({ ...current, ...change }));

  const nextStep = () => {
    if (step === 1 && !draft.name.trim()) { setErrors({ name: "Area name is required." }); return; }
    setErrors({}); setStep((current) => Math.min(3, current + 1));
  };

  const addDraftTable = () => {
    const code = tableDraft.code.trim().toUpperCase();
    const capacity = Number(tableDraft.capacity);
    if (!code) { setErrors({ table: "Table code is required." }); return; }
    if (!Number.isFinite(capacity) || capacity <= 0) { setErrors({ table: "Capacity must be a positive number." }); return; }
    if (draft.tables.some((table) => table.code.toUpperCase() === code)) { setErrors({ table: "Table codes must be unique within this area." }); return; }
    setDraft((current) => ({
      ...current,
      tables: [...current.tables, { id: `table-${crypto.randomUUID()}`, code, capacity, status: "available" }],
    }));
    setTableDraft({ code: "", capacity: "" }); setShowTableForm(false); setErrors({});
  };

  const saveArea = async () => {
    if (!user?.hotelId) return;
    const presentation = { description: draft.description.trim(), icon: draft.icon, color: draft.color };
    const tablesToSave = draft.tables.map((table) => ({ ...table }));
    let newAreaCreated = false;

    try {
      let areaId = editingId;
      const originalArea = wizardMode === "edit" ? areas.find((area) => area.id === editingId) : null;
      if (wizardMode === "edit") {
        await updateDiningArea(user.hotelId, editingId, { name: draft.name.trim() });
      } else {
        const createdArea = await createDiningArea(user.hotelId, { name: draft.name.trim(), status: "active" });
        areaId = createdArea.id;
        newAreaCreated = true;
      }

      presentationByArea.current.set(areaId, presentation);
      const retainedIds = new Set(tablesToSave.filter((table) => !table.id.startsWith("table-")).map((table) => table.id));
      for (const table of originalArea?.tables || []) {
        if (!retainedIds.has(table.id)) await deleteDiningTable(user.hotelId, table.id);
      }
      const tableFailures = [];
      let createdTableCount = 0;
      for (const table of tablesToSave) {
        if (table.id.startsWith("table-")) {
          try {
            await createDiningTable(user.hotelId, {
              capacity: table.capacity,
              dining_area_id: areaId,
              status: table.status,
              table_number: table.code,
            });
            createdTableCount += 1;
          } catch (error) {
            if (error?.status === 401) throw error;
            tableFailures.push({ code: table.code, error });
          }
        } else {
          const original = originalArea?.tables.find((candidate) => candidate.id === table.id);
          if (original && (original.code !== table.code || original.capacity !== table.capacity)) {
            await updateDiningTable(user.hotelId, table.id, {
              capacity: table.capacity,
              dining_area_id: areaId,
              status: table.status,
              table_number: table.code,
            });
          }
        }
      }

      await loadAreas();
      closeWizard();
      if (tableFailures.length) {
        const failedCodes = tableFailures.map(({ code }) => code).join(", ");
        setToast({
          title: newAreaCreated ? "Area created with table errors" : "Area updated with table errors",
          message: `${createdTableCount} of ${createdTableCount + tableFailures.length} new tables were created. ${failedCodes} could not be created: ${tableFailures[0].error.message}`,
          variant: "error",
        });
        return;
      }
      setToast({ title: wizardMode === "edit" ? "Area updated" : "Area created", message: `${draft.name.trim()} and its ${tablesToSave.length} tables are ready.` });
    } catch (error) {
      await loadAreas();
      if (newAreaCreated && error?.status !== 401) {
        closeWizard();
        setToast({ message: `${draft.name.trim()} was created, but its table changes could not be completed: ${error.message}`, title: "Area created with table errors", variant: "error" });
      } else {
        await handleRequestError(error);
      }
    }
  };

  const removeLiveTable = async (_areaId, tableId) => {
    if (!user?.hotelId) return;
    try {
      await deleteDiningTable(user.hotelId, tableId);
      await loadAreas();
      setToast({ title: "Table removed", message: "The table was removed from the dining area." });
    } catch (error) {
      await handleRequestError(error);
    }
  };
  const confirmDeleteArea = async () => {
    if (!user?.hotelId || !deleteArea) return;
    try {
      await deleteDiningArea(user.hotelId, deleteArea.id);
      setDeleteArea(null);
      await loadAreas();
      setToast({ title: "Area deleted", message: "The dining area was deleted successfully." });
    } catch (error) {
      await handleRequestError(error);
    }
  };

  return <AppShell navigationGroups={navigationGroups} profile={profile} title="Areas & Tables"><div className="areas-page"><header className="areas-page__header"><div><p className="eyebrow">Dining configuration</p><h2>Areas & Tables</h2><Breadcrumb /><p>Manage dining areas and table layout</p></div><Button icon={Plus} onClick={openNewArea}>New Area</Button></header><section aria-label="Table summary" className="area-summary-grid"><SummaryCard icon={TableProperties} label="Total Tables" tone="total" value={summary.total} /><SummaryCard icon={CheckCircle2} label="Available" tone="available" value={summary.available} /><SummaryCard icon={UsersRound} label="Occupied" tone="occupied" value={summary.occupied} /><SummaryCard icon={Clock3} label="Reserved" tone="reserved" value={summary.reserved} /></section><div aria-label="Filter tables by status" className="area-filter-tabs" role="group">{filters.map((status) => <button aria-pressed={filter === status} className={filter === status ? "is-active" : ""} key={status} onClick={() => setFilter(status)} type="button">{status}</button>)}</div><section className="area-list">{visibleAreas.map((area) => { const capacity = area.tables.reduce((total, table) => total + table.capacity, 0); return <article className="area-card" key={area.id}><header className="area-card__header"><div className={`area-card__identity area-tag--${area.color}`}><span><AreaIcon name={area.icon} /></span><div><h3>{area.name}</h3><p>{area.total_tables} tables • {capacity} pax capacity</p></div></div><div className="area-card__actions"><Button onClick={() => openEditArea(area)} size="sm" variant="outline"><Pencil size={14} /> Edit</Button><Button onClick={() => setDeleteArea(area)} size="sm" variant="danger"><Trash2 size={14} /> Delete</Button></div></header><div className="area-card__body"><div className="area-table-strip">{area.visibleTables.map((table) => <article className={`dining-table-card dining-table-card--${table.status}`} key={table.id}><button aria-label={`Remove ${table.code}`} className="dining-table-card__remove" onClick={() => removeLiveTable(area.id, table.id)} type="button"><Trash2 size={13} /></button><Armchair aria-hidden="true" size={21} /><strong>{table.code}</strong><span>{table.capacity} pax</span><small>{table.status}</small></article>)}{filter === "all" ? <button className="dining-table-add" onClick={() => openEditArea(area, 2, true)} type="button"><Plus aria-hidden="true" size={20} /><strong>Add table</strong></button> : null}</div></div><footer className="area-card__legend"><span><i className="is-available" />Available</span><span><i className="is-occupied" />Occupied</span><span><i className="is-reserved" />Reserved</span></footer></article>; })}{visibleAreas.length === 0 ? <div className="area-filter-empty"><TableProperties aria-hidden="true" size={28} /><h3>No {filter} tables</h3><p>Choose another status to view the current table layout.</p></div> : null}</section></div><AreaWizard draft={draft} errors={errors} isOpen={wizardOpen} mode={wizardMode} onAddTable={addDraftTable} onBack={() => setStep((current) => Math.max(1, current - 1))} onChange={updateDraft} onClose={closeWizard} onNext={nextStep} onRemoveTable={(tableId) => updateDraft({ tables: draft.tables.filter((table) => table.id !== tableId) })} onSave={saveArea} setErrors={setErrors} setShowTableForm={setShowTableForm} setTableDraft={setTableDraft} showTableForm={showTableForm} step={step} tableDraft={tableDraft} /><Modal actions={<><Button onClick={() => setDeleteArea(null)} variant="ghost">Cancel</Button><Button onClick={confirmDeleteArea} variant="danger">Delete Area</Button></>} description="Deleting this area will also remove all tables associated with it. This action cannot be undone." isOpen={Boolean(deleteArea)} onClose={() => setDeleteArea(null)} title="Delete Area?" />{toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}</AppShell>;
}
