import { Search } from "lucide-react";

export function SearchInput({ className = "", ...props }) {
  return (
    <label className={`search-input ${className}`.trim()}>
      <Search aria-hidden="true" size={18} strokeWidth={2} />
      <input aria-label="Search" placeholder="Search..." type="search" {...props} />
    </label>
  );
}
