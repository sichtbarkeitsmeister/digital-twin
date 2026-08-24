"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { grantPlatformAdminRole } from "@/lib/dashboard/grant-platform-admin";
import { isPlatformAdmin } from "@/lib/dt/org-access";
import { createClient } from "@/lib/supabase/server";

export type PlatformAdminRoleActionState = {
  ok: boolean;
  message: string;
  inviteLink?: string | null;
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
  intent: z.enum(["grant", "reinvite", "revoke"]).default("grant"),
});

export async function setPlatformAdminRoleAction(
  _prev: PlatformAdminRoleActionState,
  formData: FormData,
): Promise<PlatformAdminRoleActionState> {
  const parsed = setRoleSchema.safeParse({
    email: formData.get("email"),
    make_admin: formData.get("make_admin"),
    intent: formData.get("intent") || "grant",
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return { ok: false, message: "Bitte erneut anmelden." };
  }
  if (!(await isPlatformAdmin(supabase, user.id))) {
    return { ok: false, message: "Keine Berechtigung: Plattform-Rollen dürfen nur Admins ändern." };
  }

  try {
    const result = await grantPlatformAdminRole({
      email: parsed.data.email,
      makeAdmin: parsed.data.intent === "revoke" ? false : parsed.data.make_admin,
      actorUserId: user.id,
      reinvite: parsed.data.intent === "reinvite",
    });

    if (result.ok) {
      revalidatePath("/dashboard/admin/organisations");
      revalidatePath("/dashboard/admin/team");
      revalidatePath("/dashboard");
    }

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.warn("[admin] grantPlatformAdminRole failed:", msg || err);
    if (msg.includes("SUPABASE_SERVICE_ROLE_KEY") || msg.includes("NEXT_PUBLIC_SUPABASE_URL")) {
      return {
        ok: false,
        message: "Server-Konfiguration unvollständig (Supabase Service Role).",
      };
    }
    if (msg && msg.length < 180 && !msg.includes("\n")) {
      return { ok: false, message: msg };
    }
    return { ok: false, message: "Rolle konnte nicht geändert werden. Bitte später erneut versuchen." };
  }
}
