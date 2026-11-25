import React from "react";
import { Check } from "lucide-react";
import { describeStage } from "../../shared/bills";
import { Tooltip } from "./Tooltip";

/** Bill text stage code (IH, RS, ENR…) with a tooltip saying what it means. */
export const StagePill: React.FC<{ code: string; latest?: boolean }> = ({ code, latest }) => (
  <Tooltip content={describeStage(code)}>
    <span className="rc-stage-pill" data-latest={latest ? "true" : undefined}>
      {code}
    </span>
  </Tooltip>
);

/** Green "✓ Law" badge for bills that were signed into law. */
export const LawBadge: React.FC<{ law: string; date?: string | null }> = ({
  law,
  date,
}) => (
  <Tooltip content={`Became ${law}${date ? ` · ${date}` : ""}`}>
    <span className="rc-law-badge">
      <Check size={11} strokeWidth={3} aria-hidden="true" />
      Law
    </span>
  </Tooltip>
);
