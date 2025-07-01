import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

const encoder = new Tiktoken(o200k_base);

export function calculateTokens(...texts: string[]): number {
  let total = 0;
  
  for (const text of texts) {
    if (!text || typeof text !== 'string') {
      continue;
    }
    
    try {
      const tokens = encoder.encode(text);
      total += tokens.length;
    } catch (error) {
      console.error('Error calculating tokens:', error);
    }
  }
  
  return total;
}
