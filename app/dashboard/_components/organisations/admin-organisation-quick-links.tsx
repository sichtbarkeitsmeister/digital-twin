"use client";

import Link from "next/link";
import { Bot, ClipboardPenLine, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const links = [
  {
    href: "/dashboard/admin/digital-twin",
    title: "DigitalTwin Admin",
    description: "Twin-Status, SEO-Flags und Agenten pro Organisation.",
    icon: Bot,
    cta: "Übersicht",
  },
  {
    href: "/dashboard/surveys",
    title: "Umfragen",
    description: "Entwürfe erstellen, veröffentlichen und Antworten ansehen.",
    icon: ClipboardPenLine,
    cta: "Öffnen",
  },
  {
    href: "/dashboard/admin/jobs",
    title: "Jobs runner",
    description: "Geplante Jobs und Hintergrund-Aufgaben überwachen.",
    icon: Workflow,
    cta: "Jobs",
  },
] as const;

export function AdminOrganisationQuickLinks() {
  return (
    <div className="grid gap-3">
      {links.map((link) => (
        <Card
          key={link.href}
          className="overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)] transition-colors duration-150 hover:bg-muted/15"
        >
          <CardHeader className="pb-2">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <link.icon className="size-4" aria-hidden />
              </div>
              <div className="min-w-0 grid gap-0.5">
                <CardTitle className="text-base tracking-tight">
                  {link.title}
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  {link.description}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Button
              asChild
              size="sm"
              variant="outline"
              className="transition-transform duration-150 active:scale-[0.98]"
            >
              <Link href={link.href}>{link.cta}</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
