import type { SurveyFact } from "@/lib/dt/survey-facts";

export type SurveyExamAudience = "persona" | "company";

export type SurveyExamQuestion = {
  id: string;
  /** Question the tester sends to the twin (as the interviewer). */
  question: string;
  /** Short expected content from the questionnaire — for the tester only. */
  expectedHint: string;
  factId: string;
  kind: SurveyFact["kind"];
};

/** Soft openers last. Tone: company employee talking to a prospect. */
const PERSONA_OPENING_QUESTION =
  "Was beschäftigt dich gerade am meisten, und worüber würdest du mit uns zuerst sprechen wollen?";

/** Display name for company/SEO exam probes (3rd party about the org). */
export function companyExamOrganisationLabel(
  organisationName?: string | null,
): string {
  const n = String(organisationName ?? "").trim();
  return n || "das Unternehmen";
}

/**
 * SEO-Advisor / Firmen-Test: never address the agent as if they work at the org
 * (“ihr/euch”). Always refer to the organisation by name.
 */
export function rewriteCompanyAddressingToOrgName(
  text: string,
  organisationName?: string | null,
): string {
  const org = companyExamOrganisationLabel(organisationName);
  let t = withoutEmDashes(String(text ?? ""));

  t = t.replace(/\baus eurem Wissen\b/gi, `zu ${org}`);
  t = t.replace(/\bbei euch\b/gi, `bei ${org}`);
  t = t.replace(/\bzu euch\b/gi, `zu ${org}`);
  t = t.replace(/\bmit euch\b/gi, `mit ${org}`);
  t = t.replace(/\bvon euch\b/gi, `von ${org}`);
  t = t.replace(/\bfür euch\b/gi, `für ${org}`);
  t = t.replace(/\ban euch\b/gi, `an ${org}`);
  t = t.replace(/\beuch\b/gi, org);

  t = t.replace(/\bseid ihr\b/gi, `ist ${org}`);
  t = t.replace(/\bhabt ihr\b/gi, `hat ${org}`);
  t = t.replace(/\bmacht ihr\b/gi, `macht ${org}`);
  t = t.replace(/\bietet ihr\b/gi, `bietet ${org}`);
  t = t.replace(/\barbeitet ihr\b/gi, `arbeitet ${org}`);
  t = t.replace(/\bsteht ihr\b/gi, `steht ${org}`);
  t = t.replace(/\bkommt ihr\b/gi, `kommt ${org}`);
  t = t.replace(/\bkennt ihr\b/gi, `kennt ${org}`);

  t = t.replace(/\beuer(?:e[smnr]?|en|es)?\s+Unternehmen\b/gi, org);
  t = t.replace(/\beuer(?:e[smnr]?|en|es)?\s+Firma\b/gi, org);
  t = t.replace(/\beuer(?:e[smnr]?|en|es)?\s+Betrieb\b/gi, org);
  t = t.replace(/\beuer(?:e[smnr]?|en|es)?\s+Organisation\b/gi, org);

  t = t.replace(/\beurem\s+([\p{L}][\p{L}\-]*)\b/giu, `dem $1 von ${org}`);
  t = t.replace(/\beurer\s+([\p{L}][\p{L}\-]*)\b/giu, `der $1 von ${org}`);
  t = t.replace(/\beuren\s+([\p{L}][\p{L}\-]*)\b/giu, `den $1 von ${org}`);
  t = t.replace(/\beures\s+([\p{L}][\p{L}\-]*)\b/giu, `des $1 von ${org}`);
  t = t.replace(/\beure\s+([\p{L}][\p{L}\-]*)\b/giu, `die $1 von ${org}`);
  t = t.replace(/\beuer\s+([\p{L}][\p{L}\-]*)\b/giu, `$1 von ${org}`);

  // Remaining bare “ihr” as informal plural “you” (not “ihre/ihren…”).
  t = t.replace(/\bihr\b/gi, org);

  return t.replace(/\s{2,}/g, " ").replace(/\s+([?.!,;:])/g, "$1").trim();
}

function companyWarmupQuestions(
  organisationName?: string | null,
): Array<{ id: string; question: string }> {
  const org = companyExamOrganisationLabel(organisationName);
  return [
    {
      id: "warmup_company_known",
      question: rewriteCompanyAddressingToOrgName(
        `Wenn ich ${org} in einem Satz treffen soll: Wofür ist ${org} bekannt, und was dürfen wir nicht weglassen?`,
        org,
      ),
    },
  ];
}

/** No em/en dashes in spoken exam probes. */
export function withoutEmDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s*,\s*,+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([?.!])/g, "$1")
    .trim();
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return (
    /[?？]$/.test(t) ||
    /^(wie|was|welche|welcher|welches|wo|wann|warum|weshalb|wieso|erzähl|beschreib|nenne|hast|hast du|seid|bist)\b/i.test(
      t,
    )
  );
}

