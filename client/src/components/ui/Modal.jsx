import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({ actions, children, className = "", description, isOpen, onClose, title }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className={`modal-backdrop ${className}`.trim()} onMouseDown={onClose} role="presentation">
      <section aria-modal="true" aria-labelledby="modal-title" className="modal" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal__header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button aria-label="Close modal" className="icon-button" onClick={onClose} type="button"><X size={19} /></button>
        </header>
        <div className="modal__content">{children}</div>
        {actions ? <footer className="modal__footer">{actions}</footer> : null}
      </section>
    </div>
  );
}
