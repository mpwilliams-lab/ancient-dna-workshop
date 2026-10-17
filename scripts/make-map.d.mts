export type LonLat = [number, number];
export type FrameId = 'europe' | 'oldWorld' | 'europeWest';
export interface FrameSpec { lonMin: number; lonMax: number; latMin: number; latMax: number; lon0: number; lat0: number }
export interface Projection { frame: FrameId; k: number; offX: number; offY: number; pxMin: number; latMax: number; lon0: number; cosLat0: number }
export interface Output { frame: FrameId; source: string; tolerance: number; file: string; landName: string; projName: string; maxBytes: number }
export interface IslandBox { name: string; lonMin: number; lonMax: number; latMin: number; latMax: number }
export const MAP_VIEW: { width: number; height: number };
export const FRAMES: Readonly<Record<FrameId, FrameSpec>>;
export const NE_BASE: string;
export const NE_SHA256: Readonly<Record<string, string>>;
export const MIN_RING_AREA: number;
export const ISLAND_TOLERANCE_FACTOR: number;
export const KEEP_ISLANDS: readonly IslandBox[];
export const OUTPUTS: readonly Output[];
export function makeProjection(frame: FrameId): Projection;
export function project(c: Projection, lat: number, lon: number): { x: number; y: number };
export function r1(v: number): string;
export function ringArea(ring: readonly LonLat[]): number;
export function openRing(coords: readonly (readonly number[])[]): LonLat[];
export function clipRing(ring: readonly LonLat[], box: FrameSpec): LonLat[];
export function simplifyLine(pts: readonly LonLat[], tol: number): LonLat[];
export function simplifyRing(ring: readonly LonLat[], tol: number): LonLat[];
export function isKeptIsland(ring: readonly LonLat[]): boolean;
export function polygonsOf(geojson: unknown): number[][][][];
export function ringPath(ring: readonly LonLat[], c: Projection): string;
export function buildLand(geojson: unknown, frame: FrameId, tol: number): string[];
export function renderModule(out: Output, c: Projection, paths: readonly string[], sha: string): string;
