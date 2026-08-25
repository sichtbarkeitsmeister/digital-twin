"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { suggestFragebogenAudienceVocabAction } from "@/app/dashboard/frageboegen/actions";
import {
  CLIENT_AUDIENCE_OPTIONS,
  GENDER_SELECT_OPTIONS,
  audienceWordingPreview,
  type ClientAudienceKind,
  type ClientAudienceVocab,
  type NounGender,
} from "@/lib/surveys/client-audience";
import { heuristicSuggestAudienceVocab } from "@/lib/surveys/suggest-audience-vocab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PRIMARY_KINDS: ClientAudienceKind[] = ["kanzlei", "praxis"];
const SECONDARY_KINDS: ClientAudienceKind[] = ["handwerk", "unternehmen"];

export function FragebogenAudienceVocabEditor(props: {
  kind: ClientAudienceKind | null;
  vocab: ClientAudienceVocab | null;
  organisationName?: string | null;
  services?: string[];
  onSelectKind: (kind: ClientAudienceKind) => void;
  onChangeVocab: (patch: Partial<ClientAudienceVocab>) => void;
  onApplyVocab: (vocab: ClientAudienceVocab) => void;
}) {
  const vocab = props.vocab;
  const [industry, setIndustry] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const lastHeuristicKey = useRef("");
  const onApplyVocabRef = useRef(props.onApplyVocab);
  onApplyVocabRef.current = props.onApplyVocab;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const trimmed = industry.trim();
      if (trimmed.length < 3) return;
      if (trimmed === lastHeuristicKey.current) return;
      const suggestion = heuristicSuggestAudienceVocab({
        industry: trimmed,
      });
      if (!suggestion) return;
      lastHeuristicKey.current = trimmed;
      onApplyVocabRef.current(suggestion.vocab);
      setSuggestNote(suggestion.note);
      setSuggestError(null);
    }, 280);
    return () => window.clearTimeout(handle);
  }, [industry]);

  async function runAiSuggest() {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await suggestFragebogenAudienceVocabAction({
        industry,
        organisationName: props.organisationName,
        services: props.services,
      });
      if (!res.ok || !res.data) {
        setSuggestError(res.message);
        return;
      }
      lastHeuristicKey.current = industry.trim();
      props.onApplyVocab(res.data.vocab);
      setSuggestNote(res.data.note);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {CLIENT_AUDIENCE_OPTIONS.filter((option) => PRIMARY_KINDS.includes(option.kind)).map(
          (option) => (
            <ShortcutButton
              key={option.kind}
              option={option}
              selected={props.kind === option.kind}
              onSelect={() => {
                props.onSelectKind(option.kind);
                setSuggestNote(null);
                setSuggestError(null);
              }}
            />
          ),
        )}
      </div>

      <div className="grid gap-2 rounded-xl border border-sbkm-navy/10 bg-sbkm-navy/[0.03] p-3">
        <Label htmlFor="fragebogen-branche">Andere Branche</Label>
        <p className="text-xs text-secondary">
          z. B. Entrümpler, Umzugsunternehmen, Dachdecker. Die Felder füllen sich beim Tippen —
          KI kann nachschärfen.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="fragebogen-branche"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runAiSuggest();
              }
            }}
            placeholder="Branche eingeben…"
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void runAiSuggest()}
            disabled={suggesting}
            className="shrink-0"
          >
            {suggesting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            KI vorschlagen
          </Button>
        </div>
        {suggestNote ? <p className="text-xs text-secondary">{suggestNote}</p> : null}
        {suggestError ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">{suggestError}</p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {CLIENT_AUDIENCE_OPTIONS.filter((option) => SECONDARY_KINDS.includes(option.kind)).map(
            (option) => (
              <ShortcutButton
                key={option.kind}
                option={option}
                selected={props.kind === option.kind}
                compact
                onSelect={() => {
                  props.onSelectKind(option.kind);
                  setSuggestNote(null);
                  setSuggestError(null);
                }}
              />
            ),
          )}
        </div>
      </div>

      {!vocab ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Bitte Kanzlei oder Praxis wählen, eine Branche eintippen oder KI vorschlagen lassen,
          bevor der Fragebogen erzeugt wird. Die Wörter darunter kannst du danach noch anpassen.
        </p>
      ) : (
        <div className="grid gap-3 rounded-xl border border-sbkm-navy/10 bg-sbkm-navy/[0.03] p-3">
          <p className="text-xs text-secondary">
            Diese Wörter stehen in Fragen, Beschreibungen und Beispielen. Vorgaben aus der
            Branche — vor dem Erzeugen frei editierbar.
          </p>
          <VocabRow
            title="Über den Anbieter wird gesagt"
            singular={vocab.business}
            plural={vocab.businessPlural}
            gender={vocab.businessGender}
            singularLabel="Einzahl"
            pluralLabel="Mehrzahl"
            onSingular={(business) => props.onChangeVocab({ business })}
            onPlural={(businessPlural) => props.onChangeVocab({ businessPlural })}
            onGender={(businessGender) => props.onChangeVocab({ businessGender })}
          />
          <VocabRow
            title="Über den Kunden wird gesagt"
            singular={vocab.singular}
            plural={vocab.plural}
            gender="m"
            singularLabel="Einzahl"
            pluralLabel="Mehrzahl"
            hideGender
            onSingular={(singular) => props.onChangeVocab({ singular })}
            onPlural={(plural) => props.onChangeVocab({ plural })}
            onGender={() => undefined}
          />
          <VocabRow
            title="Über die Arbeit wird gesagt"
            singular={vocab.engagement}
            plural={vocab.engagementPlural}
            gender={vocab.engagementGender}
            singularLabel="Einzahl"
            pluralLabel="Mehrzahl"
            onSingular={(engagement) => props.onChangeVocab({ engagement })}
            onPlural={(engagementPlural) => props.onChangeVocab({ engagementPlural })}
            onGender={(engagementGender) => props.onChangeVocab({ engagementGender })}
          />
          <p className="rounded-lg border border-sbkm-navy/10 bg-background px-3 py-2 text-xs text-secondary">
            <span className="font-medium text-primary">Beispiel: </span>
            {audienceWordingPreview(vocab)}
          </p>
        </div>
      )}
    </div>
  );
}

