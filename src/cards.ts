// The 23 auto cards of spec §3.1-§3.4, copied VERBATIM (spec §5.1, CONTRACT §4.10). Text and data only:
// src/cardView.ts draws them. Every string here is scanned by allRenderableStrings() in content.ts.
// Import rule (CONTRACT §4.1): nothing from content.ts at run time (content.ts imports this module); the values both
// modules need at load time come from the leaf module sharedText.ts. No plotState import either (it imports content.ts).
import type {
  CardId, ChipKey, DiagramId, DistributionId, GeneId, ImageId, MapId, PeriodId, TraitMapLabelKey, WorkshopData,
} from './types';
import { TRAIT_MAP_ORDER } from './types';
import { FEATURES, type FeatureFlag, type Features } from './features';
import { IRELAND_FOOTNOTE, MAP_SOURCE_SUFFIX, SILVA_2026_SHOWN, TRAIT_MAP_LABELS } from './sharedText';

export type CardKind = 'slide' | 'map' | 'story' | 'distribution';
export interface CardBullet { text: string; chip?: ChipKey }
export interface CardTile {
  image: ImageId;
  name?: string;            // tile name (B1); when present, `caption` is the tile's one line and COUNTS as body words
  caption: string;          // without `name`: an image caption (NOT counted)
  imageCaption?: string;    // extra image caption under a named tile (B1 Thornborough); not counted, not shown in the text form
  optional?: boolean;       // hidden first under `compact`; C1 Shrewton also hidden whenever the Archer image shows
}
export type CardVar = 'zoom' | 'ratio' | 'n_IronAge' | 'n_BellBeaker' | 'n_Roman' | 'n_pops' | 'n_people';
export interface Card {
  id: CardId; kind: CardKind; title: string;
  lead?: string; bullets: CardBullet[];
  tiles?: CardTile[];
  panel?: { title: string; text: string };
  columns?: { heading: string; text?: string; bullets?: string[] }[];   // F1
  diagram?: { id: DiagramId; labels: string[] };                         // D2
  map?: MapId; values?: DistributionId; lines?: string[]; puzzle?: string;
  chips?: ChipKey[]; source?: string;
  feature?: FeatureFlag;                                                  // absent on D2, E3, J2, K1, L1, L2
  // contract extensions (all rendered strings, all scanned):
  textForm?: { lines?: string[]; hideSource?: boolean };  // applied only while the upgraded form is not shown
  sideNote?: string;                                      // H2: IRELAND_FOOTNOTE, under the value list / side list
  inset?: { map: 'F1inset'; feature: 'romanInset' };     // F1 only (P3, Task 29)
  cartoon?: { image: 'lactase-scissors' | 'tb-relay' | 'wheat'; caption: string };   // P3 (Task 30); caption needs the instructor's wording
}

/** F1 "What the DNA shows" (spec §3.3). silva = false is the open-check-1 fallback: Silva et al. 2026 appears nowhere. */
export function romanDnaBullets(silva: boolean): string[] {
  return [
    silva
      ? 'Most people buried in Roman Britain came from Iron Age British families: at least 7 in 10 of 259 in one large study (Silva et al. 2026, not yet peer reviewed).'
      : 'Most people buried in Roman Britain came from Iron Age British families (Scheib et al. 2024; Martiniano et al. 2016).',
    silva
      ? 'Newcomers, some from as far as the Middle East and the steppe, lived mostly in towns and forts. Country families mostly stayed the same (Martiniano et al. 2016; Silva et al. 2023; Scheib et al. 2024; Silva et al. 2026).'
      : 'Newcomers, some from as far as the Middle East and the steppe, lived mostly in towns and forts. Country families mostly stayed the same (Martiniano et al. 2016; Silva et al. 2023; Scheib et al. 2024).',
    'Our {n_Roman} Roman-group people all sit inside the Iron Age cloud; one York man most like Middle Eastern people today is left out (Martiniano et al. 2016).',
  ];
}

