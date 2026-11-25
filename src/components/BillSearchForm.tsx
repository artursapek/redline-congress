import React from "react";
import { Search, X } from "lucide-react";

interface BillSearchFormProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
  searching: boolean;
  placeholder?: string;
}

/** Search field with the submit button beside it (shared by home and list pages). */
export const BillSearchForm: React.FC<BillSearchFormProps> = ({
  query,
  onQueryChange,
  onSubmit,
  onClear,
  searching,
  placeholder = "Search legislation",
}) => (
  <form className="rc-search-form" onSubmit={onSubmit}>
    <div className="rc-search-field">
      <Search size={16} style={{ color: "var(--content-subtle)", flexShrink: 0 }} />
      <input
        type="text"
        className="rc-search-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {query && (
        <button
          type="button"
          className="rc-icon-btn"
          style={{ border: "none", width: 28, height: 28 }}
          onClick={onClear}
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
    <button
      type="submit"
      className="rc-btn rc-btn-primary rc-search-submit"
      disabled={searching || !query.trim()}
    >
      Search
    </button>
  </form>
);
