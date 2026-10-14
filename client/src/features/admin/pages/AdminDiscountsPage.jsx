import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { adminNavigationGroups as navigationGroups, adminProfile as profile } from "../adminConfig.js";
import { createDiscount, deleteDiscount, getDiscounts, updateDiscount, updateDiscountStatus } from "../services/discountsService.js";
import { getMenuCategories, getMenuItems } from "../services/menuManagementService.js";

const filters = ["all", "active", "expired", "inactive"];
const emptyDraft = () => ({ code: "", type: "percentage", value: "", minOrderAmount: "", expiryDate: "", status: "active", applicability: "all", categoryIds: [], itemIds: [] });
const values = (event) => Array.from(event.target.selectedOptions, (option) => option.value);

function effectiveStatus(discount) { return discount.end_date && new Date(discount.end_date) < new Date() ? "expired" : discount.is_active ? "active" : "inactive"; }
function formatDate(date) { return date ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date)) : "—"; }
function formatMoney(value) { if (value === null || value === undefined) return "—"; const [whole, fraction] = String(value).split("."); return `₹${Number(whole).toLocaleString("en-IN")}${fraction ? `.${fraction}` : ""}`; }

function DiscountForm({ categories, draft, errors, items, onChange }) {
  return <div className="discount-form">
    <Input label="Discount Code *" name="discount-code" onChange={(event) => onChange({ code: event.target.value.toUpperCase() })} placeholder="e.g. HAPPY10" value={draft.code} />
    {errors.code ? <span className="discount-form-error">{errors.code}</span> : null}
    <Select label="Discount Type *" name="discount-type" onChange={(event) => onChange({ type: event.target.value })} value={draft.type}><option value="percentage">Percentage</option><option value="fixed">Fixed Amount</option></Select>
    <Input label="Discount Value *" min="0.01" name="discount-value" onChange={(event) => onChange({ value: event.target.value })} step="0.01" type="number" value={draft.value} />
    {errors.value ? <span className="discount-form-error">{errors.value}</span> : null}
    <Input label="Minimum Order Amount" min="0" name="discount-minimum" onChange={(event) => onChange({ minOrderAmount: event.target.value })} placeholder="Optional" type="number" value={draft.minOrderAmount} />
    {errors.minimum ? <span className="discount-form-error">{errors.minimum}</span> : null}
    <Select label="Applies To *" name="discount-applicability" onChange={(event) => onChange({ applicability: event.target.value, categoryIds: [], itemIds: [] })} value={draft.applicability}><option value="all">All items</option><option value="categories">Categories</option><option value="specific_items">Specific items</option></Select>
    {draft.applicability === "categories" ? <Select label="Categories *" multiple name="discount-categories" onChange={(event) => onChange({ categoryIds: values(event) })} size="4" value={draft.categoryIds}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select> : null}
    {draft.applicability === "specific_items" ? <Select label="Menu Items *" multiple name="discount-items" onChange={(event) => onChange({ itemIds: values(event) })} size="4" value={draft.itemIds}>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select> : null}
    {errors.applicability ? <span className="discount-form-error">{errors.applicability}</span> : null}
    <div className="discount-form__row"><Input label="Expiry Date *" name="discount-expiry" onChange={(event) => onChange({ expiryDate: event.target.value })} type="date" value={draft.expiryDate} /><Select label="Status" name="discount-status" onChange={(event) => onChange({ status: event.target.value })} value={draft.status}><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
    {errors.expiry ? <span className="discount-form-error">{errors.expiry}</span> : null}
  </div>;
}

function DiscountCard({ discount, isSubmitting, onDelete, onEdit, onToggle }) {
  const status = effectiveStatus(discount); const fixedAmount = discount.discount_type === "fixed_amount";
  return <article className={`discount-card discount-card--${status}`}>
    <div className="discount-card__top"><div className="discount-code"><strong>{discount.name}</strong><button aria-label={`Copy ${discount.name}`} className="icon-button" onClick={() => navigator.clipboard?.writeText(discount.name)} type="button"><Copy size={15} /></button></div><span className={`discount-status discount-status--${status}`}><i />{status}</span></div>
    <div className="discount-card__value"><strong>{fixedAmount ? formatMoney(discount.discount_value) : discount.discount_value}</strong><span>{fixedAmount ? "OFF" : "% OFF"}</span></div>
    <div className="discount-usage"><div><span>Usage</span><strong>—</strong></div></div>
    <div className="discount-card__meta"><span><small>Minimum order</small><strong>{discount.min_order_amount === "0.00" ? "No minimum" : `Min: ${formatMoney(discount.min_order_amount)}`}</strong></span><span><small>Expiration</small><strong>Exp: {formatDate(discount.end_date)}</strong></span></div>
    <footer><button aria-label={`Edit ${discount.name}`} className="icon-button" disabled={isSubmitting} onClick={() => onEdit(discount)} type="button"><Pencil size={16} /></button><button aria-label={`Change status for ${discount.name}`} className={`icon-button status-action status-action--${discount.is_active ? "active" : "inactive"}`} disabled={isSubmitting} onClick={() => onToggle(discount)} type="button"><Ban size={16} /></button><button aria-label={`Delete ${discount.name}`} className="icon-button discount-card__delete" disabled={isSubmitting} onClick={() => onDelete(discount)} type="button"><Trash2 size={16} /></button></footer>
  </article>;
}

