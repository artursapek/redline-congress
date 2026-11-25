import React from "react";
import { Link } from "react-router-dom";
import { LawBadge, StagePill } from "./StagePill";

// H.R. 3162 (107th), the USA PATRIOT Act: published text versions before it became law.
const DEMO_STAGES = ["ih", "eh", "rds"];

/**
 * Real redline excerpt: §215 of the USA PATRIOT Act (new FISA §501(b)),
 * Introduced in House → Enrolled. Text is verbatim from GPO
 * (BILLS-107hr3162ih / BILLS-107hr3162enr); the only change in this
 * passage is the inserted "obtain foreign intelligence information…" clause.
 * The whole card links to that comparison, scrolled to §501.
 */
export const HeroRedlineDemo: React.FC = () => (
  <Link
    to="/107/hr/3162/ih..enr#sec-501"
    className="rc-demo-frame"
    aria-label="Open the USA PATRIOT Act redline, Introduced to Enrolled"
  >
    <div className="rc-demo-chrome">
      <div className="rc-demo-doc-title">
        <span>H.R. 3162 — USA PATRIOT Act</span>
        <span className="rc-stage-chain">
          {DEMO_STAGES.map((code, idx) => (
            <React.Fragment key={code}>
              {idx > 0 && <span className="rc-stage-arrow">→</span>}
              <StagePill code={code} />
            </React.Fragment>
          ))}
          <span className="rc-stage-arrow">→</span>
          <LawBadge law="Public Law 107-56" date="Oct 26, 2001" />
        </span>
      </div>
    </div>

    <div className="rc-demo-paper">
      <h4>
        “Sec. 501. Access to certain business records for foreign intelligence and
        international terrorism investigations.
      </h4>
      <p>“(b) Each application under this section—</p>
      <p className="rc-demo-indent">“(1) shall be made to— … ; and</p>
      <p className="rc-demo-indent">
        “(2) shall specify that the records concerned are sought for an authorized
        investigation conducted in accordance with subsection (a)(2) to{" "}
        <span className="rc-ins">
          obtain foreign intelligence information not concerning a United States
          person or to
        </span>{" "}
        protect against international terrorism or clandestine intelligence
        activities.
      </p>
    </div>
  </Link>
);