/** G1 bullet 2 (spec §3.3); without Silva et al. 2026 it cites Gretzinger et al. 2022 only. */
export function g1Bullet2(silva: boolean): string {
  return silva
    ? 'In Anglo-Saxon-period burials in England, about 3 in 4 parts of the DNA came from them, on average. Wales and Scotland changed much less (Gretzinger et al. 2022; Silva et al. 2026).'
    : 'In Anglo-Saxon-period burials in England, about 3 in 4 parts of the DNA came from them, on average. Wales and Scotland changed much less (Gretzinger et al. 2022).';
}

export const CARDS: Readonly<Record<CardId, Card>> = {
  // ---- §3.1 Europe, monuments and Beaker cards ----
  A1: {
    id: 'A1', kind: 'map', feature: 'map.A1', map: 'A1',
    title: 'Genes mirror geography',
    lead: 'On this map each dot is a whole group of people living in Europe today, placed by their DNA. A thin line joins it to where that group lives.',
    bullets: [
      { text: 'North and south line up well; east and west only roughly, partly because we have no German, Dutch, Danish or Swiss groups.' },
      { text: "Small, isolated groups such as Basque and Saami people are left off: their DNA has drifted apart from their neighbours'." },
      { text: 'Britain is held back. You will place Britons later.' },
    ],
    source: "Drawn from this workshop's data ({n_pops} groups, {n_people} people). The DNA map was turned and scaled to fit the real map as closely as possible. Inspired by Novembre et al. 2008. Map outline: Made with Natural Earth.",
    textForm: { hideSource: true },
  },
  B1: {
    id: 'B1', kind: 'slide', feature: 'images.B1',
    title: 'Great circles of the First farmers / Stonehenge builders',
    lead: 'Some took many generations to finish.',
    bullets: [],
    tiles: [
      { image: 'stonehenge', name: 'Stonehenge, Wiltshire', caption: 'Still being rebuilt when the Beaker newcomers arrived.' },
      { image: 'avebury', name: 'Avebury, Wiltshire', caption: 'A huge ring of stones inside a great bank and ditch.' },
      { image: 'ring-of-brodgar', name: 'Ring of Brodgar, Orkney', caption: 'A great stone ring far to the north.' },
      { image: 'thornborough-plan', name: 'Thornborough Henges, North Yorkshire', caption: 'Three matching rings in a line.', imageCaption: 'Plan of the three rings, drawn for this workshop.', optional: true },
      { image: 'castlerigg', name: 'Castlerigg, Cumbria', caption: 'A ring of stones among the Lake District hills.', optional: true },
    ],
    source: 'Sources: English Heritage; Historic Environment Scotland.',
  },
  C1: {
    id: 'C1', kind: 'slide', feature: 'images.C1',
    title: 'The Beaker people: new pots, new burials',
    chips: ['CHIP_DNA_CHANGED', 'CHIP_CULTURE_CHANGED'],
    bullets: [
      { text: 'Named after their bell-shaped pots, called beakers, often decorated with twisted cord pressed into wet clay (Olalde et al. 2018).' },
      { text: "Each person was buried alone, curled on their side under a round mound, as steppe herders' descendants did (Fokkens & Nicolis 2012)." },
      { text: 'Men were often buried with archery gear and copper daggers (Olalde et al. 2018).' },
    ],
    panel: {
      title: 'The Amesbury Archer',
      text: 'Buried near Stonehenge in the richest grave found there, he grew up far away, possibly near the Alps: the chemistry of his teeth shows it (Evans et al. 2006; Wessex Archaeology).',
    },
    tiles: [
      { image: 'amesbury-archer', caption: 'The Amesbury Archer and his grave goods (Salisbury Museum)' },
      { image: 'round-barrow', caption: 'A round burial mound on Overton Hill, Wiltshire' },
      { image: 'shrewton-beaker', caption: 'A Beaker burial from Shrewton, near Stonehenge (Salisbury Museum)', optional: true },
    ],
  },
  // ---- §3.2 First ADMIXTURE, steppe route, father-lines; Bronze and Iron Age ----
  D1: {
    id: 'D1', kind: 'map', feature: 'map.D1', map: 'D1',
    title: "Where did the newcomers' steppe ancestry come from?",
    bullets: [
      { text: 'Steppe herders lived on the grasslands north of the Black Sea and the Caspian Sea (Haak et al. 2015).' },
      { text: 'People with their ancestry moved west into central Europe, mixed with farmers there and became the Corded Ware people (Haak et al. 2015).' },
      { text: "Beaker people whose closest DNA matches lived near the mouth of the Rhine (today's Netherlands) crossed to Britain. Much of their ancestry came from the steppe herders (Olalde et al. 2018)." },
      { text: 'Arrows show where people came from, not exact routes.' },
    ],
    source: 'Pot-style origin: Olalde et al. 2018; Fokkens & Nicolis 2012. Map outline: Made with Natural Earth.',
  },
  D2: {
    id: 'D2', kind: 'slide',
    title: 'Father-lines and mother-lines',
    diagram: { id: 'fatherMotherLines', labels: ['Y chromosome: father → son', 'Mitochondrial DNA: mother → all her children'] },
    bullets: [
      { text: 'A Y chromosome passes from father to son: a father-line. Mitochondrial DNA passes from a mother to all her children: a mother-line.' },
      { text: 'Before the Beaker newcomers, none of 33 men sampled in Britain carried the father-line R1b. Afterwards, more than 9 in 10 of 52 men did (Olalde et al. 2018).' },
      { text: 'New mother-lines arrived too, so women came as well as men (Olalde et al. 2018).' },
      { text: 'In Spain and Portugal it was different: more men than women seem to have moved there (Olalde et al. 2019).' },
    ],
  },
  E1: {
    id: 'E1', kind: 'map', feature: 'map.E1', map: 'E1',
    title: 'A quieter migration: from France to southern Britain',
    chips: ['CHIP_DNA_SLIGHT'],
    bullets: [
      { text: "In the later Bronze Age, newcomers whose DNA was most like ancient French people's crossed into southern Britain, a few at a time over many generations." },
      { text: 'By the Iron Age, about half the ancestry of people in England and Wales came from them (35–56%, by region), but almost none in Scotland.' },
      { text: "Why only slightly? Their DNA was already quite like the locals', so on our map Britain moves only a little (Patterson et al. 2022)." },
    ],
    source: 'Patterson et al. 2022. Map outline: Made with Natural Earth.',
    textForm: { lines: ['The earliest found so far were buried in Kent.'] },
  },
  E2: {
    id: 'E2', kind: 'slide', feature: 'images.E2',
    title: 'Iron Age life',
    bullets: [
      { text: 'Families lived in round houses, and many communities built hillforts ringed by banks and ditches.' },
      { text: 'Later, in the Iron Age, new art styles like the swirling patterns on the Battersea Shield spread from the continent with few people moving (Patterson et al. 2022).', chip: 'CHIP_CULTURE_ONLY' },
      { text: 'About half the gene copies in Iron Age Britons carried the milk switch, against fewer than 1 in 10 in central Europe then (Patterson et al. 2022). Remember this for the milk plot!' },
    ],
    tiles: [
      { image: 'roundhouse', caption: 'Inside a rebuilt Iron Age roundhouse (Little Woodbury, near Salisbury)' },
      { image: 'maiden-castle', caption: 'Maiden Castle, a hillfort in Dorset, from the air' },
      { image: 'battersea-shield', caption: 'The Battersea Shield (British Museum)' },
    ],
  },
  E3: {
    id: 'E3', kind: 'slide',
    title: 'Why does the Iron Age cloud look bigger?',
    bullets: [
      { text: "It isn't really bigger. For the Iron Age we zoomed in about {zoom}× on Britain, so the same spread fills more of the screen." },
      { text: 'There are also about {ratio}× as many Iron Age people ({n_IronAge} against {n_BellBeaker}), and people whose DNA was poorly preserved scatter furthest.' },
      { text: 'Comparing only people with well-preserved DNA, the two clouds are the same size.' },
    ],
    source: "This workshop's data.",
  },
  // ---- §3.3 Romans, Anglo-Saxons ----
  F1: {
    id: 'F1', kind: 'slide', feature: 'images.F1',
    title: 'New rulers, mostly the same families',
    chips: ['CHIP_ROMAN'],
    bullets: [],
    columns: [
      { heading: 'What changed', text: "Roads, towns, villas, coins, Latin and Hadrian's Wall." },
      { heading: 'What the DNA shows', bullets: romanDnaBullets(SILVA_2026_SHOWN) },
    ],
    tiles: [
      { image: 'hadrians-wall', caption: "Hadrian's Wall near Housesteads, Northumberland" },
      { image: 'bignor-medusa', caption: 'Medusa mosaic, Bignor Roman Villa, West Sussex' },
      { image: 'hoxne-coins', caption: 'Roman silver coins from the Hoxne Hoard, Suffolk (British Museum)' },
    ],
    inset: { map: 'F1inset', feature: 'romanInset' },
  },
  G1: {
    id: 'G1', kind: 'map', feature: 'map.G1', map: 'G1',
    title: 'After the Romans left: across the North Sea',
    chips: ['CHIP_DNA_CHANGED_EAST'],
    bullets: [
      { text: 'Families sailed from what is now northern Germany, the Netherlands and Denmark (Gretzinger et al. 2022).' },
      { text: g1Bullet2(SILVA_2026_SHOWN) },
      { text: "Why doesn't Britain today look like this? Newcomers mixed with local families: people in England today carry about a quarter to a half of this ancestry (Gretzinger et al. 2022)." },
      { text: 'Our Britain today people include some from Orkney, Cornwall and western Scotland, where less arrived.' },
    ],
    source: 'Arrows show where people came from, not exact routes. Map outline: Made with Natural Earth.',
  },
  G2: {
    id: 'G2', kind: 'slide', feature: 'images.G2',
    title: 'Anglo-Saxon life: new things, new people, and a surprise',
    bullets: [
      { text: 'New kinds of houses, brooches and burial customs, and a new language, Old English, came across the North Sea.' },
      { text: 'Newcomers married local people. At Dover, a local British woman married into a newcomer family; her children and grandchildren had mixed ancestry (Gretzinger et al. 2022).' },
      { text: "Culture and DNA don't always match: at Oakington, near Cambridge, the richest Anglo-Saxon-style grave belonged to a woman whose DNA was local British (Schiffels et al. 2016).", chip: 'CHIP_CULTURE_ONLY' },
    ],
    tiles: [
      { image: 'sutton-hoo-helmet', caption: 'A replica of the Sutton Hoo helmet (British Museum)' },
      { image: 'square-headed-brooch', caption: 'An Anglo-Saxon square-headed brooch (Metropolitan Museum of Art)' },
      { image: 'west-stow', caption: 'Rebuilt Anglo-Saxon houses at West Stow, Suffolk' },
    ],
  },
  // ---- §3.4 Trait cards (all "before" cards) ----
  H1: {
    id: 'H1', kind: 'slide', feature: 'images.H1',
    title: 'Got milk? Most adults stop making the tool to digest it',
    bullets: [
      { text: 'Milk contains a sugar called lactose. Babies make a tool, an enzyme called lactase, that cuts lactose into two smaller sugars.' },
      { text: 'After weaning, most mammals switch lactase off, and so do about 2 in 3 adults worldwide (Itan et al. 2010).' },
      { text: 'In some people, one DNA letter next to the lactase gene keeps the switch on for life. One copy is enough.' },
      { text: 'Herders in Europe, East Africa and Arabia each have their own different switch letter, with the same result (Tishkoff et al. 2007; Liebert et al. 2017).' },
    ],
    tiles: [
      { image: 'milk', caption: 'A glass of milk' },
      { image: 'cow', caption: 'A dairy cow' },
    ],
  },
  H2: {
    id: 'H2', kind: 'distribution', feature: 'map.H2', map: 'H2', values: 'LCT',
    title: 'The milk switch today',
    bullets: [],
    lines: [
      'Numbers show how many of every 100 copies carry the milk switch letter (Liebert et al. 2017).',
      'One copy is enough, so in the UK about 94 adults in 100 can digest milk (Liebert et al. 2017).',
      // Open check 15 (spec §11): backed by the LCT present-day < 0.75 test in tests/real-data.test.ts. If that test fails,
      // this line becomes 'The next plot follows this letter across all of West Eurasia.' and the instructor is told.
      "The next plot follows this letter across all of West Eurasia, so its line ends lower than the UK's 75.",
    ],
    puzzle: 'Could the Bell Beaker people digest milk as adults? Guess the line from the Bell Beaker period to today, then press Enter to see it.',
    source: 'Data: Liebert et al. 2017 (CC BY 4.0). Map outline: Made with Natural Earth.',
    sideNote: IRELAND_FOOTNOTE,
  },
  I1: {
    id: 'I1', kind: 'slide', feature: 'images.I1',
    title: 'Sunshine and skin colour',
    bullets: [
      { text: 'Skin colour comes from melanin, a natural sunscreen made by pigment cells. SLC45A2 is one of many genes that help make it.' },
      { text: 'One DNA letter change in SLC45A2 (scientists write it L374F) means less melanin and lighter skin.' },
      { text: 'Your skin uses sunlight to make vitamin D for strong bones. Britain is cloudy, and farmers ate less vitamin-rich fish than hunters had (Mathieson & Terhorst 2022).' },
      { text: "Scientists' leading idea: lighter skin lets weak northern sunlight make more vitamin D (Mathieson & Terhorst 2022)." },
    ],
    tiles: [{ image: 'melanocyte', caption: 'A pigment cell (melanocyte) passing melanin to skin cells' }],
  },
  I2: {
    id: 'I2', kind: 'distribution', feature: 'map.I2', map: 'I2', values: 'SLC45A2',
    title: 'The light-skin version today',
    bullets: [],
    lines: [
      'Numbers show how many of every 100 copies of this gene carry the light-skin version.',
      'Many people in China and Japan have light skin too, but not from this version: look at their numbers.',
      'Skin colour is set by many genes and tells us nothing else about a person.',
    ],
    puzzle: 'The next plot covers all of West Eurasia. Flat, or climbing? A climb that goes on long after the big migrations points to natural selection.',
    source: 'Data: 1000 Genomes Project; gnomAD. Map outline: Made with Natural Earth.',
  },
  J1: {
    id: 'J1', kind: 'slide', feature: 'images.J1',
    title: 'Blue eyes: a dimmer switch for brown',
    bullets: [
      { text: 'Eye colour comes from melanin in the iris. Brown eyes have plenty of it.' },
      { text: 'The gene OCA2 makes that melanin possible. Next to it, inside a neighbouring gene called HERC2, sits a dimmer switch (Sturm et al. 2008).' },
      { text: 'One letter in that switch turns OCA2 down. People with two "dim" copies almost never have brown eyes (Sturm et al. 2008).' },
      { text: 'Every blue-eye copy seems to trace back to one change in one person (Eiberg et al. 2008), who is an ancestor of many brown-eyed people too.' },
    ],
    tiles: [{ image: 'irises', caption: 'Brown, green and blue irises (drawn for this workshop)' }],
  },
  J2: {
    id: 'J2', kind: 'story',
    title: 'King Richard III: DNA as detective',
    bullets: [
      { text: 'A skeleton found under a parking lot in Leicester, England, turned out to be King Richard III (King et al. 2014).' },
      { text: "His mother-line DNA matched living relatives on his mother's side: one of the clues that confirmed who he was (King et al. 2014)." },
      { text: 'His DNA also predicted his looks: a 96% chance of blue eyes, and a 77% chance of blond hair, at least as a child (King et al. 2014).' },
      { text: 'He is not on our maps: scientists read only small parts of his DNA, not his whole genome.' },
    ],
  },
  J3: {
    id: 'J3', kind: 'distribution', feature: 'map.J3', map: 'J3', values: 'HERC2',
    title: 'The blue-eye version today',
    bullets: [],
    lines: ['Numbers show how many of every 100 copies carry the blue-eye switch.'],
    puzzle: 'This line is for all of West Eurasia. Does the blue-eye version stay flat, or keep creeping up over many periods? A steady climb long after the big migrations is a sign of natural selection.',
    source: 'Data: 1000 Genomes Project; gnomAD. Map outline: Made with Natural Earth.',
  },
  K1: {
    id: 'K1', kind: 'slide',
    title: 'TYK2: a weak link against TB',
    bullets: [
      { text: 'Tuberculosis (TB) is an infection caused by bacteria, usually in the lungs. It still kills more than a million people a year (Kerner et al. 2021).' },
      { text: 'Your immune cells pass messages like runners in a relay. TYK2 is one of the runners that carries the "fight TB" message.' },
      { text: 'One version of TYK2 drops part of the message. People with two copies are much more likely to become seriously ill with TB (Kerner et al. 2021).' },
    ],
  },
  K2: {
    id: 'K2', kind: 'distribution', feature: 'map.K2', map: 'K2', values: 'TYK2',
    title: 'The TB-risk version today',
    bullets: [],
    lines: ["Numbers show how many of every 100 copies carry the TB-risk version. Some numbers, including Britain's, come from only a handful of copies, so they are rough."],
    puzzle: 'Today only about 3 to 4 in every 100 copies in Europe carry this version. Was it always this rare? Guess the shape: flat, rising, falling, or up then down?',
    source: 'Data: gnomAD; 1000 Genomes Project. Europe (large sample) = gnomAD non-Finnish Europeans; Finland = gnomAD Finnish.',
  },
  L1: {
    id: 'L1', kind: 'slide',
    title: "When your body's security guards overreact to bread",
    bullets: [
      { text: 'Your immune system has ID checkers called HLA molecules. They show bits of protein to defence cells: friend or invader?' },
      { text: 'One HLA type, DQ2, is very good at holding up pieces of gluten from wheat, barley and rye.' },
      { text: 'About 1 in 100 people have coeliac (celiac) disease, where this makes the body attack its own gut lining (MedlinePlus).' },
      { text: 'About 3 in 10 people carry these risk types, but few get coeliac disease (MedlinePlus). Genes load the dice; other things decide the roll.' },
    ],
  },
  L2: {
    id: 'L2', kind: 'story',
    title: "Beethoven's hair: a famous genome",
    bullets: [
      { text: "Scientists read composer Ludwig van Beethoven's whole genome from a lock of his hair (Begg et al. 2023)." },
      { text: 'It made coeliac disease and lactose intolerance unlikely causes of his stomach troubles, but showed signs of a liver virus, hepatitis B, and liver-disease risk (Begg et al. 2023).' },
      { text: "Genes are not destiny: his DNA score for keeping a beat was lower than about 9 in 10 people's, yet he became a great composer (Wesseldijk et al. 2024)." },
      { text: 'He is not on our maps: he was German, and this workshop is about Britain.' },
    ],
  },
  L3: {
    id: 'L3', kind: 'distribution', feature: 'map.L3', map: 'L3', values: 'HLA-DQ2',
    title: 'The DQ2 marker today (Europe only)',
    bullets: [],
    lines: [
      'Numbers show how many of every 100 copies carry the DQ2 marker the next plot follows.',
      "We show Europe only: this marker's link to coeliac disease was measured in people of European ancestry (Akbari et al. 2026).",
    ],
    puzzle: 'This type makes coeliac disease much more likely. Did it fade away, stay the same, or spread over the last 4,000 years? What could make it worth having?',
    source: 'Data: 1000 Genomes Project; gnomAD. Europe (large sample) = gnomAD non-Finnish Europeans. Map outline: Made with Natural Earth.',
  },
};