function stripDecorations(title: string): string {
  return title
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]+\s*/u, "")
    .replace(/\s*\((?:Ranking|Rangfolge|Mehrfachauswahl)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Company-perspective labels that describe the ideal customer, not the company itself. */
function isCustomerProfileMetaTitle(title: string): boolean {
  const t = title.toLowerCase();
  return (
    /\bwunsch/.test(t) ||
    /\bideal(?:en|e|er|es)?\b/.test(t) ||
    /\btypische[rns]?\b/.test(t) ||
    /\b(?:kunden|patienten)-?avatar\b/.test(t) ||
    /\bdigitale[rn]?\s+(?:kunden|patienten)\b/.test(t) ||
    /\bavatar-?name\b/.test(t) ||
    /(?:wie\s+soll|name\s+des).{0,40}\bavatar\b/.test(t) ||
    /\bzielgruppe\b/.test(t) ||
    /\bpersona\b/.test(t)
  );
}

/** Avatar naming / setup fields → ask the persona for their name instead. */
function isAvatarNameField(title: string): boolean {
  const t = stripDecorations(title).toLowerCase();
  return (
    /^(name des digitalen (?:kunden|patienten)-?avatars|avatar-?name)$/i.test(t) ||
    /wie soll .{0,40}\bavatar\b.{0,20}heißen/.test(t) ||
    /(?:kunden|patienten)-?avatar.{0,20}(heißen|name)/.test(t) ||
    /name .{0,30}(?:kunden|patienten)-?avatar/.test(t)
  );
}

/**
 * Rewrite 3rd-person / formal “Wunschkunde” wording into a natural Du-question
 * as if a company employee is getting to know a prospect.
 */
export function rewriteCustomerThirdPersonToSecondPerson(question: string): string {
  let q = question.trim();

  // Multi-word subject phrases first (avoids “diese du”)
  q = q.replace(/\bdiese\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bdieser\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bdieses\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bdie\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bder\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bden\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "dich");
  q = q.replace(/\bdem\s+Wunsch-?[\wäöüÄÖÜß-]+\b/gi, "dir");
  q = q.replace(
    /\bdiese\s+(?:Kund(?:en|innen)|Patient(?:en|innen)|Personen|Leute|Menschen)\b/gi,
    "du",
  );
  q = q.replace(/\bdie\s+(?:Personen|Leute|Menschen)\b/gi, "du");
  q = q.replace(/\bdieser\s+Person\b/gi, "dir");
  q = q.replace(/\bdiese\s+Person\b/gi, "du");
  q = q.replace(/\bdie\s+Person\b/gi, "du");

  q = q.replace(/\bWunsch-?Zahnärzt(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bWunsch-?[\wäöüÄÖÜß-]+\b/gi, "du");
  q = q.replace(/\bideal(?:en|e|er|es)?\s+Kund(?:e|en|in|innen)?\b/gi, "du");
  q = q.replace(/\bdie\s+meisten\s+Wunsch[\w-]*\b/gi, "du");
  q = q.replace(/\btypische\s+Wunsch[\w-]*\b/gi, "du");
  q = q.replace(/\bdie\s+meisten\s+(?:Kund(?:en|innen)|Patient(?:en|innen)|Personen)\b/gi, "du");
  q = q.replace(
    /\btypische[rns]?\s+(?:Kund(?:e|en|in|innen)|Patient(?:en|in|innen)|Personen)\b/gi,
    "du",
  );

  // Leftover determiners before du (“diese du”, “die du”)
  q = q.replace(/\b(?:diese[rns]?|jene[rns]?|solche[rns]?|die|der|das)\s+du\b/gi, "du");

  // Formal Sie/Ihr → du/dein
  q = q.replace(/\bIhnen\b/g, "dir");
  q = q.replace(/\bIhre[rnms]?\b/g, (m) => {
    const map: Record<string, string> = {
      Ihre: "deine",
      Ihrer: "deiner",
      Ihrem: "deinem",
      Ihren: "deinen",
      Ihres: "deines",
    };
    return map[m] ?? "deine";
  });
  q = q.replace(/\bSie\b/g, "du");
  q = q.replace(/\bihre[rnms]?\b/gi, (m) => {
    const lower = m.toLowerCase();
    const map: Record<string, string> = {
      ihre: "deine",
      ihrer: "deiner",
      ihrem: "deinem",
      ihren: "deinen",
      ihres: "deines",
    };
    return map[lower] ?? "deine";
  });

  // Brand after “zu …” → “zu uns” (only Capitalized brand tokens, not following verbs)
  q = q.replace(
    /\bzu\s+(?!uns\b|dir\b|mir\b|hause\b)(?:[A-ZÄÖÜ][\wÄÖÜäöüß-]*(?:\s+[A-ZÄÖÜ][\wÄÖÜäöüß-]*){0,3})\b/g,
    "zu uns",
  );

  q = q.replace(/\bWie alt sind\b/gi, "Wie alt bist");
  q = q.replace(/\bWie nehmen\b/gi, "Wie nimmst");
  q = q.replace(/\bWie kommen\b/gi, "Wie kommst");
  q = q.replace(/\bWie wählen\b/gi, "Wie wählst");
  q = q.replace(/\bWie entscheiden\b/gi, "Wie entscheidest");
  q = q.replace(/\bWie suchen\b/gi, "Wie suchst");
  q = q.replace(/\bWie fühlen\b/gi, "Wie fühlst");
  q = q.replace(/\bWie reagieren\b/gi, "Wie reagierst");
  q = q.replace(/\bWie beschreiben\b/gi, "Wie beschreibst");
  q = q.replace(/\bWie erzählen\b/gi, "Wie erzählst");
  q = q.replace(/\bWorauf legen\b/gi, "Worauf legst");
  q = q.replace(/\bWelche Wege nutzen\b/gi, "Welche Wege nutzt");
  q = q.replace(/\bWas erwarten\b/gi, "Was erwartest");
  q = q.replace(/\bWas brauchen\b/gi, "Was brauchst");
  q = q.replace(/\bWas erzählen\b/gi, "Was erzählst");
  q = q.replace(/\bWas beschreiben\b/gi, "Was beschreibst");
  q = q.replace(/\bWas sagen\b/gi, "Was sagst");
  q = q.replace(/\bWollen\b/g, "Willst");
  q = q.replace(/\bWelche ([^?]{3,80}?)\bhaben\b/gi, "Welche $1hast");
  q = q.replace(/\bWelche Situation hat (?:dich|du)\b/gi, "Was hat dich");

  q = fixGermanDuVerbAgreement(q);

  q = q.replace(/\bdu\s+du\b/gi, "du");
  q = q.replace(/\bzu\s+du\b/gi, "zu dir");
  q = q.replace(/\bvon\s+du\b/gi, "von dir");
  q = q.replace(/\bbei\s+du\b/gi, "bei dir");
  q = q.replace(/\büber\s+sie\b/gi, "über dich");
  q = q.replace(/\bmit\s+sie\b/gi, "mit dir");
  q = q.replace(/\bbevor\s+sie\b/gi, "bevor du");
  q = q.replace(/\bhinter\s+sich\b/gi, "hinter dir");
  q = q.replace(/\bwas sagen sie\b/gi, "was sagst du");
  q = q.replace(/\bsagst\s+sie\b/gi, "sagst du");
  q = q.replace(/\bbeschreibst\s+sie\b/gi, "beschreibst du");
  q = q.replace(/\berzählst\s+sie\b/gi, "erzählst du");
  q = q.replace(/\bkontaktierten\b/gi, "kontaktiert hast");
  q = q.replace(/\bhat\s+du\b/gi, "hast du");
  q = q.replace(/\s+/g, " ").trim();

  return q;
}

/** Repair leftover plural/formal verbs next to “du”. */
export function fixGermanDuVerbAgreement(text: string): string {
  let q = text;

  if (/\bdu\b/i.test(q)) {
    q = q.replace(/\bIhnen\b/g, "dir");
    q = q.replace(/\bIhre[rnms]?\b/g, (m) => {
      const map: Record<string, string> = {
        Ihre: "deine",
        Ihrer: "deiner",
        Ihrem: "deinem",
        Ihren: "deinen",
        Ihres: "deines",
      };
      return map[m] ?? "deine";
    });
    q = q.replace(/\bihre[rnms]?\b/gi, (m) => {
      const lower = m.toLowerCase();
      const map: Record<string, string> = {
        ihre: "deine",
        ihrer: "deiner",
        ihrem: "deinem",
        ihren: "deinen",
        ihres: "deines",
      };
      return map[lower] ?? "deine";
    });
    q = q.replace(/\büber\s+sie\b/gi, "über dich");
    q = q.replace(/\bmit\s+sie\b/gi, "mit dir");
    q = q.replace(/\bbevor\s+sie\b/gi, "bevor du");
    q = q.replace(/\bhinter\s+sich\b/gi, "hinter dir");
    q = q.replace(/\bbeschreibst\s+sie\b/gi, "beschreibst du");
    q = q.replace(/\berzählst\s+sie\b/gi, "erzählst du");
  }

  const verbMap: Array<[RegExp, string]> = [
    [/\bhaben\s+du\b/gi, "hast du"],
    [/\bdu\s+haben\b/gi, "du hast"],
    [/\bsind\s+du\b/gi, "bist du"],
    [/\bdu\s+sind\b/gi, "du bist"],
    [/\bist\s+du\b/gi, "bist du"],
    [/\berzählen\s+du\b/gi, "erzählst du"],
    [/\bdu\s+erzählen\b/gi, "du erzählst"],
    [/\bbeschreiben\s+du\b/gi, "beschreibst du"],
    [/\bdu\s+beschreiben\b/gi, "du beschreibst"],
    [/\bmachen\s+du\b/gi, "machst du"],
    [/\bdu\s+machen\b/gi, "du machst"],
    [/\bnehmen\s+du\b/gi, "nimmst du"],
    [/\bdu\s+nehmen\b/gi, "du nimmst"],
    [/\bkommen\s+du\b/gi, "kommst du"],
    [/\bdu\s+kommen\b/gi, "du kommst"],
    [/\bsuchen\s+du\b/gi, "suchst du"],
    [/\bdu\s+suchen\b/gi, "du suchst"],
    [/\bwählen\s+du\b/gi, "wählst du"],
    [/\bdu\s+wählen\b/gi, "du wählst"],
    [/\bfühlen\s+du\b/gi, "fühlst du"],
    [/\bdu\s+fühlen\b/gi, "du fühlst"],
    [/\bsehen\s+du\b/gi, "siehst du"],
    [/\bdu\s+sehen\b/gi, "du siehst"],
    [/\bfinden\s+du\b/gi, "findest du"],
    [/\bdu\s+finden\b/gi, "du findest"],
    [/\bnutzen\s+du\b/gi, "nutzt du"],
    [/\bdu\s+nutzen\b/gi, "du nutzt"],
    [/\blegen\s+du\b/gi, "legst du"],
    [/\bdu\s+legen\b/gi, "du legst"],
    [/\bstehen\s+du\b/gi, "stehst du"],
    [/\bdu\s+stehen\b/gi, "du stehst"],
    [/\bgehen\s+du\b/gi, "gehst du"],
    [/\bdu\s+gehen\b/gi, "du gehst"],
    [/\bleben\s+du\b/gi, "lebst du"],
    [/\bdu\s+leben\b/gi, "du lebst"],
    [/\bdenken\s+du\b/gi, "denkst du"],
    [/\bdu\s+denken\b/gi, "du denkst"],
    [/\bwissen\s+du\b/gi, "weißt du"],
    [/\bdu\s+wissen\b/gi, "du weißt"],
    [/\bkennen\s+du\b/gi, "kennst du"],
    [/\bdu\s+kennen\b/gi, "du kennst"],
    [/\bkönnen\s+du\b/gi, "kannst du"],
    [/\bdu\s+können\b/gi, "du kannst"],
    [/\bmüssen\s+du\b/gi, "musst du"],
    [/\bdu\s+müssen\b/gi, "du musst"],
    [/\bwollen\s+du\b/gi, "willst du"],
    [/\bdu\s+wollen\b/gi, "du willst"],
    [/\bsollen\s+du\b/gi, "sollst du"],
    [/\bdu\s+sollen\b/gi, "du sollst"],
    [/\bwerden\s+du\b/gi, "wirst du"],
    [/\bdu\s+werden\b/gi, "du wirst"],
    [/\berwarten\s+du\b/gi, "erwartest du"],
    [/\bdu\s+erwarten\b/gi, "du erwartest"],
    [/\bbrauchen\s+du\b/gi, "brauchst du"],
    [/\bdu\s+brauchen\b/gi, "du brauchst"],
    [/\bentscheiden\s+du\b/gi, "entscheidest du"],
    [/\bdu\s+entscheiden\b/gi, "du entscheidest"],
    [/\barbeiten\s+du\b/gi, "arbeitest du"],
    [/\bdu\s+arbeiten\b/gi, "du arbeitest"],
    [/\breagieren\s+du\b/gi, "reagierst du"],
    [/\bdu\s+reagieren\b/gi, "du reagierst"],
    [/\bsagen\s+du\b/gi, "sagst du"],
    [/\bdu\s+sagen\b/gi, "du sagst"],
    [/\berzählen\s+sie\b/gi, "erzählst du"],
    [/\bbeschreiben\s+sie\b/gi, "beschreibst du"],
  ];

  for (const [pattern, replacement] of verbMap) {
    q = q.replace(pattern, replacement);
  }

  q = q.replace(/\b([a-zäöüß]{3,})en\s+du\b/gi, (_m, stem: string) => {
    const s = String(stem);
    if (/^(sei|werd|hab|k[oö]nn|m[uü]ss|woll|soll|wiss)$/i.test(s)) return `${s}en du`;
    if (/[td]$/i.test(s)) return `${s}est du`;
    return `${s}st du`;
  });

  return q;
}

function topicFromCustomerMetaTitle(title: string): string {
  return stripDecorations(title)
    .replace(/^beschreibung\s+(des|der|die|dem)\s+/i, "")
    .replace(/\b(ideal(?:en|e|er|es)?|typische[rns]?|meisten)\s+/gi, "")
    .replace(/\b(name des digitalen kunden-avatars|avatar-?name)\b/gi, "Name")
    .replace(/\bwunsch-?[\wäöüÄÖÜß-]+/gi, "")
    .replace(/\b(der|des|die|dem|den)\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortTopic(topic: string): string {
  const t = topic.replace(/\s+/g, " ").trim();
  return t.length <= 48 ? t : `${t.slice(0, 47)}…`;
}

/** Drop questionnaire meta so probes talk to a person, not a field label. */
function humanizeFieldTopic(title: string): string {
  return stripDecorations(title)
    .replace(/\s*[—–-]\s*\d+\s*$/g, "")
    .replace(/\b(ansprechpartner(?:in|innen|s)?|kontaktperson(?:en)?)\b/gi, " ")
    .replace(/\b(wunsch-?[\wäöüÄÖÜß-]+|ideal(?:en|e|er|es)?|typische[rns]?)\b/gi, " ")
    .replace(/\b(fragebogen|ranking|rangfolge|mehrfachauswahl)\b/gi, " ")
    .replace(/\b(der|des|die|dem|den|beim|für|zur|zum)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map dry field titles to a natural Du-question.
 * Never quote the questionnaire label back (“Zu „Feld“: …”).
 */
export function naturalPersonaProbeFromTitle(
  title: string,
  options?: { fieldType?: string | null; value?: string },
): string {
  const raw = stripDecorations(title);
  const topic = humanizeFieldTopic(raw);
  const hay = `${raw} ${topic} ${options?.value ?? ""}`.toLowerCase();
  const fieldType = options?.fieldType ?? "";

  if (isAvatarNameField(raw) || (/\bname\b/.test(hay) && /avatar|heißen|ansprech/.test(hay))) {
    return "Wie heißt du, und wie darf ich dich ansprechen?";
  }

  if (/\balter(?:s|sbereich|sgruppe)?\b/.test(hay) || /^wie alt\b/i.test(raw)) {
    return "Darf ich fragen: Wie alt bist du ungefähr?";
  }

  if (
    /organisation(?:s)?größe|organisationsgroesse|unternehmensgröße|unternehmensgroesse|betriebsgröße|betriebsgroesse|firmengröße|firmengroesse/.test(
      hay,
    )
  ) {
    return "Wie viele Personen seid ihr im Unternehmen?";
  }

  if (
    /praxisgröße|praxisgroesse|mitarbeiter|behandler|teamgröße|teamgroesse|betriebsgröße|anzahl.*(ma|mitarbeiter|behandler)|organisationsgröße|unternehmensgröße/.test(
      hay,
    )
  ) {
    if (/behandler/.test(hay)) {
      return "Wie viele Behandler seid ihr, und wie groß ist die Praxis?";
    }
    if (/mitarbeiter|team|\bma\b|organisation|unternehmen|betrieb|firma|personen/.test(hay)) {
      return "Wie viele Personen seid ihr im Unternehmen?";
    }
    if (/praxis/.test(hay)) {
      return "Wie groß ist eure Praxis ungefähr?";
    }
    return "Wie viele Personen seid ihr ungefähr?";
  }

  if (/schwerpunkt|spezial|fokus|fachricht/.test(hay) && !looksLikeQuestion(raw)) {
    return "Worauf liegt bei dir der Fokus, und was ist dir besonders wichtig?";
  }

  if (/einzugsgebiet|region|standort|gebiet/.test(hay) && !looksLikeQuestion(raw)) {
    return "Wo bist du unterwegs, welche Region passt zu dir?";
  }

  if (/bedarfsbeschreibung|was du brauchst|bedarf beschreib/.test(hay) || (/formulierung/.test(hay) && /bedarf/.test(hay))) {
    return "Wie beschreibst du typischerweise, was du brauchst?";
  }

  if (/weiterempfehl|empfehlen|empfehlung/.test(hay) && /situation|aktiv|wann/.test(hay)) {
    return "Wann würdest du einen Anbieter weiterempfehlen?";
  }

  if (
    /formulierung|wortlaut|sagst du|erste[rn]? kontakt|erstkontakt|erste[sr]? satz|ansprache/.test(
      hay,
    )
  ) {
    return "Was sagst du typischerweise als Erstes, wenn du Kontakt aufnimmst?";
  }

  if (/häufigste situation|situation(?:en)? bei|bestandsanlagen|anwendungsfall/.test(hay)) {
    if (
      fieldType === "ranking" ||
      fieldType === "checkbox" ||
      fieldType === "text_list" ||
      /priorit|reihenfolge|ranking|wichtig/.test(hay)
    ) {
      return "Was kommt bei euch am häufigsten vor?";
    }
    return "In welchen Situationen steht ihr typischerweise?";
  }

  if (/kontaktweg|kontakt auf|erreichen|erstmals kontakt|wie kontakt/.test(hay)) {
    if (looksLikeQuestion(raw)) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return "Wie kommst du typischerweise das erste Mal mit einem Anbieter ins Gespräch?";
  }

  if (/funktion|rolle|aufgabe|jobtitel|position|verantwortlich/.test(hay)) {
    if (
      fieldType === "ranking" ||
      fieldType === "checkbox" ||
      fieldType === "text_list" ||
      /priorit|reihenfolge|ranking|wichtig/.test(hay)
    ) {
      return "Was ist dir in deiner Rolle am wichtigsten?";
    }
    return "Welche Aufgabe hast du bei euch hauptsächlich?";
  }

  if (/wow|begeisterung|begeistert|highlight|besonderes erlebnis/.test(hay)) {
    if (looksLikeQuestion(raw)) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return "Was wäre für dich ein richtig starkes Erlebnis mit einem Anbieter?";
  }

  if (/sorg|einwand|hürde|problem|schmerz|ärger|frust/.test(hay)) {
    return PERSONA_OPENING_QUESTION;
  }

  if (/entscheid|kriterium|anbieterwahl|priorit/.test(hay) && !looksLikeQuestion(raw)) {
    return "Wonach suchst du dir einen Anbieter aus, und was muss für dich unbedingt stimmen?";
  }

  if (isPrimaryBudgetField(raw)) {
    return "In welcher Preisspanne bewegst du dich ungefähr?";
  }
  if (/preisspanne|budget|preis/.test(hay) && /\baufträge?\b/.test(hay)) {
    return "In welcher Preisspanne bewegst du dich ungefähr?";
  }
  if (/reagier.*preis|preis.*reagier|fester preis|ab welchem preis|lieber einen festen/.test(hay)) {
    if (looksLikeQuestion(raw)) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return "Wie gehst du mit dem Preis um, und worauf achtest du besonders?";
  }

  if (
    /erstgespräch/.test(hay) ||
    (/erzähl|beschreib/.test(hay) && /(situation|leben|wörtlich|zuerst|als erstes)/.test(hay))
  ) {
    return PERSONA_OPENING_QUESTION;
  }

  if (
    /berufs|lebenssituation|lebenslage/.test(hay) &&
    !/erzählen|beschreiben|erstgespräch|erzähl/.test(hay)
  ) {
    return "Was machst du beruflich, und wie sieht deine Lebenssituation gerade aus?";
  }

  if (/beschreibung.*(wunsch|ideal|avatar|kunden|persona)/.test(hay) || /ideal.*wunsch/.test(hay)) {
    return PERSONA_OPENING_QUESTION;
  }

  if (looksLikeQuestion(raw)) {
    if (
      isCustomerProfileMetaTitle(raw) ||
      /\b(kund|patient|wunsch|person|personen|leute|sie|ihre|haben|erzählen|beschreiben|sagen|diese|meist)\b/i.test(
        raw,
      )
    ) {
      return softenExistingQuestion(rewriteCustomerThirdPersonToSecondPerson(raw));
    }
    return softenExistingQuestion(fixGermanDuVerbAgreement(raw));
  }

  if (
    fieldType === "ranking" ||
    fieldType === "checkbox" ||
    fieldType === "text_list" ||
    /priorit|reihenfolge|ranking/.test(hay)
  ) {
    if (/kontaktweg|aufmerksam|findest|suche|kanal|empfehlung|google|messe/.test(hay)) {
      return "Worüber findest du typischerweise einen neuen Anbieter oder Partner, und was kommt für dich zuerst?";
    }
    if (/entscheid|anbieterwahl|kriterium|wichtig/.test(hay)) {
      return "Wonach entscheidest du dich für einen Anbieter, und was hat für dich die höchste Priorität?";
    }
    return "Was ist dir dabei am wichtigsten?";
  }

  if (isCustomerProfileMetaTitle(raw) || topic.length >= 3) {
    // Last resort: still conversational, never quote the field label.
    if (/größe|groesse|anzahl|mitarbeiter|team|organisation|unternehmen|personen/.test(hay)) {
      return "Wie viele Personen seid ihr im Unternehmen?";
    }
    if (/alter/.test(hay)) {
      return "Darf ich fragen: Wie alt bist du ungefähr?";
    }
    if (/kontakt|weg|kanal/.test(hay)) {
      return "Wie kommst du typischerweise das erste Mal mit einem Anbieter ins Gespräch?";
    }
    if (/situation/.test(hay)) {
      return "In welchen Situationen steht ihr typischerweise?";
    }
    if (/formulierung|beschreib/.test(hay)) {
      return "Wie sagst du das typischerweise mit eigenen Worten?";
    }
    return "Kannst du mir das aus deiner Sicht kurz erzählen?";
  }

  return PERSONA_OPENING_QUESTION;
}

/** Final cleanup: no dashes, no questionnaire-meta wrappers. */
export function sanitizePersonaProbe(question: string): string {
  let q = withoutEmDashes(question).replace(/\s+/g, " ").trim();
  if (/zu\s*[„"][^„"]+[“"]\s*:\s*was trifft/i.test(q) || /erzähl mir kurz zu\s*[„"]/i.test(q)) {
    return "Kannst du mir das aus deiner Sicht kurz erzählen?";
  }
  if (/wenn du an\s*[„"][^„"]+[“"]\s*denkst/i.test(q)) {
    return "Was ist dir dabei am wichtigsten?";
  }
  q = q.replace(/\s*[—–―‒]+\s*/g, ", ");
  q = q.replace(/\s*,\s*,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return q;
}

function softenExistingQuestion(raw: string): string {
  let q = raw.replace(/\s+/g, " ").trim().replace(/[?？]+$/g, "");
  q = q.replace(/\s*[—–-]\s*bitte möglichst konkret\.?$/i, "");
  q = q.replace(/\s*bitte möglichst konkret\.?$/i, "");
  q = q.replace(/\s*und wie lautet die komplette Reihenfolge\.?$/i, "");
  q = q.replace(/\s*was steht bei dir bei\s*[„"][^„"]+[“"]\s*an erster Stelle/gi, "");
  q = q.replace(/\s*[—–-]\s*bitte mit den Angaben aus dem Fragebogen\.?$/i, "");
  q = q.replace(/\s*bitte mit den Angaben aus dem Fragebogen\.?$/i, "");
  q = q.replace(/\s*aus dem Fragebogen\.?/gi, "");
  q = q.replace(/\s*laut Fragebogen\.?/gi, "");
  q = fixGermanDuVerbAgreement(q);
  q = withoutEmDashes(q);
  q = q.replace(/\s+/g, " ").trim();
  if (!q || q.length < 8) return withoutEmDashes(`${raw.replace(/[?？]+$/g, "")}?`);
  return `${q}?`;
}

/** Only true budget/price-range fields — not every question that mentions “Preis”. */
function isPrimaryBudgetField(raw: string): boolean {
  const t = raw.toLowerCase();
  if (/reagier|aussage|fester preis|ab welchem preis|lieber einen festen|preisspanne bewegen sich/i.test(t)) {
    return false;
  }
  if (looksLikeQuestion(raw) && /preis/i.test(t) && !/\bbudget\b/i.test(t) && raw.length > 55) {
    return false;
  }
  return (
    /^(typisches?\s+)?budget\b/i.test(t) ||
    /\bwelches budget\b/i.test(t) ||
    (/\bbudget\b/i.test(t) && raw.length < 70)
  );
}

function hintFromValue(value: string, max = 420): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (!one) return "(keine Angabe im Fragebogen)";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

type FactSlice = { key: string; label: string; value: string };

/**
 * Pull concrete sub-facts out of long description answers
 * using the questionnaire's own labels (domain-agnostic).
 */
export function extractConcreteFactSlices(value: string): FactSlice[] {
  const text = value.replace(/\r/g, "").trim();
  if (!text) return [];

  const slices: FactSlice[] = [];
  const seen = new Set<string>();

  function push(key: string, label: string, rawValue: string) {
    const v = rawValue.replace(/\s+/g, " ").trim();
    if (!v || v.length < 1) return;
    const norm = `${key}::${v.toLowerCase()}`;
    if (seen.has(norm)) return;
    seen.add(norm);
    slices.push({ key, label, value: v });
  }

  // Line / bullet "Label: value"
  for (const line of text.split(/\n+/)) {
    const cleaned = line.replace(/^[-•*]\s*/, "").trim();
    const m = cleaned.match(/^(.{2,48}?)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const label = m[1]!.trim();
    const val = m[2]!.trim();
    push(classifySliceKey(label), label, val);
  }

  // Slash-, semicolon- or comma-separated labeled chunks
  for (const part of text.split(/\s*[|;/]\s*|\s*,\s+/)) {
    const chunk = part.trim();
    if (!chunk) continue;
    const withColon = chunk.match(/^(.{2,40}?)\s*[:：]\s*(.+)$/);
    if (withColon) {
      const label = withColon[1]!.trim();
      push(classifySliceKey(label), label, withColon[2]!.trim());
      continue;
    }
    const agePart = chunk.match(/^alter(?:sgruppe)?\s+(.+)$/i);
    if (agePart?.[1]) {
      push("age", "Alter", agePart[1].trim());
      continue;
    }
    const sizePart = chunk.match(
      /^(.{0,24}?(?:größe|groesse|mitarbeiter|behandler|team|anzahl)[^:]{0,20})\s+(.+)$/i,
    );
    if (sizePart?.[1] && sizePart[2] && /\d/.test(sizePart[2])) {
      push("size", sizePart[1].trim(), sizePart[2].trim());
      continue;
    }
    const focusPart = chunk.match(/^(?:schwerpunkt(?:e)?|spezialisierung(?:en)?)\s+(.+)$/i);
    if (focusPart?.[1]) {
      push("focus", "Schwerpunkte", focusPart[1].trim());
    }
  }

  // Inline age only when explicitly labeled (avoid false positives like budgets).
  const age = text.match(/\balter(?:sgruppe)?\b[^0-9]{0,16}(\d{2}\s*[–\-bis]+\s*\d{2}|\d{2})/i);
  if (age?.[1]) push("age", "Alter", age[1].trim());

  return slices;
}

function classifySliceKey(label: string): string {
  const t = label.toLowerCase();
  if (/\balter\b/.test(t)) return "age";
  if (/größe|groesse|mitarbeiter|behandler|team|betriebs|\bma\b|anzahl|praxis/.test(t)) {
    return "size";
  }
  if (/schwerpunkt|spezial|fokus|fachricht/.test(t)) return "focus";
  if (/\bname\b|ansprech/.test(t)) return "name";
  if (/region|standort|einzugs|gebiet|ort/.test(t)) return "region";
  if (/kontakt/.test(t)) return "contact";
  if (/budget|kosten|preis|invest/.test(t)) return "budget";
  return "topic";
}

/**
 * Build a sales-style probe from the slice's own questionnaire label.
 * Industry terms only when they appear in the label/value.
 */
function concreteQuestionForSlice(slice: FactSlice): string {
  const hay = `${slice.label} ${slice.value}`.toLowerCase();
  let question: string;

  switch (slice.key) {
    case "age":
      question = "Darf ich fragen: Wie alt bist du ungefähr?";
      break;
    case "name":
      question = "Wie heißt du, und wie darf ich dich ansprechen?";
      break;
    case "size":
      if (/behandler/i.test(hay)) {
        question = "Wie viele Behandler seid ihr, und wie groß ist die Praxis?";
      } else if (/mitarbeiter|team|\bma\b|organisation|unternehmen|personen/i.test(hay)) {
        question = "Wie viele Personen seid ihr im Unternehmen?";
      } else if (/praxis/i.test(hay)) {
        question = "Wie groß ist eure Praxis ungefähr?";
      } else {
        question = "Wie viele Personen seid ihr ungefähr?";
      }
      break;
    case "focus":
      question = "Worauf liegt bei dir der Fokus, und was ist dir besonders wichtig?";
      break;
    case "region":
      question = "Wo bist du unterwegs, welche Region passt zu dir?";
      break;
    case "contact":
      question = "Wie kommst du typischerweise das erste Mal mit einem Anbieter ins Gespräch?";
      break;
    case "budget":
      question = "In welcher Preisspanne bewegst du dich ungefähr?";
      break;
    default:
      question = naturalPersonaProbeFromTitle(slice.label, { value: slice.value });
  }

  return sanitizePersonaProbe(withoutEmDashes(question));
}

/** Priority: identity/facts before soft narrative probes. */
function factProbePriority(fact: SurveyFact, question: string): number {
  const hay = `${fact.fieldTitle} ${fact.label} ${question}`.toLowerCase();
  if (/wie heißt du|avatar-?name|name des digitalen/.test(hay)) return 10;
  if (/\balter\b|altersgruppe|wie alt/.test(hay)) return 20;
  if (/größe|groesse|mitarbeiter|behandler|team|anzahl|budget|preisspanne/.test(hay)) return 30;
  if (/schwerpunkt|spezial|situation|beschreibung|wer bist du/.test(hay)) return 40;
  if (/kontakt|aufmerksam|partner|anbieter|kanal/.test(hay)) return 50;
  if (/beschäftigt dich|mit uns zuerst/.test(hay)) return 90;
  return 60;
}

/**
 * Ask as a company employee getting to know the twin as a prospect.
 * Prefer rewritten survey questions over dry exam templates.
 */
function toPersonaInterviewQuestion(fact: SurveyFact): string | null {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) {
    return PERSONA_OPENING_QUESTION;
  }

  return withoutEmDashes(
    sanitizePersonaProbe(
      naturalPersonaProbeFromTitle(raw, {
        fieldType: fact.fieldType,
        value: fact.value,
      }),
    ),
  );
}

/**
 * Collapse near-duplicate persona probes (exact wording already deduped via seenNorm).
 * Keep the highest-priority probe per theme after sort.
 */
export function personaDedupeTheme(question: string): string | null {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;

  if (/stell dich bitte vor|wie heißt du.*wie alt|name.*alter.*situation/.test(q)) {
    return "intro";
  }

  if (
    /beschäftigt dich/.test(q) ||
    /als erstes erzähl|zuerst (?:sprechen|erzähl)/.test(q) ||
    /erstgespräch/.test(q) ||
    /wer bist du/.test(q) ||
    (/erzählst du über deine/.test(q) && /(situation|leben)/.test(q))
  ) {
    return "opening_situation";
  }

  if (/starkes erlebnis|wow|begeistert|weiterempfehlen/.test(q) && /anbieter|arzt|anwalt|zahnarzt/.test(q)) {
    return "wow";
  }

  if (/anbieter aus|unbedingt stimmen|höchste priorität|entscheidest du dich für einen anbieter/.test(q)) {
    return "criteria";
  }

  if (
    (/\bkontakt/.test(q) || /erstkontakt|erreichen|hinter dir|weg hast du|aufmerksam geworden/.test(q)) &&
    !/inhalt|online|recherch|gefunden/.test(q)
  ) {
    return "kontakt_weg";
  }

  if (/beruflich|lebenssituation|lebenslage/.test(q)) {
    return "beruf_leben";
  }

  if (/preisspanne|budget|preis/.test(q) && /bewegst|ungefähr|acht/.test(q)) {
    return "budget";
  }

  if (/personen seid ihr|mitarbeiter|wie groß ist euer|organisation ungefähr|praxis ungefähr/.test(q)) {
    return "org_size";
  }

  if (/wie alt bist du/.test(q)) {
    return "age";
  }

  if (/wie heißt du/.test(q)) {
    return "name";
  }

  return null;
}

/** Branchenwort für die Wow-Frage (Anbieter / Arzt / Anwalt …). */
export function resolvePersonaProviderLabel(
  facts: SurveyFact[],
  surveyTitle?: string | null,
): string {
  const hay = `${surveyTitle ?? ""} ${facts
    .map((f) => `${f.fieldTitle} ${f.label} ${f.value}`)
    .join(" ")}`.toLowerCase();

  if (/zahnarzt|zahnärzt/.test(hay)) return "Zahnarzt";
  if (/\banwalt\b|rechtsanwalt|kanzlei|notar/.test(hay)) return "Anwalt";
  if (/steuerberater/.test(hay)) return "Steuerberater";
  if (/heilpraktiker|naturheil/.test(hay)) return "Heilpraktiker";
  if (/\barzt\b|ärztin|patient|medizin|klinik/.test(hay)) return "Arzt";
  if (/physiotherapeut|therapeut/.test(hay)) return "Therapeut";
  if (/\bpraxis\b/.test(hay) && !/labor|dentaltechnik/.test(hay)) return "Arzt";
  return "Anbieter";
}

function hintFromMatchingFacts(facts: SurveyFact[], pattern: RegExp, fallback: string): string {
  const parts: string[] = [];
  for (const fact of facts) {
    const hay = `${fact.fieldTitle} ${fact.label}`;
    if (!pattern.test(hay) && !pattern.test(fact.value)) continue;
    const hint = hintFromValue(fact.value, 160);
    if (hint && hint !== "(keine Angabe im Fragebogen)" && !parts.includes(hint)) {
      parts.push(hint);
    }
    if (parts.length >= 3) break;
  }
  if (parts.length === 0) return fallback;
  return parts.join(" · ");
}

/**
 * Feste Kernfragen für den Persona-Test (immer zuerst, feste Reihenfolge).
 * Danach optional konkrete Fragebogen-Fakten.
 */
export function buildPersonaCoreExamQuestions(
  facts: SurveyFact[],
  providerLabel?: string,
  surveyTitle?: string | null,
): SurveyExamQuestion[] {
  const label = providerLabel ?? resolvePersonaProviderLabel(facts, surveyTitle);

  const core: SurveyExamQuestion[] = [
    {
      id: "core_intro",
      question:
        "Stell dich bitte vor: Wie heißt du, wie alt bist du ungefähr, und was ist gerade deine Situation?",
      expectedHint: hintFromMatchingFacts(
        facts,
        /name|avatar|alter|situation|beschreibung.*(wunsch|ideal|kunden|persona)/i,
        "Name, Alter und Situation aus dem Fragebogen.",
      ),
      factId: "",
      kind: "answer",
    },
    {
      id: "core_job",
      question: "Was machst du beruflich, und wie sieht deine Lebenssituation gerade aus?",
      expectedHint: hintFromMatchingFacts(
        facts,
        /beruf|lebenssituation|lebenslage|arbeit/i,
        "Beruf und Lebenssituation aus dem Fragebogen.",
      ),
      factId: "",
      kind: "answer",
    },
    {
      id: "core_wow",
      question: `Was wäre für dich ein richtig starkes Erlebnis mit einem ${label}?`,
      expectedHint: hintFromMatchingFacts(
        facts,
        /wow|begeister|highlight|erlebnis|weiterempfehl/i,
        `Erwartetes Wow-Erlebnis / Weiterempfehlung (bezogen auf ${label}).`,
      ),
      factId: "",
      kind: "answer",
    },
    {
      id: "core_pain",
      question: PERSONA_OPENING_QUESTION,
      expectedHint: hintFromMatchingFacts(
        facts,
        /sorg|einwand|hürde|problem|schmerz|ärger|frust|beschäftigt|erstgespräch/i,
        "Aktuelles Anliegen / worüber sie zuerst sprechen würde.",
      ),
      factId: "",
      kind: "answer",
    },
    {
      id: "core_criteria",
      question:
        "Wonach suchst du dir einen Anbieter aus, und was muss für dich unbedingt stimmen?",
      expectedHint: hintFromMatchingFacts(
        facts,
        /entscheid|kriterium|priorit|anbieterwahl|wichtig/i,
        "Entscheidungskriterien aus dem Fragebogen.",
      ),
      factId: "",
      kind: "answer",
    },
  ];

  return core.map((q) => ({ ...q, question: sanitizePersonaProbe(q.question) }));
}

function toCompanyInterviewQuestion(
  fact: SurveyFact,
  organisationName?: string | null,
): string {
  const org = companyExamOrganisationLabel(organisationName);
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  if (!raw) {
    return rewriteCompanyAddressingToOrgName(
      `Welche Unternehmensfakten zu ${org} müssen wir aus dem Fragebogen treffen?`,
      org,
    );
  }
  if (looksLikeQuestion(raw)) {
    return rewriteCompanyAddressingToOrgName(
      `${raw.replace(/\?$/, "")}, bitte mit den konkreten Angaben zu ${org}.`,
      org,
    );
  }

  if (fact.fieldType === "ranking" || fact.fieldType === "checkbox" || fact.fieldType === "text_list") {
    return rewriteCompanyAddressingToOrgName(
      `Was steht bei ${org} bei „${shortTopic(raw)}" ganz oben, und wie lautet die Reihenfolge laut Fragebogen?`,
      org,
    );
  }

  if (/\d/.test(fact.value) || /%|€|euro|stern|platz|nr\.?/i.test(fact.value)) {
    return rewriteCompanyAddressingToOrgName(
      `Welche konkreten Zahlen oder Fakten gelten bei ${org} zu „${raw}"?`,
      org,
    );
  }

  return rewriteCompanyAddressingToOrgName(
    `Was steht bei ${org} zu „${raw}" im Unternehmenswissen, bitte wörtlich und vollständig genug?`,
    org,
  );
}

/**
 * Skip company-only facts when probing a Wunschkunde persona.
 * Catches firm names (“TM Dentaltechnik”), “am liebsten zusammen”, Labor/Kanzlei, etc.
 */
function isCompanyOnlyFactForPersona(fact: SurveyFact): boolean {
  const t = `${fact.fieldTitle} ${fact.label}`.toLowerCase();
  if (isCustomerProfileMetaTitle(t)) return false;

  // “Mit welchen X arbeitet [Firma] am liebsten zusammen?”
  if (
    /mit welchen\b/.test(t) &&
    /arbeitet/.test(t) &&
    /(zusammen|liebsten|partner)/.test(t)
  ) {
    return true;
  }

  if (/arbeitet .*\bam liebsten\b|\bam liebsten zusammen\b/.test(t)) {
    return true;
  }

  // Firm ops / funnel metrics — not something to ask the Wunschkunde.
  if (
    /\binteressent/.test(t) &&
    /(nicht zurück|nicht wahrgenommen|absage|no-?show|kein termin|nicht erschienen)/.test(t)
  ) {
    return true;
  }
  if (/(termin|gespräch).{0,40}nicht wahrgenommen|nicht zurückgerufen/.test(t)) {
    return true;
  }
  // Staff observation about patients/customers (3rd person), not Du-discovery.
  if (/woran merkt man\b/.test(t)) return true;
  if (
    /welche fragen stellen\b/.test(t) &&
    /\b(patienten|kunden|interessenten|leute|menschen)\b/.test(t)
  ) {
    return true;
  }

  // Org / firm vocabulary (unless clearly about the customer's own practice as Wunschkunde).
  if (
    /\b(firma|unternehmen|organisation|labor|kanzlei|gmbh|partmbb|dentaltechnik|mitbewerber|wettbewerb|unsere?|ihr\b|euch)\b/.test(
      t,
    )
  ) {
    if (/\b(meine|deine|wunsch|ideal|typische)\b/.test(t)) return false;
    return true;
  }

  return false;
}

function isDescriptionMetaField(fact: SurveyFact): boolean {
  const raw = stripDecorations(fact.kind === "answer" ? fact.fieldTitle : fact.label);
  return (
    /beschreibung.*(wunsch|ideal|avatar|kunden|persona)/i.test(raw) || /ideal.*wunsch/i.test(raw)
  );
}

/** One survey fact → one or more concrete exam probes (persona). */
function personaProbesFromFact(fact: SurveyFact): Array<{
  idSuffix: string;
  question: string;
  expectedHint: string;
}> {
  // Long / structured answers: split into probes from the questionnaire's own labels.
  if (isDescriptionMetaField(fact) || fact.value.length > 120) {
    const slices = extractConcreteFactSlices(fact.value);
    if (slices.length >= 2) {
      return slices.map((slice, index) => ({
        idSuffix: `_${slice.key}${index > 0 ? `_${index}` : ""}`,
        question: concreteQuestionForSlice(slice),
        expectedHint: hintFromValue(slice.value),
      }));
    }
  }

  const question = toPersonaInterviewQuestion(fact);
  if (!question) return [];
  return [
    {
      idSuffix: "",
      question,
      expectedHint: hintFromValue(fact.value),
    },
  ];
}

/**
 * Build an interviewer script from questionnaire facts (deterministic, no LLM).
 *
 * - `persona`: fixed core discovery questions first, then optional fact probes.
 * - `company`: ask the SEO/company twin about firm facts.
 */
export function buildSurveyExamQuestions(
  facts: SurveyFact[],
  options?: {
    maxQuestions?: number;
    audience?: SurveyExamAudience;
    surveyTitle?: string | null;
    /** Required for company/SEO probes — questions refer to this name, not “ihr/euch”. */
    organisationName?: string | null;
  },
): SurveyExamQuestion[] {
  const maxQuestions = options?.maxQuestions ?? 16;
  const audience: SurveyExamAudience = options?.audience ?? "persona";

  if (audience === "persona") {
    return buildPersonaExamScript(facts, maxQuestions, options?.surveyTitle);
  }

  const organisationName = options?.organisationName ?? null;
  const draft: Array<SurveyExamQuestion & { priority: number }> = [];
  const seenNorm = new Set<string>();

  function push(q: SurveyExamQuestion, priority: number) {
    const key = q.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenNorm.has(key)) return;
    seenNorm.add(key);
    draft.push({ ...q, priority });
  }

  const answerFacts = facts.filter((f) => f.kind === "answer");
  const followUps = facts.filter((f) => f.kind === "follow_up");
  const ordered = [...answerFacts, ...followUps];

  for (const fact of ordered) {
    const question = toCompanyInterviewQuestion(fact, organisationName);
    push(
      {
        id: `exam_${fact.id}`,
        question,
        expectedHint: hintFromValue(fact.value),
        factId: fact.id,
        kind: fact.kind,
      },
      factProbePriority(fact, question),
    );
  }

  draft.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const out: SurveyExamQuestion[] = draft
    .slice(0, Math.max(0, maxQuestions - 1))
    .map(({ priority: _p, ...q }) => q);

  if (out.length < maxQuestions) {
    for (const w of companyWarmupQuestions(organisationName)) {
      const key = w.question.toLowerCase().replace(/\s+/g, " ").trim();
      if (seenNorm.has(key)) continue;
      seenNorm.add(key);
      out.push({
        id: w.id,
        question: w.question,
        expectedHint:
          "Verhaltenscheck: Firmenwissen und Tonalität aus dem Anbieter-Fragebogen.",
        factId: "",
        kind: "answer",
      });
    }
  }

  return out.slice(0, maxQuestions);
}

function buildPersonaExamScript(
  facts: SurveyFact[],
  maxQuestions: number,
  surveyTitle?: string | null,
): SurveyExamQuestion[] {
  const core = buildPersonaCoreExamQuestions(facts, undefined, surveyTitle);
  const seenNorm = new Set(
    core.map((q) => q.question.toLowerCase().replace(/\s+/g, " ").trim()),
  );
  const seenThemes = new Set<string>();
  for (const q of core) {
    const theme = personaDedupeTheme(q.question);
    if (theme) seenThemes.add(theme);
  }
  // Intro already covers name/age/situation probes from the questionnaire.
  seenThemes.add("name");
  seenThemes.add("age");
  seenThemes.add("intro");

  const answerFacts = facts.filter((f) => f.kind === "answer");
  const followUps = facts.filter((f) => f.kind === "follow_up");
  const ordered = [...answerFacts, ...followUps];

  const extras: Array<SurveyExamQuestion & { priority: number }> = [];

  for (const fact of ordered) {
    if (isCompanyOnlyFactForPersona(fact)) continue;

    for (const probe of personaProbesFromFact(fact)) {
      const question = sanitizePersonaProbe(probe.question);
      const key = question.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key || seenNorm.has(key)) continue;

      const theme = personaDedupeTheme(question);
      if (theme && seenThemes.has(theme)) continue;

      // Skip soft openers / bio dumps; core already covers discovery.
      if (
        /stell dich bitte vor|beschäftigt dich gerade am meisten|starkes erlebnis mit einem/i.test(
          question,
        )
      ) {
        continue;
      }

      extras.push({
        id: `exam_${fact.id}${probe.idSuffix}`,
        question,
        expectedHint: probe.expectedHint,
        factId: fact.id,
        kind: fact.kind,
        priority: factProbePriority(fact, question),
      });
    }
  }

  extras.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  const out: SurveyExamQuestion[] = [...core];
  for (const item of extras) {
    if (out.length >= maxQuestions) break;
    const key = item.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenNorm.has(key)) continue;
    const theme = personaDedupeTheme(item.question);
    if (theme && seenThemes.has(theme)) continue;
    seenNorm.add(key);
    if (theme) seenThemes.add(theme);
    const { priority: _p, ...q } = item;
    out.push(q);
  }

  return out.slice(0, maxQuestions);
}

function tokenizeForExamMatch(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}\-äöüÄÖÜß]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

/**
 * For freeform tester questions: prefer a matching bank SOLL, otherwise a
 * capped digest of all questionnaire hints so the AI can still compare.
 */
export function resolveCustomExamExpectedHint(
  customQuestion: string,
  bank: Array<Pick<SurveyExamQuestion, "question" | "expectedHint">>,
): { expectedHint: string; source: "matched" | "digest" } {
  const q = customQuestion.trim();
  if (!q || bank.length === 0) {
    return { expectedHint: "", source: "digest" };
  }

  const qTokens = new Set(tokenizeForExamMatch(q));
  let best: { score: number; hint: string } | null = null;

  for (const item of bank) {
    const hay = `${item.question} ${item.expectedHint}`;
    const tokens = tokenizeForExamMatch(hay);
    if (tokens.length === 0) continue;
    const hits = tokens.filter((t) => qTokens.has(t)).length;
    const score = hits / Math.sqrt(tokens.length);
    if (!best || score > best.score) {
      best = { score, hint: item.expectedHint.trim() };
    }
  }

  // Enough shared tokens → reuse that fact's SOLL.
  if (best && best.hint && best.score >= 0.55) {
    return { expectedHint: best.hint, source: "matched" };
  }

  const lines = bank
    .map((item) => {
      const hint = item.expectedHint.trim();
      if (!hint) return null;
      return `- ${item.question.trim()}: ${hint}`;
    })
    .filter(Boolean) as string[];

  const digest = [
    "Fragebogen-Auszug — prüfe nur Angaben, die zur Prüffrage passen:",
    ...lines,
  ]
    .join("\n")
    .slice(0, 3_500)
    .trim();

  return { expectedHint: digest, source: "digest" };
}
