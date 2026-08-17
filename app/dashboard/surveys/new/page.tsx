import { redirect } from "next/navigation";

/**
 * Leerer Survey-Builder als Einstieg entfällt.
 * Neue Umfragen starten über den Org-/Meeting-Wizard.
 */
export default function NewSurveyPage() {
  redirect("/dashboard/frageboegen/neu");
}
