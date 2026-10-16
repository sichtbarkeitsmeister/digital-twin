/**
 * Tab title on logged-in pages: which organisation, and the format.
 * Run: npx tsx scripts/test-organisation-document-title.ts
 */
import assert from "node:assert/strict";

import {
  APP_DOCUMENT_TITLE,
  organisationDocumentTitle,
  organisationIdFromPath,
  resolveOrganisationDocumentTitle,
  resolveTitleOrganisation,
} from "../lib/shared/organisation-document-title";
import type { OrganisationOption } from "../lib/shared/organisation-option";

const SBKM: OrganisationOption = { id: "org-sbkm", name: "Sichtbarkeitsmeister GmbH", displayName: "Sichtbarkeitsmeister" };
const ITP: OrganisationOption = { id: "org-itp", name: "IT Problemlöser" };
const ARCTIC: OrganisationOption = { id: "org-arctic", name: "ArcticTub GmbH", displayName: "  ArcticTub  " };
const ALL = [SBKM, ITP, ARCTIC];

function testFormat() {
  assert.equal(organisationDocumentTitle(SBKM), "Sichtbarkeitsmeister · DigitalTwin");
  assert.equal(organisationDocumentTitle(ITP), "IT Problemlöser · DigitalTwin");
  // displayName before name, trimmed; empty displayName falls back to name.
  assert.equal(organisationDocumentTitle(ARCTIC), "ArcticTub · DigitalTwin");
  assert.equal(organisationDocumentTitle({ id: "x", name: "Name GmbH", displayName: "   " }), "Name GmbH · DigitalTwin");
  // No organisation, or no label at all.
  assert.equal(organisationDocumentTitle(null), "DigitalTwin");
  assert.equal(organisationDocumentTitle(undefined), APP_DOCUMENT_TITLE);
  assert.equal(organisationDocumentTitle({ id: "x", name: "  " }), "DigitalTwin");
  console.log("format: ok");
}

function testPathParam() {
  assert.equal(organisationIdFromPath("/dashboard/organisations/org-itp"), "org-itp");
  assert.equal(organisationIdFromPath("/dashboard/organisations/org-itp/members"), "org-itp");
  assert.equal(organisationIdFromPath("/dashboard/organisations"), null);
  assert.equal(organisationIdFromPath("/dashboard/organisations/"), null);
  assert.equal(organisationIdFromPath("/dashboard/verwaltung/texte"), null);
  assert.equal(organisationIdFromPath(null), null);
  console.log("path param: ok");
}

function testOrder() {
  // path param > URL > stored > first
  const all = {
    organisations: ALL,
    pathname: "/dashboard/organisations/org-arctic",
    urlOrganisationId: "org-itp",
    storedOrganisationId: "org-sbkm",
  };
  assert.equal(resolveTitleOrganisation(all)?.id, "org-arctic");
  assert.equal(resolveTitleOrganisation({ ...all, pathname: "/dashboard/verwaltung/texte" })?.id, "org-itp");
  assert.equal(resolveTitleOrganisation({ ...all, pathname: "/", urlOrganisationId: null })?.id, "org-sbkm");
  assert.equal(
    resolveTitleOrganisation({ organisations: ALL, pathname: "/settings", urlOrganisationId: null, storedOrganisationId: null })?.id,
    "org-sbkm",
  );
  // The user's only organisation.
  assert.equal(resolveOrganisationDocumentTitle({ organisations: [ITP], pathname: "/dashboard/inbox" }), "IT Problemlöser · DigitalTwin");

  // Two tabs: each URL wins over the shared stored choice.
  const stored = "org-sbkm";
  assert.equal(resolveOrganisationDocumentTitle({ organisations: ALL, urlOrganisationId: "org-itp", storedOrganisationId: stored }), "IT Problemlöser · DigitalTwin");
  assert.equal(resolveOrganisationDocumentTitle({ organisations: ALL, urlOrganisationId: "org-arctic", storedOrganisationId: stored }), "ArcticTub · DigitalTwin");
  console.log("order: ok");
}

function testUnknownIds() {
  // An id the user may not access is ignored at every level; the next source counts.
  assert.equal(
    resolveTitleOrganisation({
      organisations: ALL,
      pathname: "/dashboard/organisations/org-foreign",
      urlOrganisationId: "org-itp",
      storedOrganisationId: "org-sbkm",
    })?.id,
    "org-itp",
  );
  assert.equal(
    resolveTitleOrganisation({ organisations: ALL, urlOrganisationId: "org-foreign", storedOrganisationId: "org-arctic" })?.id,
    "org-arctic",
  );
  assert.equal(
    resolveTitleOrganisation({ organisations: ALL, urlOrganisationId: "org-foreign", storedOrganisationId: "org-gone" })?.id,
    "org-sbkm",
  );
  assert.equal(resolveTitleOrganisation({ organisations: ALL, urlOrganisationId: "  ", storedOrganisationId: "" })?.id, "org-sbkm");
  console.log("unknown ids: ok");
}

function testNoOrganisation() {
  // Logged in without an organisation, or the names are not loaded yet.
  assert.equal(resolveOrganisationDocumentTitle({ organisations: [] }), "DigitalTwin");
  assert.equal(
    resolveOrganisationDocumentTitle({ organisations: [], pathname: "/dashboard/organisations/org-itp", urlOrganisationId: "org-itp", storedOrganisationId: "org-itp" }),
    "DigitalTwin",
  );
  console.log("no organisation: ok");
}

testFormat();
testPathParam();
testOrder();
testUnknownIds();
testNoOrganisation();
console.log("organisation document title: all ok");