function ShortcutButton(props: {
  option: (typeof CLIENT_AUDIENCE_OPTIONS)[number];
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "rounded-xl border text-left transition",
        props.compact ? "px-3 py-2 text-xs" : "px-3 py-3 text-sm",
        props.selected
          ? "border-sbkm-mint/50 bg-sbkm-mint/15 text-primary"
          : "border-sbkm-navy/10 hover:bg-sbkm-navy/5",
      )}
    >
      <span className="block font-semibold">{props.option.label}</span>
      <span className="mt-1 block text-xs text-secondary">{props.option.hint}</span>
    </button>
  );
}

function VocabRow(props: {
  title: string;
  singular: string;
  plural: string;
  gender: NounGender;
  singularLabel: string;
  pluralLabel: string;
  hideGender?: boolean;
  onSingular: (value: string) => void;
  onPlural: (value: string) => void;
  onGender: (value: NounGender) => void;
}) {
  const id = props.title.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{props.title}</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-singular`} className="text-xs text-secondary">
            {props.singularLabel}
          </Label>
          <Input
            id={`${id}-singular`}
            value={props.singular}
            onChange={(e) => props.onSingular(e.target.value)}
            placeholder="z. B. Praxis"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-plural`} className="text-xs text-secondary">
            {props.pluralLabel}
          </Label>
          <Input
            id={`${id}-plural`}
            value={props.plural}
            onChange={(e) => props.onPlural(e.target.value)}
            placeholder="z. B. Praxen"
          />
        </div>
        {props.hideGender ? (
          <div className="hidden sm:block" />
        ) : (
          <div className="grid gap-1">
            <Label htmlFor={`${id}-gender`} className="text-xs text-secondary">
              Artikel
            </Label>
            <Select
              id={`${id}-gender`}
              value={props.gender}
              onChange={(e) => props.onGender(e.target.value as NounGender)}
            >
              {GENDER_SELECT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
