// JSON contract for src/data/workshop_data.json (copied from the data build's out/workshop_data.json).
// Field names mirror the JSON exactly. Coordinates are rotated PC units (larger y = north).
// Times `t` are years before present (BP, 1950) and are INTERNAL ONLY: the app never renders them.

export type PeriodId = 'FirstFarmers' | 'BellBeaker' | 'BronzeAge' | 'IronAge' | 'Roman' | 'AngloSaxon' | 'Viking' | 'Today';
export type MapGroupId = 'Sardinian' | 'Spanish' | 'ItalianNorth' | 'French' | 'Norwegian';
export type GeneId = 'LCT' | 'SLC45A2' | 'HERC2' | 'TYK2' | 'HLA-DQ2';
export type SourceId = 'STEPPE' | 'FARMER' | 'WHG';
export type FrameId = 'europe' | 'britain';
export type ConsumerLabel = 'British' | 'Scandinavian' | 'French' | 'Iberian' | 'Italian';

export interface Pt { x: number; y: number }
export interface PeriodInfo { id: PeriodId; order: number; frame: FrameId; n_pca: number; n_admix: number; centre: Pt }
//   order: FirstFarmers 0, BellBeaker 1, BronzeAge 2, IronAge 3, Roman 4, AngloSaxon 5, Viking 6, Today 7
//   frame: europe for Today/FirstFarmers/BellBeaker; britain for BronzeAge/IronAge/Roman/AngloSaxon/Viking
export interface PersonPt extends Pt { east?: boolean }            // east only on AngloSaxon points (eastern-England highlight)
export interface PeriodPoints { period: PeriodId; points: PersonPt[] }
export interface MapGroup { id: MapGroupId; n: number; centre: Pt; points: Pt[] }   // rescaled to projected scale, then rotated
export interface Frame { xmin: number; xmax: number; ymin: number; ymax: number }
export interface AdmixBar { period: PeriodId; n: number; STEPPE: number; FARMER: number; WHG: number }
export interface AdmixShares { STEPPE: number; FARMER: number; WHG: number }
export interface ConsumerShare { label: ConsumerLabel; share: number }   // shares sum to 1 per period, sorted desc
export interface TraitPoint { t: number; f: number; lo: number; hi: number; n?: number; period?: PeriodId }
export interface Trait {
  gene: GeneId; rsid: string; variant_id: string; allele: string;
  source: 'ages' | 'local' | 'text';     // 'text' only allowed for HLA-DQ2 (text card)
  points: TraitPoint[];                  // ages: dense series (af, af_low, af_up) cropped to t <= ~4500; local: one per period bin; text: []
  present_day: number | null;            // frequency at the present-day end (for the TYK2 caption test etc.)
}
export interface AxisTick { t: number; key: 'BellBeaker' | 'BronzeAge' | 'IronAge' | 'Roman' | 'AngloSaxon' | 'Medieval' | 'Today' }
export interface LogNumbers {
  snps_total: number; snps_used: number; pca_samples_used: number;   // from noGBR.log
  admix_snps: number; admix_individuals: number;                     // from the fastmixture pilot
}
export interface WorkshopData {
  version: 1;
  periods: PeriodInfo[];                 // all 8
  points: PeriodPoints[];                // British individuals per period (projected, rotated)
  map_groups: MapGroup[];                // the 5 continental map groups
  north_sea: { n: number; centre: Pt };  // CNE proxy marker
  frames: Record<FrameId, Frame>;
  admixture: { bars: AdmixBar[]; people: Partial<Record<PeriodId, AdmixShares[]>>; beaker_steppe_pct: number };
  consumer: Partial<Record<PeriodId, ConsumerShare[]>>;   // every period, including Today (spec v2.1)
  traits: Trait[];                       // exactly 5, in GeneId order above
  trait_ticks: AxisTick[];
  logs: LogNumbers;
}

