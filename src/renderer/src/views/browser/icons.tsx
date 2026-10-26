import { useEffect, useMemo, useState } from "react";
import type { PinnedSite } from "../../../../shared/types";
import { highlightMatches } from "../../../../shared/omnibox-fill";
import {
  toQuickLinkSite,
  type QuickLinkSite,
} from "../../../../shared/quick-links";
import { useDownloadsProgress } from "../toolbar/useToolbarLayout";
import { historyHost, httpOrigin } from "./chrome-helpers";

export function NewTabSiteIcon({
  site,
  faviconUrl,
  showLabel,
  iconSize,
  onOpen,
}: {
  site: QuickLinkSite;
  faviconUrl?: string | null;
  showLabel: boolean;
  iconSize: number;
  onOpen: () => void;
}): React.JSX.Element {
  const fallbackFaviconUrl = `${site.origin}/favicon.ico`;
  const preferredFaviconUrl =
    faviconUrl ?? site.faviconUrl ?? fallbackFaviconUrl;
  const [iconFailed, setIconFailed] = useState(false);
  const [iconSource, setIconSource] = useState(preferredFaviconUrl);
  useEffect(() => {
    setIconFailed(false);
    setIconSource(preferredFaviconUrl);
  }, [preferredFaviconUrl]);
  const hostname = new URL(site.origin).hostname.replace(/^www\./i, "");
  return (
    <button
      className={`new-tab-icon-tile${showLabel ? " has-label" : ""}`}
      style={{ width: iconSize, minHeight: iconSize }}
      type="button"
      onClick={onOpen}
      title={`Open ${site.title} · ${site.origin}`}
      aria-label={`Open ${site.title}, ${hostname}`}
    >
      <span className="new-tab-site-icon" aria-hidden="true">
        {!iconFailed && (
          <img
            src={iconSource}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              const nextSource =
                iconSource === faviconUrl
                  ? (site.faviconUrl ?? fallbackFaviconUrl)
                  : fallbackFaviconUrl;
              if (nextSource && iconSource !== nextSource)
                setIconSource(nextSource);
              else setIconFailed(true);
            }}
          />
        )}
        {iconFailed && (
          <span>
            {site.title.trim().slice(0, 1).toUpperCase() ||
              hostname.slice(0, 1).toUpperCase() ||
              "↗"}
          </span>
        )}
      </span>
      {showLabel && <span className="new-tab-link-label">{site.title}</span>}
    </button>
  );
}

export function PinnedSiteIcon({
  site,
  cachedFaviconUrl,
  onOpen,
  onUnpin,
  dragProps,
}: {
  site: PinnedSite;
  cachedFaviconUrl?: string | null;
  onOpen: () => void;
  onUnpin: () => void;
  dragProps?: React.ButtonHTMLAttributes<HTMLButtonElement> &
    Record<`data-${string}`, string>;
}): React.JSX.Element {
  const quickLink = toQuickLinkSite(site);
  const fallbackFaviconUrl = quickLink
    ? `${quickLink.origin}/favicon.ico`
    : null;
  const preferredFaviconUrl = quickLink
    ? (cachedFaviconUrl ?? site.faviconUrl ?? fallbackFaviconUrl)
    : null;
  const [iconFailed, setIconFailed] = useState(false);
  const [iconSource, setIconSource] = useState(preferredFaviconUrl);
  useEffect(() => {
    setIconFailed(false);
    setIconSource(preferredFaviconUrl);
  }, [preferredFaviconUrl]);
  const hostname = quickLink
    ? new URL(quickLink.origin).hostname.replace(/^www\./i, "")
    : historyHost(site.url);
  return (
    <button
      {...dragProps}
      className="pinned-site-icon-button"
      type="button"
      title={`${site.title} · ${hostname} (right-click to remove bookmark)`}
      aria-label={`Open bookmark ${site.title}`}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onUnpin();
      }}
    >
      <span className="pinned-site-mark" aria-hidden="true">
        {quickLink && iconSource && !iconFailed && (
          <img
            src={iconSource}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              const nextSource =
                iconSource === cachedFaviconUrl
                  ? (site.faviconUrl ?? fallbackFaviconUrl)
                  : fallbackFaviconUrl;
              if (nextSource && iconSource !== nextSource)
                setIconSource(nextSource);
              else setIconFailed(true);
            }}
          />
        )}
        {(!quickLink || iconFailed) && (
          <span>
            {site.title.trim().slice(0, 1).toUpperCase() ||
              hostname.slice(0, 1).toUpperCase() ||
              "↗"}
          </span>
        )}
      </span>
    </button>
  );
}

/** Text with each occurrence of the typed query marked (suggestion titles). */
export function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.JSX.Element {
  return (
    <>
      {highlightMatches(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="suggestion-match">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function SuggestionFavicon({
  url,
  title,
  faviconUrl,
}: {
  url: string;
  title: string;
  faviconUrl?: string | null;
}): React.JSX.Element {
  const origin = httpOrigin(url);
  const candidates = useMemo(
    () => [
      ...new Set(
        [faviconUrl, origin ? `${origin}/favicon.ico` : null].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ],
    [faviconUrl, origin],
  );
  const [candidateIndex, setCandidateIndex] = useState(0);
  useEffect(() => setCandidateIndex(0), [candidates]);
  const source = candidates[candidateIndex];
  const host = origin ? new URL(origin).hostname.replace(/^www\./i, "") : "";
  const letter =
    title.trim().slice(0, 1).toUpperCase() ||
    host.slice(0, 1).toUpperCase() ||
    "↗";
  return source ? (
    <img
      src={source}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setCandidateIndex((index) => index + 1)}
    />
  ) : (
    <span>{letter}</span>
  );
}

/** Thin progress line on the Downloads button; its own component so progress never re-renders the shell. */
export function DownloadsToolbarProgress(): React.JSX.Element {
  const progress = useDownloadsProgress(true);
  return (
    <span
      className={`downloads-toolbar-progress${progress === null ? " is-indeterminate" : ""}`}
      aria-hidden="true"
    >
      <span
        style={
          progress === null ? undefined : { transform: `scaleX(${progress})` }
        }
      />
    </span>
  );
}
