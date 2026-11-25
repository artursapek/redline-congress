import React from "react";

/** "Data from Congress.gov · Documents diffed and rendered with Revise SDK" */
export const SiteCredit: React.FC<{ className?: string }> = ({ className }) => (
  <div className={`rc-credit${className ? ` ${className}` : ""}`}>
    <span>
      Data from the{" "}
      <a href="https://api.congress.gov" target="_blank" rel="noopener noreferrer">
        Congress.gov API
      </a>
    </span>
    <span className="rc-credit-sep" aria-hidden="true">
      ·
    </span>
    <span>
      Documents rendered with{" "}
      <a
        href="https://revise.io/sdk"
        target="_blank"
        rel="noopener noreferrer"
      >
        Revise SDK
      </a>
    </span>
  </div>
);
