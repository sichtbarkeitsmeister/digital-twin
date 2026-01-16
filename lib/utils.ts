import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getSupabasePublicKey, getSupabaseUrl } from "./supabase/env";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// This check can be removed, it is just for tutorial purposes
export const hasEnvVars =
  getSupabaseUrl() && getSupabasePublicKey();
