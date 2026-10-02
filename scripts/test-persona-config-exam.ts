/**
 * Persona-Test questions from twin settings when no completed questionnaire exists.
 * Run: npx tsx scripts/test-persona-config-exam.ts
 */
import assert from "node:assert/strict";

import { buildExamCheckUserPrompt } from "../lib/dt/exam-answer-check";
import {
  buildPersonaConfigExamAiPrompt,
  buildPersonaConfigExamQuestions,
  chooseExamQuestionBank,
  filterGroundedPersonaExamQuestions,
  mergePersonaExamQuestions,
  parsePersonaConfigExamQuestions,
  personaConfigSourceText,
  personaExamHintIsGrounded,
} from "../lib/dt/persona-config-exam";

const claudia = buildPersonaConfigExamQuestions({
  name: "Claudia",
  role: "Hochpreisige Verjüngungskundin",
  avatarData: {
    disg: "S",
    alter: "52",
    situation: "Falten und erschlaffte Haut, will ohne Messer etwas tun",
    pain_points: "Sieht seit zwei Jahren müde aus und schiebt den Termin vor sich her",
    entscheidungskriterien: "Bewertungen, transparente Erklärung, kein Verkaufsdruck",
    einwaende: "Angst, dass das Gesicht rot bleibt",
    hormozi_dream: "Wieder frisch wirken, ohne dass jemand die Behandlung sieht",
    dringlichkeit: "Der Geburtstag der Schwester ist in sechs Wochen",
  },
});

assert.ok(claudia.some((q) => q.id === "cfg_disg" && /DISG/.test(q.expectedHint)));
assert.ok(claudia.some((q) => q.id === "cfg_pain" && /müde/.test(q.expectedHint)));
assert.ok(claudia.some((q) => q.id === "cfg_demo_age" && /52/.test(q.expectedHint)));
assert.ok(
  claudia.some((q) => q.id === "cfg_criteria" && /Bewertungen/.test(q.expectedHint)),
);
assert.ok(claudia.some((q) => q.id === "cfg_hormozi_dream" && /frisch/.test(q.expectedHint)));
assert.ok(
  claudia.some((q) => q.id === "cfg_hormozi_urgency" && /Geburtstag/.test(q.expectedHint)),
);
assert.equal(
  claudia.some((q) => q.id === "cfg_hormozi_effort"),
  false,
  "missing Hormozi effort must not be invented",
);
const claudiaIds = claudia.map((q) => q.id);
assert.ok(claudiaIds.indexOf("cfg_pain") < claudiaIds.indexOf("cfg_disg"));
assert.ok(claudiaIds.indexOf("cfg_demo_age") < claudiaIds.indexOf("cfg_disg"));
assert.match(claudia.find((q) => q.id === "cfg_intro")?.expectedHint ?? "", /Claudia/);
assert.match(claudia.find((q) => q.id === "cfg_pain")?.question ?? "", /erste[mn] Gespräch/);
assert.equal(
  claudia.some((q) => /was gilt bei euch/i.test(q.question)),
  false,
);

const fromPrompt = buildPersonaConfigExamQuestions({
  name: "Claudia",
  role: "Wunschkundin",
  promptTemplate: "Avatar: Claudia",
  promptAppend: [
    "## DISG",
    "S, stetig, will Sicherheit und keine Hektik im Beratungsgespräch.",
    "",
    "## Pain Points",
    "Die Haut wirkt seit zwei Jahren müde, sie will das ohne OP ändern.",
    "",
    "**Entscheidungskriterien**",
    "Google-Bewertungen und eine ehrliche Einschätzung, wie viele Sitzungen es braucht.",
    "",
    "## Der große Wunsch",
    "Dass Kolleginnen sagen, sie sehe ausgeruht aus, ohne nach einer Behandlung zu fragen.",
  ].join("\n"),
});

assert.ok(fromPrompt.some((q) => q.id === "cfg_disg" && /Sicherheit/.test(q.expectedHint)));
assert.ok(fromPrompt.some((q) => q.id === "cfg_pain" && /müde/.test(q.expectedHint)));
assert.ok(fromPrompt.some((q) => q.id === "cfg_criteria" && /Sitzungen/.test(q.expectedHint)));
assert.ok(fromPrompt.some((q) => q.id === "cfg_hormozi_dream" && /ausgeruht/.test(q.expectedHint)));
assert.equal(
  fromPrompt.some((q) => /Avatar: Claudia/.test(q.expectedHint)),
  false,
);

