import personaCandid from "@/prompts/persona_candid.txt?raw";
import personaCynical from "@/prompts/persona_cynical.txt?raw";
import personaDefault from "@/prompts/persona_default.txt?raw";
import personaEfficient from "@/prompts/persona_efficient.txt?raw";
import personaFriendly from "@/prompts/persona_friendly.txt?raw";
import personaNerdy from "@/prompts/persona_nerdy.txt?raw";
import personaProfessional from "@/prompts/persona_professional.txt?raw";
import personaQuirky from "@/prompts/persona_quirky.txt?raw";
import personaTeacher from "@/prompts/persona_teacher.txt?raw";

export type PersonaKey =
  | "default"
  | "candid"
  | "cynical"
  | "efficient"
  | "friendly"
  | "nerdy"
  | "professional"
  | "quirky"
  | "teacher";

export const personas: Record<PersonaKey, string> = {
  default: personaDefault,
  candid: personaCandid,
  cynical: personaCynical,
  efficient: personaEfficient,
  friendly: personaFriendly,
  nerdy: personaNerdy,
  professional: personaProfessional,
  quirky: personaQuirky,
  teacher: personaTeacher,
};

export const personaOptions: { value: PersonaKey; label: string; description?: string }[] = [
  { value: "default", label: "Default", description: "Warm, clear and direct, with detail matched to your needs" },
  {
    value: "candid",
    label: "Candid",
    description: "Direct and thoughtful, challenges assumptions with clear reasoning",
  },
  {
    value: "cynical",
    label: "Cynical",
    description: "Dry humor and mild sarcasm, with warmth when it matters",
  },
  { value: "efficient", label: "Efficient", description: "Direct and concise, with the detail needed to act" },
  { value: "friendly", label: "Friendly", description: "Warm, curious and witty, like talking to a good friend" },
  {
    value: "nerdy",
    label: "Nerdy",
    description: "Enthusiastic mentor passionate about knowledge and critical thinking",
  },
  {
    value: "professional",
    label: "Professional",
    description: "Contemplative and precise, favors clarity and depth over flair",
  },
  {
    value: "quirky",
    label: "Quirky",
    description: "Playful and imaginative, uses humor and creative literary devices",
  },
  {
    value: "teacher",
    label: "Teacher",
    description: "Patient and encouraging, breaks down concepts with clear examples",
  },
];

export function getPersonaContent(key: PersonaKey | undefined): string {
  return personas[key ?? "default"] || personaDefault;
}
