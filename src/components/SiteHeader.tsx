import React from "react";
import { Link } from "react-router-dom";
import { Github, Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";
import { CapitolMark } from "./CapitolMark";

export const SITE_NAME = "RedlineCongress.org";
export const REPO_URL = "https://github.com/artursapek/redline-congress";

export interface HeaderCrumb {
  label: string;
  /** Extra words dropped on phones, e.g. " Congress". */
  labelSuffix?: string;
  to: string;
  /** Router state passed along with the navigation. */
  state?: unknown;
}

export interface HeaderNavGroup {
  /** Plain (non-link) label before the group's links, e.g. "Congress". */
  label: string;
  items: HeaderCrumb[];
}

interface SiteHeaderProps {
  /** Plain links shown after the brand (homepage: feed tabs). */
  nav?: HeaderCrumb[];
  /** A labelled group of links after `nav` (homepage: "Congress 119th 118th 117th"). */
  navGroup?: HeaderNavGroup;
  /** Linked breadcrumb trail after the site name, e.g. "119th Congress". */
  crumbs?: HeaderCrumb[];
  /** Short label shown after the site name, e.g. "H.R. 1". */
  pageLabel?: string;
  /** Badge shown right after the label, e.g. the enacted-law badge. */
  pageBadge?: React.ReactNode;
  /** Longer title shown after the label (truncates on narrow screens). */
  pageTitle?: string;
  /** Extra controls rendered before the theme toggle. */
  actions?: React.ReactNode;
  /** Span the full viewport width instead of the centered content column. */
  fullWidth?: boolean;
}

export const SiteHeader: React.FC<SiteHeaderProps> = ({
  nav = [],
  navGroup,
  crumbs = [],
  pageLabel,
  pageBadge,
  pageTitle,
  actions,
  fullWidth = false,
}) => {
  const { theme, toggleTheme } = useTheme();
  const hasPage = Boolean(nav.length || crumbs.length || pageLabel || pageTitle);
  // On phones: drop the site name, and on bill pages (which have a title)
  // also the crumb trail, so the logo + most specific item always fit.
  const hideCrumbsSm = Boolean(pageTitle);
  const themeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <header className={`rc-header${fullWidth ? " rc-header--full" : ""}`}>
      <div className="rc-header-inner">
        <div className="rc-header-left">
          <Link to="/" className="rc-brand" aria-label={SITE_NAME}>
            <CapitolMark className="rc-brand-mark" />
            {/* The name itself is redlined: "Redline" struck out, "Congress" inserted.
                Colors follow the visitor's diff style (see .rc-brand-* in app.css). */}
            <span
              className={hasPage ? "rc-brand-name rc-hide-sm" : "rc-brand-name"}
              aria-hidden="true"
            >
              <span className="rc-brand-del">Redline</span>
              <span className="rc-brand-ins">Congress</span>
              .org
            </span>
          </Link>

          {(nav.length > 0 || navGroup) && (
            <nav className="rc-header-nav" aria-label="Site">
              {nav.map((item) => (
                <Link key={item.to} to={item.to} state={item.state} className="rc-header-crumb">
                  {item.label}
                  {item.labelSuffix && <span className="rc-hide-sm">{item.labelSuffix}</span>}
                </Link>
              ))}
              {navGroup && (
                // Phones: the group is dropped; the feed links fit, all of it doesn't.
                <span className="rc-header-nav-group rc-hide-sm">
                  <span className="rc-header-nav-label">{navGroup.label}</span>
                  {navGroup.items.map((item) => (
                    <Link key={item.to} to={item.to} state={item.state} className="rc-header-crumb">
                      {item.label}
                    </Link>
                  ))}
                </span>
              )}
            </nav>
          )}

          {crumbs.map((crumb, i) => (
            <React.Fragment key={crumb.to}>
              <span
                className={`rc-header-sep${i === 0 || hideCrumbsSm ? " rc-hide-sm" : ""}`}
                aria-hidden="true"
              >
                /
              </span>
              <Link
                to={crumb.to}
                className={`rc-header-crumb${hideCrumbsSm ? " rc-hide-sm" : ""}`}
              >
                {crumb.label}
              </Link>
            </React.Fragment>
          ))}

          {(pageLabel || pageTitle) && (
            <>
              <span
                className={`rc-header-sep${crumbs.length === 0 || hideCrumbsSm ? " rc-hide-sm" : ""}`}
                aria-hidden="true"
              >
                /
              </span>
              {pageLabel && (
                <span className="rc-header-page-label">{pageLabel}</span>
              )}
              {pageBadge}
              {pageTitle && (
                <span className="rc-header-page-title" title={pageTitle}>
                  {pageTitle}
                </span>
              )}
            </>
          )}
        </div>

        <div className="rc-header-actions">
          {actions}
          <button
            type="button"
            className="rc-icon-btn"
            onClick={toggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rc-btn rc-btn-secondary rc-btn-sm rc-github-btn"
            title="Source code on GitHub"
          >
            <Github size={14} />
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
};