const globalOnly = buildPersonaConfigExamQuestions({
  name: "Claudia",
  usesGlobalPrompt: true,
  promptTemplate: `${"Du bist der DigitalTwin von Praxis. ".repeat(20)}\nPERSPEKTIVE\nAntworte immer im Ich.`,
  promptAppend: "DISG-Typ: D, direkt und ergebnisorientiert, will Zahlen statt Smalltalk.",
  avatarData: { tiefste_angst: "Dass das Ergebnis künstlich aussieht" },
});
assert.ok(globalOnly.some((q) => q.id === "cfg_disg" && /\bD\b/.test(q.expectedHint)));
assert.ok(globalOnly.some((q) => q.id === "cfg_pain" && /künstlich/.test(q.expectedHint)));
assert.equal(
  globalOnly.some((q) => /DigitalTwin von Praxis/.test(q.expectedHint)),
  false,
);

assert.deepEqual(
  buildPersonaConfigExamQuestions({ name: "Leer", promptTemplate: "Avatar: Leer" }),
  [],
);

const company = buildPersonaConfigExamQuestions({
  name: "SEO-Berater",
  audience: "company",
  promptTemplate: [
    "## ANKER: GLOBALER DIGITALTWIN-PROMPT",
    "Dieser Block ist nur der Rahmen und darf keine Prüffrage werden, weil er zu kurz und technisch ist? Nein, er ist lang genug aber der Titel ist Anker.",
    "",
    "## Leistungen",
    "Fotona 4D, Hautstraffung ohne Skalpell, Beratung mit Vorher-nachher nur auf Wunsch.",
  ].join("\n"),
});
assert.equal(company.length, 1);
assert.match(company[0]?.question ?? "", /Leistungen bietet ihr/);
assert.match(company[0]?.expectedHint ?? "", /Fotona/);
assert.equal(company.some((q) => q.id === "cfg_disg"), false);
assert.equal(company.some((q) => /was gilt bei euch/i.test(q.question)), false);

const practice = buildPersonaConfigExamQuestions({
  name: "SEO-Berater",
  role: "Firmenwissen",
  audience: "company",
  promptTemplate: [
    "## Praxis Meerbusch | Dr. Schürings, Anbieter- & Patienten-Workshop",
    "- **Praxisname:** Praxis Meerbusch | Dr. Schürings",
    "- **Gründung:** April 2023",
    "- **Standort:** Meerbusch, Einzugsgebiet mind. 20 km",
    "- **Team:** Dr. Katharina Schürings, Fachärztin für Dermatologie",
    "",
    "## Anbieter-Wissen (Meeting-Transkripte)",
    "**Schmerz:** Die Haut wirkt seit zwei Jahren müde, sie will das ohne OP ändern.",
    "**Wunsch-Outcome:** Wieder frisch wirken, ohne dass man eine Behandlung sieht.",
    "**Hürde:** Angst, dass das Gesicht rot bleibt und es zu teuer wird.",
    "**Alter:** Anfang 50",
    "**DISG:** S, stetig, will Sicherheit und keine Hektik.",
  ].join("\n"),
});
assert.ok(practice.length >= 8, `expected a full questionnaire, got ${practice.length}`);
assert.equal(practice.some((q) => /was gilt bei euch/i.test(q.question)), false);
assert.equal(practice.some((q) => /Meeting-Transkripte|Workshop/.test(q.question)), false);
assert.ok(practice.some((q) => q.id === "cfg_pain" && /müde/.test(q.expectedHint)));
assert.ok(practice.some((q) => q.id === "cfg_hormozi_dream" && /frisch/.test(q.expectedHint)));
assert.ok(practice.some((q) => q.id === "cfg_hurdle" && /rot/.test(q.expectedHint)));
assert.ok(practice.some((q) => q.id === "cfg_demo_age" && /Anfang 50/.test(q.expectedHint)));
assert.ok(practice.some((q) => q.id === "cfg_disg" && /Sicherheit/.test(q.expectedHint)));
assert.ok(practice.some((q) => q.id === "cfg_firm_since" && /2023/.test(q.expectedHint)));
const practiceIds = practice.map((q) => q.id);
assert.ok(practiceIds.indexOf("cfg_pain") < practiceIds.indexOf("cfg_demo_age"));
assert.ok(practiceIds.indexOf("cfg_demo_age") < practiceIds.indexOf("cfg_disg"));
assert.ok(practiceIds.indexOf("cfg_disg") < practiceIds.indexOf("cfg_firm_since"));
assert.match(practice.find((q) => q.id === "cfg_pain")?.question ?? "", /Wunschkunde/);

