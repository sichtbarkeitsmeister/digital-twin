"use client";

import {
  CLIENT_AUDIENCE_OPTIONS,
  GENDER_SELECT_OPTIONS,
  audienceWordingPreview,
  type ClientAudienceKind,
  type ClientAudienceVocab,
  type NounGender,
} from "@/lib/surveys/client-audience";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FragebogenAudienceVocabEditor(props: {
  kind: ClientAudienceKind | null;
  vocab: ClientAudienceVocab | null;
  onSelectKind: (kind: ClientAudienceKind) => void;
  onChangeVocab: (patch: Partial<ClientAudienceVocab>) => void;
}) {
  const vocab = props.vocab;

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {CLIENT_AUDIENCE_OPTIONS.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => props.onSelectKind(option.kind)}
            className={cn(
              "rounded-xl border px-3 py-3 text-left text-sm transition",
              props.kind === option.kind
                ? "border-sbkm-mint/50 bg-sbkm-mint/15 text-primary"
                : "border-sbkm-navy/10 hover:bg-sbkm-navy/5",
            )}
          >
            <span className="block font-semibold">{option.label}</span>
            <span className="mt-1 block text-xs text-secondary">{option.hint}</span>
          </button>
        ))}
      </div>

      {!vocab ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Bitte eine Art wählen, bevor der Fragebogen erzeugt wird. Die Wörter darunter kannst du
          danach noch anpassen.
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
