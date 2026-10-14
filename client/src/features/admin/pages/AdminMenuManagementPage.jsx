import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban, Pencil, Plus, Trash2, UtensilsCrossed,
} from "lucide-react";
import { AppShell } from "../../../components/layout/AppShell.jsx";
import { Breadcrumb } from "../../../components/navigation/Breadcrumb.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { FilterButton } from "../../../components/ui/FilterButton.jsx";
import { EmptyState } from "../../../components/ui/EmptyState.jsx";
import { Input } from "../../../components/ui/Input.jsx";
import { LoadingState } from "../../../components/ui/LoadingState.jsx";
import { Modal } from "../../../components/ui/Modal.jsx";
import { SearchInput } from "../../../components/ui/SearchInput.jsx";
import { SemanticIcon } from "../../../components/ui/SemanticIcon.jsx";
import { Select } from "../../../components/ui/Select.jsx";
import { Textarea } from "../../../components/ui/Textarea.jsx";
import { Toast } from "../../../components/ui/Toast.jsx";
import { useAuth } from "../../auth/AuthContext.jsx";
import { adminNavigationGroups as navigationGroups, adminProfile as profile } from "../adminConfig.js";
import {
  createMenuCategory, createMenuItem, deleteMenuCategory, deleteMenuItem,
  getMenuCategories, getMenuItems, updateMenuCategory, updateMenuCategoryStatus,
  updateMenuItem, updateMenuItemStatus,
} from "../services/menuManagementService.js";

const emptyDraft = () => ({ name: "", category: "", description: "", price: "", status: "active" });
const emptyCategoryDraft = () => ({ name: "", description: "", display_order: "0", is_active: true });

function MenuItemCard({ item, onDelete, onEdit, onToggle }) {
  const isActive = item.is_available;
  const status = isActive ? "active" : "inactive";
  return (
    <article className={`menu-item-card ${isActive ? "" : "menu-item-card--inactive"}`}>
      <div className="menu-item-card__top">
        <span className={`menu-status menu-status--${status}`}><i />{status}</span>
        <div className="menu-item-card__actions">
          <button aria-label={`Edit ${item.name}`} className="icon-button" onClick={() => onEdit(item)} title="Edit" type="button"><Pencil size={16} /></button>
          <button aria-label={`${isActive ? "Deactivate" : "Activate"} ${item.name}`} className={`icon-button status-action status-action--${isActive ? "active" : "inactive"}`} onClick={() => onToggle(item.id)} title={isActive ? "Deactivate" : "Activate"} type="button"><Ban size={16} /></button>
          <button aria-label={`Delete ${item.name}`} className="icon-button menu-item-card__delete" onClick={() => onDelete(item)} title="Delete" type="button"><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="menu-item-card__content">
        <SemanticIcon className="menu-item-card__icon" icon={UtensilsCrossed} semantic="Menu food" />
        <h3>{item.name}</h3>
        <small>{item.category?.name || ""}</small>
        <p>{item.description || ""}</p>
      </div>
      <footer><span className="menu-item-card__price-label">Price</span><strong>₹{item.price}</strong></footer>
    </article>
  );
}

function MenuItemForm({ categories, draft, errors, onChange }) {
  return (
    <div className="menu-item-form">
      <Input label="Item Name *" name="menu-item-name" onChange={(event) => onChange({ name: event.target.value })} placeholder="e.g. Paneer Tikka" value={draft.name} />
      {errors.name ? <span className="menu-form-error">{errors.name}</span> : null}
      <Select label="Category *" name="menu-item-category" onChange={(event) => onChange({ category: event.target.value })} value={draft.category}><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select>
      {errors.category ? <span className="menu-form-error">{errors.category}</span> : null}
      <Textarea label="Description" name="menu-item-description" onChange={(event) => onChange({ description: event.target.value })} placeholder="Describe the dish" rows="3" value={draft.description} />
      <div className="menu-item-form__row">
        <Input label="Price *" min="1" name="menu-item-price" onChange={(event) => onChange({ price: event.target.value })} placeholder="e.g. 280" type="number" value={draft.price} />
        <Select label="Status" name="menu-item-status" onChange={(event) => onChange({ status: event.target.value })} value={draft.status}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
      </div>
      {errors.price ? <span className="menu-form-error">{errors.price}</span> : null}
      {errors.duplicate ? <span className="menu-form-error menu-form-error--panel">{errors.duplicate}</span> : null}
    </div>
  );
}

