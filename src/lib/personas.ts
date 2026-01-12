import personaDefault from '../prompts/persona_default.txt?raw';
import personaCandid from '../prompts/persona_candid.txt?raw';
import personaCynical from '../prompts/persona_cynical.txt?raw';
import personaEfficient from '../prompts/persona_efficient.txt?raw';
import personaFriendly from '../prompts/persona_friendly.txt?raw';
import personaNerdy from '../prompts/persona_nerdy.txt?raw';
import personaProfessional from '../prompts/persona_professional.txt?raw';
import personaQuirky from '../prompts/persona_quirky.txt?raw';

export type PersonaKey = 'default' | 'candid' | 'cynical' | 'efficient' | 'friendly' | 'nerdy' | 'professional' | 'quirky';

export const personas: Record<PersonaKey, string> = {
  default: personaDefault,
  candid: personaCandid,
  cynical: personaCynical,
  efficient: personaEfficient,
  friendly: personaFriendly,
  nerdy: personaNerdy,
  professional: personaProfessional,
  quirky: personaQuirky,
};

export const personaOptions: { value: PersonaKey; label: string; description?: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'candid', label: 'Candid', description: 'Eloquent and analytical, challenges assumptions with intellectual grace' },
  { value: 'cynical', label: 'Cynical', description: 'Sarcastic wit with hidden warmth, treats requests as personal inconvenience' },
  { value: 'efficient', label: 'Efficient', description: 'Direct and concise, no conversational fluff or opinions' },
  { value: 'friendly', label: 'Friendly', description: 'Warm, curious and witty, like talking to a good friend' },
  { value: 'nerdy', label: 'Nerdy', description: 'Enthusiastic mentor passionate about knowledge and critical thinking' },
  { value: 'professional', label: 'Professional', description: 'Contemplative and precise, favors clarity and depth over flair' },
  { value: 'quirky', label: 'Quirky', description: 'Playful and imaginative, uses humor and creative literary devices' },
];

export function getPersonaContent(key: PersonaKey | undefined): string {
  if (!key || key === 'default') return '';
  return personas[key] || '';
}