// ---- Templates ----

/**
 * The values allRenderableStrings() fills templates with: the current build's numbers (spec §3). n_pops and n_people are the
 * Europe fit after the TSI coordinate override (26 groups, 716 people); tests/real-data.test.ts pins that cardVars(real) equals this.
 */
export const SAMPLE_CARD_VARS: Readonly<Record<CardVar, string>> = {
  zoom: '5', ratio: '5', n_IronAge: '371', n_BellBeaker: '77', n_Roman: '17', n_pops: '26', n_people: '716',
};

/**
 * Every {…} value is read from workshop_data.json at run time (spec §3 rule 9). zoom is the same formula as
 * plotState.zoomFactor (round(min(spanX_e/spanX_b, spanY_e/spanY_b))), computed here to keep cards.ts free of a run-time
 * plotState import; tests/cards.test.ts pins that the two agree. n_pops/n_people are '' until the JSON has europe_fit.
 */
export function cardVars(data: WorkshopData): Record<CardVar, string> {
  const n = (id: PeriodId): number => data.periods.find((p) => p.id === id)?.n_pca ?? 0;
  const e = data.frames.europe;
  const b = data.frames.britain;
  const zoom = Math.round(Math.min((e.xmax - e.xmin) / (b.xmax - b.xmin), (e.ymax - e.ymin) / (b.ymax - b.ymin)));
  const bb = n('BellBeaker');
  const fit = data.europe_fit;
  return {
    zoom: String(zoom),
    ratio: bb > 0 ? String(Math.round(n('IronAge') / bb)) : '',
    n_IronAge: String(n('IronAge')),
    n_BellBeaker: String(bb),
    n_Roman: String(n('Roman')),
    n_pops: fit ? String(fit.n_pops) : '',
    n_people: fit ? fit.n_people.toLocaleString('en-US') : '',
  };
}