export function AdminMenuManagementPage() {
  const { signOut, user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("add");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [errors, setErrors] = useState({});
  const [deleteItem, setDeleteItem] = useState(null);
  const [toast, setToast] = useState(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryEditor, setCategoryEditor] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState(emptyCategoryDraft);
  const [categoryErrors, setCategoryErrors] = useState({});
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState(null);

  const menuCategories = useMemo(() => categories.map(({ name }) => name), [categories]);
  const categoryCounts = useMemo(() => Object.fromEntries(menuCategories.map((name) => [name, items.filter((item) => item.category?.name === name).length])), [items, menuCategories]);
  const visibleItems = useMemo(() => { const needle = query.trim().toLowerCase(); return items.filter((item) => (category === "All" || item.category?.name === category) && (!needle || [item.name, item.category?.name || "", item.description || ""].some((value) => value.toLowerCase().includes(needle)))); }, [category, items, query]);

  const loadMenu = useCallback(async ({ signal } = {}) => {
    if (!user?.hotelId) {
      setCategories([]);
      setItems([]);
      setIsLoading(false);
      setToast({ title: "Unable to load menu", message: "Your account does not have an available hotel context.", variant: "error" });
      return;
    }

    setIsLoading(true);
    try {
      const [nextCategories, nextItems] = await Promise.all([
        getMenuCategories(user.hotelId, { signal }),
        getMenuItems(user.hotelId, { signal }),
      ]);
      setCategories(nextCategories);
      setItems(nextItems);
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (error?.status === 401) {
        await signOut().catch(() => {});
        return;
      }
      setCategories([]);
      setItems([]);
      setToast({ title: "Unable to load menu", message: error?.message || "Please try again.", variant: "error" });
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [signOut, user?.hotelId]);

  useEffect(() => {
    const controller = new AbortController();
    loadMenu({ signal: controller.signal });
    return () => controller.abort();
  }, [loadMenu]);

  const handleMenuError = useCallback(async (error) => {
    if (error?.status === 401) {
      await signOut().catch(() => {});
      return;
    }
    setToast({ title: "Unable to complete request", message: error?.message || "Please try again.", variant: "error" });
  }, [signOut]);

  const openCategoryManager = () => { setCategoryEditor(null); setCategoryErrors({}); setCategoryManagerOpen(true); };
  const openNewCategory = () => { setCategoryEditor({ mode: "add", id: null }); setCategoryDraft(emptyCategoryDraft()); setCategoryErrors({}); };
  const openEditCategory = (entry) => { setCategoryEditor({ mode: "edit", id: entry.id }); setCategoryDraft({ name: entry.name, description: entry.description || "", display_order: String(entry.display_order), is_active: entry.is_active }); setCategoryErrors({}); };
  const updateCategoryDraft = (change) => { setCategoryDraft((current) => ({ ...current, ...change })); setCategoryErrors({}); };
  const saveCategory = async () => {
    if (!user?.hotelId) return;
    const name = categoryDraft.name.trim();
    const displayOrder = Number(categoryDraft.display_order);
    const nextErrors = {};
    if (!name) nextErrors.name = "Category name is required.";
    if (!Number.isInteger(displayOrder)) nextErrors.display_order = "Display order must be a whole number.";
    if (Object.keys(nextErrors).length) { setCategoryErrors(nextErrors); return; }
    const input = { name, description: categoryDraft.description || null, display_order: displayOrder, is_active: categoryDraft.is_active };
    try {
      if (categoryEditor.mode === "edit") await updateMenuCategory(user.hotelId, categoryEditor.id, input);
      else await createMenuCategory(user.hotelId, input);
      await loadMenu();
      setCategoryEditor(null);
      setToast({ title: categoryEditor.mode === "edit" ? "Category updated" : "Category created", message: `${name} was saved successfully.` });
    } catch (error) {
      await handleMenuError(error);
    }
  };
  const toggleCategory = async (entry) => {
    if (!user?.hotelId) return;
    try {
      await updateMenuCategoryStatus(user.hotelId, entry.id, !entry.is_active);
      await loadMenu();
      setToast({ title: entry.is_active ? "Category deactivated" : "Category activated", message: `${entry.name} status was updated.` });
    } catch (error) {
      await handleMenuError(error);
    }
  };
  const confirmDeleteCategory = async () => {
    if (!user?.hotelId || !deleteCategoryTarget) return;
    try {
      await deleteMenuCategory(user.hotelId, deleteCategoryTarget.id);
      setDeleteCategoryTarget(null);
      setCategory("All");
      await loadMenu();
      setToast({ title: "Category deleted", message: "The menu category was deleted successfully." });
    } catch (error) {
      await handleMenuError(error);
    }
  };

  const updateDraft = (change) => { setDraft((current) => ({ ...current, ...change })); setErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(change).map((key) => [key, ""])), duplicate: "" })); };
  const openAdd = () => { setEditorMode("add"); setEditingId(null); setDraft(emptyDraft()); setErrors({}); setEditorOpen(true); };
  const openEdit = (item) => { setEditorMode("edit"); setEditingId(item.id); setDraft({ name: item.name, category: item.category?.id || "", description: item.description || "", price: String(item.price), status: item.is_available ? "active" : "inactive" }); setErrors({}); setEditorOpen(true); };
  const closeEditor = () => { setEditorOpen(false); setErrors({}); };

  const saveItem = async () => {
    const nextErrors = {};
    const name = draft.name.trim();
    if (!name) nextErrors.name = "Item name is required.";
    if (!draft.category) nextErrors.category = "Category is required.";
    if (draft.price === "") nextErrors.price = "Price is required.";
    else if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(draft.price)) nextErrors.price = "Price must have up to 8 whole digits and 2 decimal places.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    const selectedCategory = categories.find((entry) => entry.id === draft.category);
    const input = {
      name,
      category_id: selectedCategory?.id || null,
      description: draft.description || null,
      price: draft.price,
      is_available: draft.status === "active",
    };
    try {
      if (editorMode === "edit") await updateMenuItem(user.hotelId, editingId, input);
      else await createMenuItem(user.hotelId, input);
      closeEditor();
      await loadMenu();
      setToast({ title: editorMode === "edit" ? "Menu item updated" : "Menu item created", message: `${name} was saved successfully.` });
    } catch (error) {
      await handleMenuError(error);
    }
  };

  const toggleItem = async (itemId) => {
    const item = items.find((entry) => entry.id === itemId);
    if (!user?.hotelId || !item) return;
    try {
      await updateMenuItemStatus(user.hotelId, itemId, !item.is_available);
      await loadMenu();
      setToast({ title: item.is_available ? "Menu item deactivated" : "Menu item activated", message: `${item.name} availability was updated.` });
    } catch (error) {
      await handleMenuError(error);
    }
  };
  const confirmDelete = async () => {
    if (!user?.hotelId || !deleteItem) return;
    try {
      await deleteMenuItem(user.hotelId, deleteItem.id);
      setDeleteItem(null);
      await loadMenu();
      setToast({ title: "Menu item deleted", message: "The menu item was deleted successfully." });
    } catch (error) {
      await handleMenuError(error);
    }
  };

  return (
    <AppShell navigationGroups={navigationGroups} profile={profile} title="Menu Management">
      <div className="menu-management-page">
        <header className="menu-management-page__header"><div><p className="eyebrow">Restaurant configuration</p><h2>Menu Management</h2><Breadcrumb /><p>{items.length} items across {menuCategories.length} categories</p></div><div className="menu-management-page__actions"><Button onClick={openCategoryManager} variant="outline">Categories</Button><Button icon={Plus} onClick={openAdd}>Add Item</Button></div></header>
        <div className="search-with-filter search-with-filter--spaced"><SearchInput className="menu-management-search" onChange={(event) => setQuery(event.target.value)} placeholder="Search items..." value={query} /><FilterButton><div aria-label="Filter menu by category" className="menu-category-tabs" role="group">{["All", ...menuCategories].map((name) => <button aria-pressed={category === name} className={category === name ? "is-active" : ""} key={name} onClick={() => setCategory(name)} type="button">{name} <span>({name === "All" ? items.length : categoryCounts[name]})</span></button>)}</div></FilterButton></div>
        {isLoading ? <LoadingState label="Loading menu" /> : visibleItems.length ? <section aria-label="Menu items" className="menu-item-grid">{visibleItems.map((item) => <MenuItemCard item={item} key={item.id} onDelete={setDeleteItem} onEdit={openEdit} onToggle={toggleItem} />)}</section> : <EmptyState description="Try a different category or search term." icon={UtensilsCrossed} title="No menu items found" />}
      </div>
      <Modal actions={<><Button onClick={closeEditor} variant="ghost">Cancel</Button><Button onClick={saveItem}>{editorMode === "add" ? "Add Item" : "Save Changes"}</Button></>} description={editorMode === "add" ? "Add a new item to the hotel restaurant menu." : "Update this menu item’s information and availability."} isOpen={editorOpen} onClose={closeEditor} title={editorMode === "add" ? "Add Menu Item" : "Edit Menu Item"}><MenuItemForm categories={categories} draft={draft} errors={errors} onChange={updateDraft} /></Modal>
      <Modal actions={<><Button onClick={() => setDeleteItem(null)} variant="ghost">Cancel</Button><Button onClick={confirmDelete} variant="danger">Delete</Button></>} description="Are you sure you want to delete this menu item?" isOpen={Boolean(deleteItem)} onClose={() => setDeleteItem(null)} title="Delete Menu Item?" />
      <Modal actions={categoryEditor ? <><Button onClick={() => setCategoryEditor(null)} variant="ghost">Cancel</Button><Button onClick={saveCategory}>{categoryEditor.mode === "add" ? "Create Category" : "Save Changes"}</Button></> : <Button onClick={() => setCategoryManagerOpen(false)} variant="ghost">Close</Button>} description={categoryEditor ? "Configure this menu category using the existing hotel menu fields." : "Create, edit, activate, deactivate, or delete menu categories."} isOpen={categoryManagerOpen} onClose={() => setCategoryManagerOpen(false)} title={categoryEditor ? categoryEditor.mode === "add" ? "New Category" : "Edit Category" : "Menu Categories"}>
        {categoryEditor ? <div className="menu-category-form"><Input label="Category Name *" onChange={(event) => updateCategoryDraft({ name: event.target.value })} value={categoryDraft.name} />{categoryErrors.name ? <span className="menu-form-error">{categoryErrors.name}</span> : null}<Textarea label="Description" onChange={(event) => updateCategoryDraft({ description: event.target.value })} rows="3" value={categoryDraft.description} /><Input label="Display Order" onChange={(event) => updateCategoryDraft({ display_order: event.target.value })} type="number" value={categoryDraft.display_order} />{categoryErrors.display_order ? <span className="menu-form-error">{categoryErrors.display_order}</span> : null}<Select label="Status" onChange={(event) => updateCategoryDraft({ is_active: event.target.value === "true" })} value={String(categoryDraft.is_active)}><option value="true">Active</option><option value="false">Inactive</option></Select></div> : <div className="menu-category-manager"><Button icon={Plus} onClick={openNewCategory} size="sm">New Category</Button>{categories.length ? <div className="menu-category-manager__list">{categories.map((entry) => <article key={entry.id}><div><strong>{entry.name}</strong><small>{entry.is_active ? "Active" : "Inactive"}</small></div><div className="menu-item-card__actions"><button aria-label={`Edit ${entry.name}`} className="icon-button" onClick={() => openEditCategory(entry)} title="Edit" type="button"><Pencil size={16} /></button><button aria-label={`${entry.is_active ? "Deactivate" : "Activate"} ${entry.name}`} className={`icon-button status-action status-action--${entry.is_active ? "active" : "inactive"}`} onClick={() => toggleCategory(entry)} title={entry.is_active ? "Deactivate" : "Activate"} type="button"><Ban size={16} /></button><button aria-label={`Delete ${entry.name}`} className="icon-button menu-item-card__delete" onClick={() => { setCategoryManagerOpen(false); setDeleteCategoryTarget(entry); }} title="Delete" type="button"><Trash2 size={16} /></button></div></article>)}</div> : <EmptyState description="Create the first category for this hotel menu." icon={UtensilsCrossed} title="No menu categories found" />}</div>}
      </Modal>
      <Modal actions={<><Button onClick={() => setDeleteCategoryTarget(null)} variant="ghost">Cancel</Button><Button onClick={confirmDeleteCategory} variant="danger">Delete Category</Button></>} description="Menu items will remain, but they will no longer belong to this category." isOpen={Boolean(deleteCategoryTarget)} onClose={() => setDeleteCategoryTarget(null)} title="Delete Category?" />
      {toast ? <div className="toast-region"><Toast message={toast.message} onDismiss={() => setToast(null)} title={toast.title} variant={toast.variant} /></div> : null}
    </AppShell>
  );
}