export function AdminDiscountsPage() {
  const { signOut, user } = useAuth();
  const [discounts, setDiscounts] = useState([]), [categories, setCategories] = useState([]), [items, setItems] = useState([]), [filter, setFilter] = useState("all"), [isLoading, setIsLoading] = useState(true), [isSubmitting, setIsSubmitting] = useState(false), [editorOpen, setEditorOpen] = useState(false), [editingId, setEditingId] = useState(null), [deleting, setDeleting] = useState(null), [draft, setDraft] = useState(emptyDraft), [errors, setErrors] = useState({}), [toast, setToast] = useState(null);
  const handleRequestError = useCallback(async (error, title = "Unable to complete request") => { if (error?.status === 401) { await signOut().catch(() => {}); return; } setToast({ title, message: error?.message || "Please try again.", variant: "error" }); }, [signOut]);
  const loadDiscounts = useCallback(async ({ signal } = {}) => {
    if (!user?.hotelId) { setDiscounts([]); setCategories([]); setItems([]); setIsLoading(false); setToast({ title: "Unable to load discounts", message: "Your account does not have an available hotel context.", variant: "error" }); return; }
    setIsLoading(true); try { const [nextDiscounts, nextCategories, nextItems] = await Promise.all([getDiscounts(user.hotelId, { signal }), getMenuCategories(user.hotelId, { signal }), getMenuItems(user.hotelId, { signal })]); setDiscounts(nextDiscounts); setCategories(nextCategories); setItems(nextItems); } catch (error) { if (error?.name !== "AbortError") { setDiscounts([]); await handleRequestError(error, "Unable to load discounts"); } } finally { if (!signal?.aborted) setIsLoading(false); }
  }, [handleRequestError, user?.hotelId]);
  useEffect(() => { const controller = new AbortController(); loadDiscounts({ signal: controller.signal }); return () => controller.abort(); }, [loadDiscounts]);
  const counts = useMemo(() => ({ all: discounts.length, active: discounts.filter((discount) => effectiveStatus(discount) === "active").length, expired: discounts.filter((discount) => effectiveStatus(discount) === "expired").length, inactive: discounts.filter((discount) => effectiveStatus(discount) === "inactive").length }), [discounts]);
  const visibleDiscounts = useMemo(() => filter === "all" ? discounts : discounts.filter((discount) => effectiveStatus(discount) === filter), [discounts, filter]);
  const openAdd = () => { setEditingId(null); setDraft(emptyDraft()); setErrors({}); setEditorOpen(true); };
  const openEdit = (discount) => { setEditingId(discount.id); setDraft({ code: discount.name, type: discount.discount_type === "fixed_amount" ? "fixed" : "percentage", value: discount.discount_value, minOrderAmount: discount.min_order_amount === "0.00" ? "" : discount.min_order_amount, expiryDate: discount.end_date ? discount.end_date.slice(0, 10) : "", status: discount.is_active ? "active" : "inactive", applicability: discount.applicable_on, categoryIds: discount.category_ids || [], itemIds: discount.menu_item_ids || [] }); setErrors({}); setEditorOpen(true); };
  const closeEditor = () => { if (!isSubmitting) { setEditorOpen(false); setErrors({}); } };
  const updateDraft = (change) => { setDraft((current) => ({ ...current, ...change })); setErrors({}); };
  const saveDiscount = async () => {
    if (!user?.hotelId || isSubmitting) return; const nextErrors = {}; const name = draft.code.trim().toUpperCase(), value = draft.value.trim(), minimum = draft.minOrderAmount.trim();
    if (!name) nextErrors.code = "Discount code is required."; if (!value || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value) || /^0+(?:\.0+)?$/.test(value)) nextErrors.value = "Discount value must be greater than 0 with up to 2 decimal places."; else if (draft.type === "percentage" && Number(value) > 100) nextErrors.value = "Percentage discount cannot exceed 100%."; if (minimum && !/^\d{1,10}(?:\.\d{1,2})?$/.test(minimum)) nextErrors.minimum = "Minimum order amount cannot be negative."; if (!draft.expiryDate) nextErrors.expiry = "A valid expiry date is required."; if ((draft.applicability === "categories" && !draft.categoryIds.length) || (draft.applicability === "specific_items" && !draft.itemIds.length)) nextErrors.applicability = "Select at least one applicable option."; if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    const payload = { applicable_on: draft.applicability, discount_type: draft.type, discount_value: value, end_date: draft.expiryDate, is_active: draft.status === "active", min_order_amount: minimum || "0", name, ...(editingId ? {} : { start_date: null }) };
    if (draft.applicability === "categories") payload.category_ids = draft.categoryIds;
    if (draft.applicability === "specific_items") payload.menu_item_ids = draft.itemIds;
    setIsSubmitting(true); try { if (editingId) await updateDiscount(user.hotelId, editingId, payload); else await createDiscount(user.hotelId, payload); setEditorOpen(false); await loadDiscounts(); setToast({ title: editingId ? "Discount updated" : "Discount created", message: `${name} is ready for use.` }); } catch (error) { await handleRequestError(error); } finally { setIsSubmitting(false); }
  };
  const toggleDiscount = async (discount) => { if (!user?.hotelId || isSubmitting) return; setIsSubmitting(true); try { await updateDiscountStatus(user.hotelId, discount.id, !discount.is_active); await loadDiscounts(); setToast({ title: discount.is_active ? "Discount deactivated" : "Discount activated", message: "Promo code status was updated." }); } catch (error) { await handleRequestError(error); } finally { setIsSubmitting(false); } };
  const confirmDelete = async () => { if (!deleting || !user?.hotelId || isSubmitting) return; setIsSubmitting(true); try { await deleteDiscount(user.hotelId, deleting.id); setDeleting(null); await loadDiscounts(); setToast({ title: "Discount deleted", message: `${deleting.name} was removed.` }); } catch (error) { await handleRequestError(error); } finally { setIsSubmitting(false); } };
  return <AppShell navigationGroups={navigationGroups} profile={profile} title="Discounts"><div className="discounts-page"><header className="discounts-page__header"><div><p className="eyebrow">Promotion management</p><h2>Discounts</h2><Breadcrumb /><p>Manage promo codes and offers</p></div><Button disabled={isSubmitting} icon={Plus} onClick={openAdd}>New Discount</Button></header><div aria-label="Filter discounts by status" className="discount-filter-tabs" role="group">{filters.map((status) => <button aria-pressed={filter === status} className={filter === status ? "is-active" : ""} key={status} onClick={() => setFilter(status)} type="button">{status} <span>({counts[status]})</span></button>)}</div>{isLoading ? <LoadingState label="Loading discounts" /> : visibleDiscounts.length ? <section aria-label="Discount offers" className="discount-grid">{visibleDiscounts.map((discount) => <DiscountCard discount={discount} isSubmitting={isSubmitting} key={discount.id} onDelete={setDeleting} onEdit={openEdit} onToggle={toggleDiscount} />)}</section> : <div className="discount-empty"><Check aria-hidden="true" size={26} /><h3>No {filter} discounts</h3><p>Discounts matching this status will appear here.</p></div>}</div><Modal actions={<><Button disabled={isSubmitting} onClick={closeEditor} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={saveDiscount}>{editingId ? "Save Changes" : "Create Discount"}</Button></>} className="discount-editor-modal" description="Create a promo code for hotel and restaurant billing." isOpen={editorOpen} onClose={closeEditor} title={editingId ? "Edit Discount" : "New Discount"}><DiscountForm categories={categories} draft={draft} errors={errors} items={items} onChange={updateDraft} /></Modal><Modal actions={<><Button disabled={isSubmitting} onClick={() => setDeleting(null)} variant="ghost">Cancel</Button><Button disabled={isSubmitting} onClick={confirmDelete} variant="danger">Delete Discount</Button></>} isOpen={Boolean(deleting)} onClose={() => !isSubmitting && setDeleting(null)} title="Delete Discount"><p>Are you sure you want to delete this discount?</p></Modal>{toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}</AppShell>;
}