const TEMPLATE = /\{([A-Za-z_]+)\}/g;

/** Replaces {zoom} etc.; throws on an unknown {name} so a typo in a card can never reach the screen. */
export function fillCard(text: string, vars: Readonly<Record<CardVar, string>>): string {
  return text.replace(TEMPLATE, (_m, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) throw new Error(`fillCard: unknown template {${name}}`);
    return vars[name as CardVar];
  });
}

/** Every renderable string of a card, templates unfilled, in a fixed order (tests pin it). */
export function cardStrings(card: Card): string[] {
  const out: string[] = [card.title];
  if (card.lead !== undefined) out.push(card.lead);
  for (const b of card.bullets) out.push(b.text);
  for (const t of card.tiles ?? []) {
    if (t.name !== undefined) out.push(t.name);
    out.push(t.caption);
    if (t.imageCaption !== undefined) out.push(t.imageCaption);
  }
  if (card.panel) out.push(card.panel.title, card.panel.text);
  for (const c of card.columns ?? []) {
    out.push(c.heading);
    if (c.text !== undefined) out.push(c.text);
    out.push(...(c.bullets ?? []));
  }
  out.push(...(card.diagram?.labels ?? []));
  out.push(...(card.lines ?? []));
  if (card.puzzle !== undefined) out.push(card.puzzle);
  if (card.source !== undefined) out.push(card.source);
  out.push(...(card.textForm?.lines ?? []));
  if (card.sideNote !== undefined) out.push(card.sideNote);
  if (card.cartoon) out.push(card.cartoon.caption);
  return out;
}

