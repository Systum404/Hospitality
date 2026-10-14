import { Clock3, ImageOff, Leaf, Plus } from "lucide-react";
import { useState } from "react";

function MenuImage({ item }) {
  const [failed, setFailed] = useState(false);
  return item.image_url && !failed
    ? <img alt="" loading="lazy" onError={() => setFailed(true)} referrerPolicy="no-referrer" src={item.image_url} />
    : <span className="public-menu-card__fallback"><ImageOff aria-hidden="true" size={24} /></span>;
}

export function PublicMenu({ activeCategory, categories, items, notice, onAdd, onCategoryChange }) {
  const visible = activeCategory === "all" ? items : items.filter(item => item.category_id === activeCategory);
  return (
    <section aria-labelledby="public-menu-title" className="public-menu">
      <div className="public-section-heading"><div><p className="public-order-eyebrow">Restaurant menu</p><h2 id="public-menu-title">Choose your items</h2></div></div>
      {notice ? <p className="public-menu-notice" role="status">{notice}</p> : null}
      <nav aria-label="Menu categories" className="public-category-list">
        <button aria-pressed={activeCategory === "all"} className={activeCategory === "all" ? "is-active" : ""} onClick={() => onCategoryChange("all")} type="button">All</button>
        {categories.map(category => <button aria-pressed={activeCategory === category.id} className={activeCategory === category.id ? "is-active" : ""} key={category.id} onClick={() => onCategoryChange(category.id)} type="button">{category.name}</button>)}
      </nav>
      {visible.length ? <div className="public-menu-grid">{visible.map(item => (
        <article className="public-menu-card" key={item.id}>
          <MenuImage item={item} />
          <div className="public-menu-card__body">
            <div className="public-menu-card__heading"><h3>{item.name}</h3>{item.is_veg ? <span title="Vegetarian"><Leaf aria-hidden="true" size={15} /> Veg</span> : null}</div>
            {item.description ? <p>{item.description}</p> : null}
            {item.preparation_time ? <small><Clock3 aria-hidden="true" size={14} /> {item.preparation_time} min</small> : null}
            <footer><strong>₹{item.price}</strong><button aria-label={`Add ${item.name} to cart`} onClick={() => onAdd(item)} type="button"><Plus aria-hidden="true" size={18} /> Add</button></footer>
          </div>
        </article>
      ))}</div> : <div className="public-inline-empty"><h3>No menu items available</h3><p>Please check again later or ask hotel staff.</p></div>}
    </section>
  );
}
