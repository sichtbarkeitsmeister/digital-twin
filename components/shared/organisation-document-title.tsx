"use client";

/**
 * Sets the browser tab title on logged-in pages to „{Organisation} · DigitalTwin“
 * (`lib/shared/organisation-document-title.ts` decides which organisation). Mounted once by
 * the dashboard shell, the chat home and the settings layout; public pages keep the title of
 * `app/layout.tsx`.
 *
 * The organisation list comes from `/api/dt/organisations/mine`, once per page load and again
 * when an id shows up that is not in it; a renamed organisation shows its new name after the
 * next page load. Next.js re-renders the metadata `<title>` on client navigation, so a
 * MutationObserver on `<head>` puts this title back whenever something else writes one.
 */

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  APP_DOCUMENT_TITLE,
  organisationTitleCandidates,
  resolveOrganisationDocumentTitle,
} from "@/lib/shared/organisation-document-title";
import type { OrganisationOption } from "@/lib/shared/organisation-option";
import {
  readSelectedOrganisationId,
  SELECTED_ORGANISATION_CHANGED_EVENT,
  type SelectedOrganisationChangedDetail,
} from "@/lib/shared/selected-organisation-storage";

// --- organisation list, kept for the page load -------------------------------------------

let cachedOrganisations: OrganisationOption[] | null = null;
let pendingLoad: Promise<OrganisationOption[] | null> | null = null;
/** Ids already looked up again after they were missing from the list. */
const refetchedIds = new Set<string>();

function loadOrganisations(force = false): Promise<OrganisationOption[] | null> {
  if (!force && cachedOrganisations) return Promise.resolve(cachedOrganisations);
  if (pendingLoad) return pendingLoad;
  pendingLoad = (async () => {
    try {
      const res = await fetch("/api/dt/organisations/mine", { cache: "no-store" });
      if (res.status === 401) {
        // Not logged in (any more): no names, and nothing of the last user kept.
        cachedOrganisations = null;
        return null;
      }
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        organisations?: OrganisationOption[];
      } | null;
      if (!res.ok || !json?.ok || !Array.isArray(json.organisations)) return cachedOrganisations;
      cachedOrganisations = json.organisations.map((organisation) => ({
        id: organisation.id,
        name: organisation.name,
        displayName: organisation.displayName ?? null,
      }));
      return cachedOrganisations;
    } catch {
      return cachedOrganisations;
    } finally {
      pendingLoad = null;
    }
  })();
  return pendingLoad;
}

/** Forget the list (sign-out), so the next user never sees the last user's names. */
export function forgetOrganisationDocumentTitleCache() {
  cachedOrganisations = null;
  refetchedIds.clear();
}

// --- the <title> keeper --------------------------------------------------------------------

let mountedKeepers = 0;
let wantedTitle: string | null = null;
/** The title of `app/layout.tsx` metadata, restored when the last logged-in tree unmounts. */
let metadataTitle: string | null = null;
let observer: MutationObserver | null = null;

function applyWantedTitle() {
  if (wantedTitle != null && document.title !== wantedTitle) document.title = wantedTitle;
}

function startKeeper() {
  mountedKeepers += 1;
  if (mountedKeepers > 1) return;
  if (metadataTitle == null) metadataTitle = document.title;
  observer = new MutationObserver(() => {
    if (wantedTitle != null && document.title !== wantedTitle) {
      // Next writes its metadata title during navigation; ours wins right after.
      applyWantedTitle();
      requestAnimationFrame(applyWantedTitle);
    }
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function stopKeeper() {
  mountedKeepers = Math.max(0, mountedKeepers - 1);
  if (mountedKeepers > 0) return;
  observer?.disconnect();
  observer = null;
  const ours = wantedTitle;
  wantedTitle = null;
  if (metadataTitle != null && ours != null && document.title === ours) document.title = metadataTitle;
}

function setWantedTitle(title: string) {
  wantedTitle = title;
  applyWantedTitle();
  // A metadata write later in the same navigation is caught by the observer; this covers a
  // write that lands without touching <head> children (e.g. the same node re-filled).
  requestAnimationFrame(applyWantedTitle);
}

// --- component -----------------------------------------------------------------------------

function OrganisationDocumentTitleInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlOrganisationId = searchParams.get("org");
  const [organisations, setOrganisations] = useState<OrganisationOption[] | null>(cachedOrganisations);
  /**
   * A switch in this tab (top bar, Texte, chat) with the URL it was made on. The selectors
   * write the selection first and the URL after, the chat even with history.replaceState,
   * which `useSearchParams` does not always report. Until the path or `?org=` changes, this
   * choice stands for the URL's organisation.
   */
  const [selection, setSelection] = useState<{ id: string | null; pathname: string; org: string | null } | null>(null);
  const current = useRef({ pathname, org: urlOrganisationId });
  current.current = { pathname, org: urlOrganisationId };

  useEffect(() => {
    startKeeper();
    return stopKeeper;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadOrganisations().then((list) => {
      if (!cancelled) setOrganisations(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onSelectionChanged(event: Event) {
      const detail = (event as CustomEvent<SelectedOrganisationChangedDetail>).detail;
      setSelection({ id: detail?.organisationId ?? null, ...current.current });
    }
    window.addEventListener(SELECTED_ORGANISATION_CHANGED_EVENT, onSelectionChanged);
    return () => window.removeEventListener(SELECTED_ORGANISATION_CHANGED_EVENT, onSelectionChanged);
  }, []);

  useEffect(() => {
    const freshSelection =
      selection && selection.pathname === pathname && selection.org === urlOrganisationId ? selection.id : null;
    // window.location is current even when the URL was changed with history.replaceState.
    const liveOrg = new URLSearchParams(window.location.search).get("org");
    const sources = {
      pathname: window.location.pathname || pathname,
      urlOrganisationId: freshSelection ?? liveOrg ?? urlOrganisationId,
      storedOrganisationId: readSelectedOrganisationId(),
    };
    const list = organisations ?? [];
    setWantedTitle(organisations ? resolveOrganisationDocumentTitle({ ...sources, organisations: list }) : APP_DOCUMENT_TITLE);

    // An id the list does not know (a new organisation, a fresh membership): look once more.
    if (!organisations) return;
    const known = new Set(list.map((organisation) => organisation.id));
    const missing = organisationTitleCandidates(sources).find((id) => !known.has(id) && !refetchedIds.has(id));
    if (!missing) return;
    refetchedIds.add(missing);
    let cancelled = false;
    void loadOrganisations(true).then((fresh) => {
      if (!cancelled && fresh) setOrganisations(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, [organisations, pathname, searchParams, urlOrganisationId, selection]);

  return null;
}

export function OrganisationDocumentTitle() {
  return (
    <Suspense fallback={null}>
      <OrganisationDocumentTitleInner />
    </Suspense>
  );
}