// ---- Budget (spec §3: body <= 80 words, <= 4 bullets, <= 30 words per bullet) ----

/** A bracketed group is a citation (not counted) iff it holds "et al.", "&", a 4-digit year or "MedlinePlus" (CONTRACT §4.10). */
function isCitation(inner: string): boolean {
  return /et al\.|&|\b\d{4}\b|MedlinePlus/.test(inner);
}

/** Words in one string under the §3 count: citations in brackets removed; a word is any token with a letter, digit or template. */
export function countWords(text: string): number {
  const stripped = text.replace(/\(([^()]*)\)/g, (m: string, inner: string) => (isCitation(inner) ? ' ' : m));
  return stripped.split(/\s+/).filter((w) => w !== '' && /[A-Za-z0-9{]/.test(w)).length;
}

/** Lead, bullets, panel text, column text and bullets, named-tile lines, lines, puzzle and textForm lines (spec §3, CONTRACT §4.10). */
export function cardBodyWords(card: Card): number {
  const parts: string[] = [];
  if (card.lead !== undefined) parts.push(card.lead);
  for (const b of card.bullets) parts.push(b.text);
  if (card.panel) parts.push(card.panel.text);
  for (const c of card.columns ?? []) {
    if (c.text !== undefined) parts.push(c.text);
    parts.push(...(c.bullets ?? []));
  }
  for (const t of card.tiles ?? []) if (t.name !== undefined) parts.push(t.caption);
  parts.push(...(card.lines ?? []));
  if (card.puzzle !== undefined) parts.push(card.puzzle);
  parts.push(...(card.textForm?.lines ?? []));
  return parts.reduce((n, s) => n + countWords(s), 0);
}

// ---- Upgrade flag and source line ----

/** The card has an upgrade (map or photos) and its flag is on. Whether the upgraded form is SHOWN also needs its assets (Tasks 15, 20). */
export function cardUpgraded(card: Card, features: Features = FEATURES): boolean {
  return card.feature !== undefined && features[card.feature];
}

/** Upgraded: the full source line. Text form: A1 shows none; map cards drop the trailing Natural Earth line (CONTRACT decision 4). K2's
 *  line (spec §3.4) never had one; cardView's sourceWithMapSuffix adds it when K2's map is drawn (spec §6, Task 27). */
export function cardSource(card: Card, upgraded: boolean): string | undefined {
  if (card.source === undefined) return undefined;
  if (upgraded) return card.source;
  if (card.textForm?.hideSource) return undefined;
  const suffix = ` ${MAP_SOURCE_SUFFIX}`;
  return card.source.endsWith(suffix) ? card.source.slice(0, -suffix.length) : card.source;
}

// ---- Distribution cards (spec §3.4, CONTRACT §2.3) ----

export interface DistributionRow { key: TraitMapLabelKey; label: string; value: number; display: string; lat?: number; lon?: number }

/** Copies per 100 at the right end of the value bars and the map scale: TYK2 is fixed at 0-15 (spec §3.4 K2). */
export const DISTRIBUTION_SCALE_MAX: Readonly<Record<GeneId, number>> = { LCT: 100, SLC45A2: 100, HERC2: 100, TYK2: 15, 'HLA-DQ2': 100 };

/** CONTRACT §2.3 key order per gene: the order ties are shown in. One table only: this is Task 7's TRAIT_MAP_ORDER
 *  (src/types.ts, which has no imports, so this run-time import adds no cycle). CONTRACT §8 R4. */
export const DISTRIBUTION_KEY_ORDER: Readonly<Record<GeneId, readonly TraitMapLabelKey[]>> = TRAIT_MAP_ORDER;

/** "Copies in every 100": whole numbers; TYK2 one decimal (Math.round(f * 1000) / 10). O1 (settled): the build writes TYK2 Britain
 *  as 5 of 182 copies, 0.02747, so it shows 2.7 as in the approved spec, with no display special case. */
export function formatCopies(gene: GeneId, freq: number): string {
  if (gene === 'TYK2') return (Math.round(freq * 1000) / 10).toFixed(1);
  return String(Math.round(freq * 100));
}

/** Only the rows present in data.trait_maps[gene]; sorted by value, largest first; ties in DISTRIBUTION_KEY_ORDER. */
export function distributionRows(data: WorkshopData, gene: GeneId): DistributionRow[] {
  const order = DISTRIBUTION_KEY_ORDER[gene];
  const rank = (k: TraitMapLabelKey): number => {
    const i = order.indexOf(k);
    return i < 0 ? order.length : i;
  };
  const rows = [...(data.trait_maps?.[gene] ?? [])];
  rows.sort((a, b) => b.value - a.value || rank(a.label_key) - rank(b.label_key));
  return rows.map((r) => {
    const row: DistributionRow = { key: r.label_key, label: TRAIT_MAP_LABELS[r.label_key], value: r.value, display: formatCopies(gene, r.value) };
    if (r.lat !== undefined) row.lat = r.lat;
    if (r.lon !== undefined) row.lon = r.lon;
    return row;
  });
}
