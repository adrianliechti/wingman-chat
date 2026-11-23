import { languageName } from "./languages";

/**
 * How a translation should read, beyond being correct: the formality of
 * address and the writing style. Each choice is defined once here, with the
 * label and description the menus show and the instruction the rewrite gets.
 */
export interface WordingOption {
  /** "" is the automatic choice: nothing is asked for and the original decides. */
  value: string;
  label: string;
  description: string;
}

/** How a language marks formal and informal speech, in its own words. */
interface Register {
  formal: string;
  informal: string;
  /** Japanese and Korean choose a speech style, not a pronoun (DeepL: "polite" and "plain"). */
  speechStyle?: boolean;
}

/**
 * Languages that address a reader formally or informally. Translators offer
 * formality for these only (DeepL, Amazon Translate); a language without the
 * distinction, like English, gets its register from the writing style instead.
 */
const REGISTERS: Record<string, Register> = {
  de: { formal: "Sie", informal: "du" },
  fr: { formal: "vous", informal: "tu" },
  it: { formal: "Lei", informal: "tu" },
  es: { formal: "usted", informal: "tú" },
  pt: { formal: "o senhor / a senhora", informal: "tu / você" },
  nl: { formal: "u", informal: "je" },
  pl: { formal: "Pan / Pani", informal: "ty" },
  cs: { formal: "vy", informal: "ty" },
  sk: { formal: "vy", informal: "ty" },
  hu: { formal: "Ön", informal: "te" },
  ro: { formal: "dumneavoastră", informal: "tu" },
  bg: { formal: "Вие", informal: "ти" },
  ru: { formal: "вы", informal: "ты" },
  uk: { formal: "ви", informal: "ти" },
  el: { formal: "εσείς", informal: "εσύ" },
  tr: { formal: "siz", informal: "sen" },
  hi: { formal: "आप", informal: "तुम" },
  zh: { formal: "您", informal: "你" },
  ja: { formal: "です・ます", informal: "だ・である", speechStyle: true },
  ko: { formal: "존댓말", informal: "반말", speechStyle: true },
};

const FORMALITIES = ["formal", "informal"] as const;

const STYLES = [
  {
    value: "simple",
    label: "Simple",
    description: "Short sentences and everyday words",
    instruction:
      "Simple language: short sentences, common words, one idea per sentence, active voice; explain or replace jargon and spell out abbreviations.",
  },
  {
    value: "business",
    label: "Business",
    description: "Polished and professional",
    instruction:
      "Business writing: precise, courteous and concise, with the standard phrasing of professional correspondence in {language}; no colloquialisms, no filler.",
  },
  {
    value: "academic",
    label: "Academic",
    description: "Objective and precise",
    instruction:
      "Academic writing: objective and precise, in complete sentences with formal vocabulary; no colloquialisms or contractions; keep every claim exactly as strong or as hedged as it is.",
  },
  {
    value: "casual",
    label: "Casual",
    description: "Relaxed and conversational",
    instruction:
      "Casual writing: relaxed and conversational, with the contractions and everyday expressions {language} uses in friendly messages; no slang that changes the meaning.",
  },
];

/** Style values stored before the styles took the names translators commonly use. */
const LEGACY_STYLES: Record<string, string> = { plain: "simple", professional: "business" };

function register(lang: string): Register | undefined {
  return REGISTERS[lang.toLowerCase().split(/[-_]/)[0]];
}

/**
 * The formality choices for a target language, each naming what it means
 * there ("Sie", "du"). Empty for a language without the distinction, so the
 * control is not offered.
 */
export function formalityOptions(lang: string): WordingOption[] {
  const forms = register(lang);
  if (!forms) return [];
  const describe = (form: string) =>
    forms.speechStyle ? `Speech style: ${form}` : `Addresses the reader as “${form}”`;
  return [
    { value: "", label: "Automatic", description: "Follows the original text" },
    { value: "formal", label: forms.speechStyle ? "Polite" : "Formal", description: describe(forms.formal) },
    { value: "informal", label: forms.speechStyle ? "Plain" : "Informal", description: describe(forms.informal) },
  ];
}

/** The writing styles, the same for every language. */
export function styleOptions(): WordingOption[] {
  return [
    { value: "", label: "Automatic", description: "Keeps the style of the original" },
    ...STYLES.map(({ value, label, description }) => ({ value, label, description })),
  ];
}

/** A stored formality, kept only when it is still a known one. */
export function knownFormality(value: string | undefined): string {
  return FORMALITIES.some((formality) => formality === value) ? value! : "";
}

/** A stored style under its current name, or "" when it is no longer offered. */
export function knownStyle(value: string | undefined): string {
  const current = (value && LEGACY_STYLES[value]) || value;
  return STYLES.some((style) => style.value === current) ? current! : "";
}

/**
 * What to ask of a rewrite so the translation into `lang` has the chosen
 * formality and style. A formality is left out for a language that has none,
 * and a style on its own leaves the form of address alone, so the two choices
 * do not get in each other's way.
 */
export function wordingInstructions(lang: string, formality: string, style: string): string[] {
  const forms = register(lang);
  const chosenStyle = STYLES.find((option) => option.value === knownStyle(style));
  const instructions: string[] = [];
  if (forms && knownFormality(formality)) {
    const form = formality === "formal" ? forms.formal : forms.informal;
    instructions.push(
      forms.speechStyle
        ? `${formality === "formal" ? "Polite" : "Plain"} speech style (${form}) throughout: change the sentence endings and what depends on them, and leave the wording otherwise as it is.`
        : `${formality === "formal" ? "Formal" : "Informal"} address: address the reader as “${form}” throughout, with the pronouns, verb forms and possessives that go with it, and leave the wording otherwise as it is.`,
    );
  }
  if (chosenStyle) {
    instructions.push(chosenStyle.instruction.replaceAll("{language}", languageName(lang)));
    if (forms && !knownFormality(formality)) {
      instructions.push(`Keep the form of address (${forms.formal} or ${forms.informal}) the text already uses.`);
    }
  }
  return instructions;
}
