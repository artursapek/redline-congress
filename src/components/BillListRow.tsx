import React from "react";
import { Link } from "react-router-dom";
import {
  congressOrdinal,
  formatBillNumber,
  getEnactedLaw,
  type BillSummary,
} from "../../shared/bills";
import { LawBadge, StagePill } from "./StagePill";

/** "2026-11-24" -> "Nov 24, 2026" (UTC, so dates don't shift by timezone). */
function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface BillListRowProps {
  bill: BillSummary;
}

export const BillListRow: React.FC<BillListRowProps> = ({ bill }) => {
  const numLabel = formatBillNumber(bill.type, bill.number);
  const billPath = `/${bill.congress}/${bill.type}/${bill.number}`;
  const enactedLaw = getEnactedLaw(bill);
  // Once a bill is law, the green badge replaces the trailing "enrolled" stage.
  const allVersions = bill.versions ?? [];
  const versions = enactedLaw
    ? allVersions.filter(
        (v, i) => !(i >= allVersions.length - 2 && (v.code === "enr" || v.code === "renr")),
      )
    : allVersions;

  // The date belongs to whatever the status line describes: the latest action
  // when we have its text, otherwise the latest published text version.
  const statusText = bill.latestActionText?.replace(/\.$/, "") || null;
  const statusDate = statusText
    ? bill.latestActionDate || bill.latestVersionDate
    : bill.latestVersionDate || bill.latestActionDate;

  return (
    <Link to={billPath} className="rc-bill-row">
      <div className="rc-bill-id-col">
        <span className="rc-bill-num">{numLabel}</span>
        <span className="rc-bill-congress">
          {congressOrdinal(bill.congress)} · {bill.originChamber || (bill.type.startsWith("h") ? "House" : "Senate")}
        </span>
      </div>

      <div className="rc-bill-main">
        <h3 className="rc-bill-title">{bill.title}</h3>
        <div className="rc-bill-meta">
          {bill.sponsorName && (
            <span>
              {bill.sponsorName}
              {!bill.sponsorName.includes("[") &&
              bill.sponsorParty &&
              bill.sponsorState
                ? ` (${bill.sponsorParty}-${bill.sponsorState})`
                : ""}
            </span>
          )}
          {bill.policyArea && (
            <>
              {bill.sponsorName && <span>·</span>}
              <span>{bill.policyArea}</span>
            </>
          )}
        </div>
      </div>

      {/* Right side is all current status: stage badges, then latest action + when. */}
      <div className="rc-bill-status">
        <div className="rc-stage-chain" aria-label="Bill versions">
          {versions.map((ver, idx) => (
            <React.Fragment key={ver.code}>
              {idx > 0 && <span className="rc-stage-arrow">→</span>}
              <StagePill
                code={ver.code}
                latest={!enactedLaw && idx === versions.length - 1}
              />
            </React.Fragment>
          ))}
          {enactedLaw && (
            <>
              {versions.length > 0 && <span className="rc-stage-arrow">→</span>}
              <LawBadge law={enactedLaw} />
            </>
          )}
          {versions.length === 0 && !enactedLaw && bill.latestVersionCode && (
            <StagePill code={bill.latestVersionCode} latest />
          )}
        </div>
        {(statusText || statusDate) && (
          <div className="rc-bill-status-line">
            {statusText && (
              <span className="rc-bill-status-text" title={statusText}>
                {statusText}
              </span>
            )}
            {statusDate && <span className="rc-bill-status-date">{formatDate(statusDate)}</span>}
          </div>
        )}
      </div>
    </Link>
  );
};
