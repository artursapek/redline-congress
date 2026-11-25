import React from "react";
import { CAPITOL_MARK_SVG_INNER } from "../../shared/capitolMark";

export const CapitolMark: React.FC<{ size?: number; className?: string }> = ({
  size = 22,
  className,
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: CAPITOL_MARK_SVG_INNER }}
  />
);
