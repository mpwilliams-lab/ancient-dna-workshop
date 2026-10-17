export interface CheckableManifest {
  images: { id: string; kind: string; visual_check: unknown }[];
  maps: Record<string, { visual_check: unknown }>;
}
export interface Io {
  isTTY(): boolean;
  asker(): Promise<{ ask(question: string): Promise<string>; close(): void }>;
  log(line: string): void;
  error(line: string): void;
  now(): Date;
}
export const CHECKLIST: readonly string[];
export function localIso(d?: Pick<Date, 'getFullYear' | 'getMonth' | 'getDate' | 'getHours' | 'getMinutes' | 'getSeconds' | 'getTimezoneOffset'>): string;
export function parseArgs(argv: string[]): { reject: boolean; manifest: string | null; ids: string[] };
export function applyCheck(manifest: CheckableManifest, id: string, opts: { reject: boolean; at: string }): 'image' | 'map' | null;
export function main(argv: string[], io?: Io): Promise<number>;
