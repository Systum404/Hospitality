import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";

export function FilterButton({ children }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!containerRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  return <div className="filter-dropdown" ref={containerRef}><button aria-expanded={open} aria-haspopup="true" aria-label="Filter options" className="filter-button" onClick={() => setOpen((current) => !current)} type="button"><SlidersHorizontal aria-hidden="true" size={17} /><span>Filter</span></button>{open ? <div className="filter-dropdown__menu">{children}</div> : null}</div>;
}
