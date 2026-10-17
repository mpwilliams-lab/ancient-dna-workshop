import type { ImageEntry, LicenceId } from '../src/assetManifest';

export interface CropBox { x: number; y: number; width: number; height: number }
export interface StageEntry { id: string; orientation: 'landscape' | 'portrait'; crop: CropBox | null }
export interface Dirs { raw: string; staged: string; img: string }
export interface StagedImage { staged: string; size: number; quality: number }
export interface Fetched extends StagedImage {
  sha: string;
  type: string;
  real: { width: number; height: number };
  meta: { url: string; width: number; height: number; mime: string };
}
/** The two network calls the script makes; tests pass stand-ins. */
export interface Network {
  getJson(url: string): Promise<unknown>;
  download(url: string): Promise<{ buf: Buffer; type: string }>;
}

export const PATHS: { manifest: string; raw: string; staged: string; img: string };
export const LICENCE_URLS: Readonly<Record<LicenceId, string | null>>;
export const MEDIA_PREFIXES: readonly string[];
export const UPLOAD_PREFIX: string;
export const THUMB_PREFIX: string;
export const COMMONS_API: string;
export const USER_AGENT: string;
export const THUMB_WIDTH: number;
export const PORTRAIT_HEIGHT: number;
export const QUALITIES: readonly number[];
export const IMAGE_MAX_BYTES: number;
export const MAX_DOWNLOAD_BYTES: number;
export const NETWORK: Network;
export function thumbApiUrl(commonsFile: string): string;
export function isMediaUrl(url: unknown): boolean;
export function thumbFromApi(json: unknown): { url: string; width: number; height: number; mime: string };
export function parseSipsSize(output: string): { width: number; height: number };
export function imageSize(path: string): { width: number; height: number };
export function orientationOf(width: number, height: number): 'landscape' | 'portrait';
export function scaleCrop(crop: CropBox, factor: number, width: number, height: number): CropBox;
export function cropFits(crop: CropBox, width: number, height: number): boolean;
export function sipsSteps(entry: StageEntry, rawPath: string, stagedPath: string, quality: number): string[][];
export function titleOf(commonsFile: string): string;
export function commonsFilePage(name: string): string;
export function useFallback(entry: ImageEntry): ImageEntry;
export function freshRawDir(dirs: Pick<Dirs, 'raw' | 'staged'>, clean: boolean): void;
export function stageImage(entry: StageEntry, rawPath: string, stagedDir: string): StagedImage;
export function fetchEntry(entry: ImageEntry, io?: Network, dirs?: Pick<Dirs, 'raw' | 'staged'>): Promise<Fetched>;
export function promote(manifest: { images: ImageEntry[] }, dirs?: Pick<Dirs, 'staged' | 'img'>): string[];