// ---- Runtime id lists (Task 6). Single source for every module that needs to iterate ids. ----
export const PERIOD_IDS: readonly PeriodId[] = ['FirstFarmers', 'BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Viking', 'Today'];
export const MAP_GROUP_IDS: readonly MapGroupId[] = ['Sardinian', 'Spanish', 'ItalianNorth', 'French', 'Norwegian'];
export const GENE_IDS: readonly GeneId[] = ['LCT', 'SLC45A2', 'HERC2', 'TYK2', 'HLA-DQ2'];
export const SOURCE_IDS: readonly SourceId[] = ['STEPPE', 'FARMER', 'WHG'];
export const FRAME_IDS: readonly FrameId[] = ['europe', 'britain'];
export const CONSUMER_LABELS: readonly ConsumerLabel[] = ['British', 'Scandinavian', 'French', 'Iberian', 'Italian'];
export const TICK_KEYS: readonly AxisTick['key'][] = ['BellBeaker', 'BronzeAge', 'IronAge', 'Roman', 'AngloSaxon', 'Medieval', 'Today'];
export const PERIOD_FRAME: Readonly<Record<PeriodId, FrameId>> = {
  FirstFarmers: 'europe', BellBeaker: 'europe', BronzeAge: 'britain', IronAge: 'britain',
  Roman: 'britain', AngloSaxon: 'britain', Viking: 'britain', Today: 'europe',
};

// ---- v3 app ids (CONTRACT §3). Chips: Task 3. Steps, cards, images, maps, diagrams: Task 4. ----
export type ChipKey = 'CHIP_DNA_CHANGED' | 'CHIP_CULTURE_CHANGED' | 'CHIP_DNA_SLIGHT' | 'CHIP_CULTURE_ONLY'
  | 'CHIP_ROMAN' | 'CHIP_DNA_CHANGED_EAST';
export type ChipIcon = 'dna' | 'pot';

/** The 19 guided steps of spec v3 §2.1, in script order (hints.ts SCRIPT_STEPS carries one per SCRIPT command). */
export type StepId =
  | 'hook' | 'load' | 'europe' | 'firstFarmers' | 'bellBeaker' | 'admix1' | 'bronzeAge' | 'ironAge' | 'consumerIA'
  | 'revealPca' | 'revealAdmix' | 'roman' | 'angloSaxon' | 'finale' | 'lct' | 'slc45a2' | 'herc2' | 'tyk2' | 'hla';
export const STEP_IDS: readonly StepId[] = [
  'hook', 'load', 'europe', 'firstFarmers', 'bellBeaker', 'admix1', 'bronzeAge', 'ironAge', 'consumerIA',
  'revealPca', 'revealAdmix', 'roman', 'angloSaxon', 'finale', 'lct', 'slc45a2', 'herc2', 'tyk2', 'hla',
];

/** The 23 cards of spec v3 §3, in script order. */
export type CardId = 'A1' | 'B1' | 'C1' | 'D1' | 'D2' | 'E1' | 'E2' | 'E3' | 'F1' | 'G1' | 'G2'
  | 'H1' | 'H2' | 'I1' | 'I2' | 'J1' | 'J2' | 'J3' | 'K1' | 'K2' | 'L1' | 'L2' | 'L3';
export const CARD_IDS: readonly CardId[] = [
  'A1', 'B1', 'C1', 'D1', 'D2', 'E1', 'E2', 'E3', 'F1', 'G1', 'G2',
  'H1', 'H2', 'I1', 'I2', 'J1', 'J2', 'J3', 'K1', 'K2', 'L1', 'L2', 'L3',
];

export type ImageId =
  | 'stonehenge' | 'avebury' | 'ring-of-brodgar' | 'thornborough-plan' | 'castlerigg'          // B1
  | 'amesbury-archer' | 'round-barrow' | 'shrewton-beaker'                                     // C1
  | 'roundhouse' | 'maiden-castle' | 'battersea-shield'                                        // E2
  | 'hadrians-wall' | 'bignor-medusa' | 'hoxne-coins'                                          // F1
  | 'sutton-hoo-helmet' | 'square-headed-brooch' | 'west-stow'                                 // G2
  | 'milk' | 'cow'                                                                             // H1
  | 'melanocyte'                                                                               // I1
  | 'irises'                                                                                   // J1 (own SVG)
  | 'lactase-scissors' | 'tb-relay' | 'wheat';                                                 // P3 cartoons (own SVG)
export type MapId = 'A1' | 'D1' | 'E1' | 'G1' | 'H2' | 'I2' | 'J3' | 'K2' | 'L3' | 'F1inset';
export type DiagramId = 'fatherMotherLines';
export type DistributionId = GeneId;