const source = personaConfigSourceText({
  name: "Claudia",
  promptAppend: "DISG: S, stetig. Pain Points: müde Haut seit zwei Jahren.",
  avatarData: { entscheidungskriterien: "Bewertungen und transparente Aufklärung" },
});
assert.match(source, /müde Haut/);
assert.match(source, /Bewertungen/);

const parsed = parsePersonaConfigExamQuestions(`Sure.
{"questions":[
  {"id":"cfg_disg","question":"Welcher DISG-Typ bist du?","expectedHint":"S, stetig"},
  {"id":"cfg_pain","question":"Was ist dein Schmerz?","expectedHint":"Budget neuntausend Euro erfunden"},
]}`);
assert.equal(parsed.length, 2);
const grounded = filterGroundedPersonaExamQuestions(parsed, source);
assert.equal(grounded.length, 1);
assert.equal(grounded[0]?.id, "cfg_disg");
assert.equal(personaExamHintIsGrounded("Budget neuntausend Euro erfunden", source), false);

const merged = mergePersonaExamQuestions(grounded, [
  {
    id: "cfg_disg",
    question: "Welcher DISG-Typ bist du?",
    expectedHint: "DISG: S, stetig",
    factId: "persona_config",
    kind: "answer",
  },
  {
    id: "cfg_criteria",
    question: "Wonach suchst du dir einen Anbieter aus?",
    expectedHint: "Entscheidungskriterien: Bewertungen und transparente Aufklärung",
    factId: "persona_config",
    kind: "answer",
  },
]);
assert.deepEqual(
  merged.map((q) => q.id),
  ["cfg_disg", "cfg_criteria"],
);

assert.equal(
  chooseExamQuestionBank({
    surveyQuestions: [
      {
        id: "exam_1",
        question: "Wie alt bist du?",
        expectedHint: "52",
        factId: "f",
        kind: "answer",
      },
    ],
    personaQuestions: claudia,
  }).questionSource,
  "survey",
);
assert.equal(
  chooseExamQuestionBank({ surveyQuestions: [], personaQuestions: claudia }).questionSource,
  "persona",
);
assert.equal(
  chooseExamQuestionBank({ surveyQuestions: null, personaQuestions: [] }).questions.length,
  0,
);

const aiPrompt = buildPersonaConfigExamAiPrompt(source, "persona");
assert.match(aiPrompt, /DISG/);
assert.match(aiPrompt, /Schmerz/);
assert.match(aiPrompt, /Hürde/);
assert.match(aiPrompt, /Demografie/);
assert.match(aiPrompt, /Hormozi/);
assert.match(aiPrompt, /Was gilt bei euch/);
assert.match(aiPrompt, /nichts erfinden|Erfinde keinen/i);

const companyPrompt = buildPersonaConfigExamAiPrompt(source, "company");
assert.match(companyPrompt, /Wunschkunde/);
assert.match(companyPrompt, /DISG/);
assert.doesNotMatch(companyPrompt, /Keine Fragen zu DISG/);

const checkPrompt = buildExamCheckUserPrompt({
  question: "Welcher DISG-Typ bist du?",
  expectedHint: "DISG: S, stetig",
  assistantAnswer: "Ich bin eher der stetige Typ.",
  audience: "persona",
  basis: "persona",
});
assert.match(checkPrompt, /Persona-Einstellungen/);
assert.match(checkPrompt, /DISG/);
assert.doesNotMatch(checkPrompt, /muss sinngemäß vorkommen/);

console.log("persona-config-exam tests: ok");
