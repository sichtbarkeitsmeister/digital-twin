"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type PlatformAdminRoleActionState = {
  ok: boolean;
  message: string;
};

const setRoleSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Bitte eine gültige E-Mail-Adresse eingeben"),
  make_admin: z.preprocess(
    (v) => v === "true" || v === "on" || v === true,
    z.boolean(),
  ),
});

function mapSetPlatformAdminRoleError(error: {
  message?: string;
  details?: string;
  hint?: string;
}): string {
  const raw = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();

  if (raw.includes("not_authenticated")) {
    return "Bitte erneut anmelden.";
  }
  if (raw.includes("forbidden")) {
    return "Keine Berechtigung: Plattform-Rollen dürfen nur Admins ändern.";
  }
  if (raw.includes("invalid_email")) {
    return "Bitte eine gültige E-Mail-Adresse eingeben.";
  }
  if (raw.includes("user_not_found")) {
    return "Kein Konto mit dieser E-Mail gefunden. Die Person muss sich zuerst anmelden.";
  }
  if (raw.includes("last_admin")) {
    return "Der letzte Plattform-Admin kann nicht entfernt werden.";
  }
  if (
    raw.includes("could not find the function") ||
    raw.includes("schema cache") ||
    (raw.includes("function") && raw.includes("does not exist"))
  ) {
    return "Datenbank-Funktion fehlt. Bitte Migration 20260820_sbkm_staff_platform_admin.sql in Supabase ausführen.";
  }

  const short = (error.message ?? "").trim();
  if (short && short.length < 180 && !short.includes("\n")) {
    return `Rolle konnte nicht geändert werden: ${short}`;
  }
  return "Rolle konnte nicht geändert werden. Bitte später erneut versuchen.";
}

export async function setPlatformAdminRoleAction(
  _prev: PlatformAdminRoleActionState,
  formData: FormData,
): Promise<PlatformAdminRoleActionState> {
  const parsed = setRoleSchema.safeParse({
    email: formData.get("email"),
    make_admin: formData.get("make_admin"),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_platform_admin_role", {
    target_email: parsed.data.email,
    make_admin: parsed.data.make_admin,
  });

  if (error) {
    console.warn("[admin] set_platform_admin_role failed:", error.message, error.details);
    return { ok: false, message: mapSetPlatformAdminRoleError(error) };
  }

  revalidatePath("/dashboard/admin/organisations");
  revalidatePath("/dashboard/admin/team");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: parsed.data.make_admin
      ? `${parsed.data.email} hat jetzt die Admin-Ansicht (Verwaltung, SEO Modus). Nach einem Reload ist sie sichtbar.`
      : `${parsed.data.email} ist wieder ein normales Konto.`,
  };
}
