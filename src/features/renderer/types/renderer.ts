export interface Image {
  id: string;
  title?: string;

  created: Date | null;
  updated: Date | null;

  model: string;
  prompt: string;

  data: string; // Data URL (e.g., "data:image/png;base64,...")
}
