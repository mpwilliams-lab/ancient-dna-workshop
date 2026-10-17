// @vitest-environment node
// Spec §3.1-§3.4 (every card verbatim), §3 budget and content rules, §5.4 Vitest list, CONTRACT §4.10.
// RF3: the expected strings below are a second, independent copy of the approved text. A paraphrase in src/cards.ts fails here.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARDS, cardBodyWords, cardSource, cardStrings, cardUpgraded, cardVars, countWords, DISTRIBUTION_KEY_ORDER, DISTRIBUTION_SCALE_MAX,
  distributionRows, fillCard, formatCopies, g1Bullet2, romanDnaBullets, SAMPLE_CARD_VARS, type Card,
} from '../src/cards';
import { IRELAND_FOOTNOTE, MAP_SOURCE_SUFFIX, SILVA_2026_SHOWN, TRAIT_MAP_LABELS } from '../src/content';
import { ALL_OFF, ALL_ON, withFeatures } from '../src/features';
import { SCRIPT, SCRIPT_STEPS } from '../src/hints';
import { zoomFactor } from '../src/plotState';
import { CARD_IDS, GENE_IDS, TRAIT_MAP_LABEL_KEYS, type CardId, type GeneId, type TraitMapRow, type WorkshopData } from '../src/types';
import { ALLOWED_AGE_PHRASES, ruleViolations } from './contentRules';
import { cloneFixture, FIXTURE } from './fixtures/fixture';

const ROOT = resolve(__dirname, '..');

/** cardStrings() order: title, lead, bullets, tiles (name, caption, imageCaption), panel, columns, diagram labels, lines, puzzle, source, textForm lines, sideNote. */
const EXPECTED_STRINGS: Record<CardId, string[]> = {
  A1: [
    'Genes mirror geography',
    'On this map each dot is a whole group of people living in Europe today, placed by their DNA. A thin line joins it to where that group lives.',
    'North and south line up well; east and west only roughly, partly because we have no German, Dutch, Danish or Swiss groups.',
    "Small, isolated groups such as Basque and Saami people are left off: their DNA has drifted apart from their neighbours'.",
    'Britain is held back. You will place Britons later.',
    "Drawn from this workshop's data ({n_pops} groups, {n_people} people). The DNA map was turned and scaled to fit the real map as closely as possible. Inspired by Novembre et al. 2008. Map outline: Made with Natural Earth.",
  ],
  B1: [
    'Great circles of the First farmers / Stonehenge builders',
    'Some took many generations to finish.',
    'Stonehenge, Wiltshire', 'Still being rebuilt when the Beaker newcomers arrived.',
    'Avebury, Wiltshire', 'A huge ring of stones inside a great bank and ditch.',
    'Ring of Brodgar, Orkney', 'A great stone ring far to the north.',
    'Thornborough Henges, North Yorkshire', 'Three matching rings in a line.', 'Plan of the three rings, drawn for this workshop.',
    'Castlerigg, Cumbria', 'A ring of stones among the Lake District hills.',
    'Sources: English Heritage; Historic Environment Scotland.',
  ],
  C1: [
    'The Beaker people: new pots, new burials',
    'Named after their bell-shaped pots, called beakers, often decorated with twisted cord pressed into wet clay (Olalde et al. 2018).',
    "Each person was buried alone, curled on their side under a round mound, as steppe herders' descendants did (Fokkens & Nicolis 2012).",
    'Men were often buried with archery gear and copper daggers (Olalde et al. 2018).',
    'The Amesbury Archer and his grave goods (Salisbury Museum)',
    'A round burial mound on Overton Hill, Wiltshire',
    'A Beaker burial from Shrewton, near Stonehenge (Salisbury Museum)',
    'The Amesbury Archer',
    'Buried near Stonehenge in the richest grave found there, he grew up far away, possibly near the Alps: the chemistry of his teeth shows it (Evans et al. 2006; Wessex Archaeology).',
  ],
  D1: [
    "Where did the newcomers' steppe ancestry come from?",
    'Steppe herders lived on the grasslands north of the Black Sea and the Caspian Sea (Haak et al. 2015).',
    'People with their ancestry moved west into central Europe, mixed with farmers there and became the Corded Ware people (Haak et al. 2015).',
    "Beaker people whose closest DNA matches lived near the mouth of the Rhine (today's Netherlands) crossed to Britain. Much of their ancestry came from the steppe herders (Olalde et al. 2018).",
    'Arrows show where people came from, not exact routes.',
    'Pot-style origin: Olalde et al. 2018; Fokkens & Nicolis 2012. Map outline: Made with Natural Earth.',
  ],
  D2: [
    'Father-lines and mother-lines',
    'A Y chromosome passes from father to son: a father-line. Mitochondrial DNA passes from a mother to all her children: a mother-line.',
    'Before the Beaker newcomers, none of 33 men sampled in Britain carried the father-line R1b. Afterwards, more than 9 in 10 of 52 men did (Olalde et al. 2018).',
    'New mother-lines arrived too, so women came as well as men (Olalde et al. 2018).',
    'In Spain and Portugal it was different: more men than women seem to have moved there (Olalde et al. 2019).',
    'Y chromosome: father → son',
    'Mitochondrial DNA: mother → all her children',
  ],
  E1: [
    'A quieter migration: from France to southern Britain',
    "In the later Bronze Age, newcomers whose DNA was most like ancient French people's crossed into southern Britain, a few at a time over many generations.",
    'By the Iron Age, about half the ancestry of people in England and Wales came from them (35–56%, by region), but almost none in Scotland.',
    "Why only slightly? Their DNA was already quite like the locals', so on our map Britain moves only a little (Patterson et al. 2022).",
    'Patterson et al. 2022. Map outline: Made with Natural Earth.',
    'The earliest found so far were buried in Kent.',
  ],
  E2: [
    'Iron Age life',
    'Families lived in round houses, and many communities built hillforts ringed by banks and ditches.',
    'Later, in the Iron Age, new art styles like the swirling patterns on the Battersea Shield spread from the continent with few people moving (Patterson et al. 2022).',
    'About half the gene copies in Iron Age Britons carried the milk switch, against fewer than 1 in 10 in central Europe then (Patterson et al. 2022). Remember this for the milk plot!',
    'Inside a rebuilt Iron Age roundhouse (Little Woodbury, near Salisbury)',
    'Maiden Castle, a hillfort in Dorset, from the air',
    'The Battersea Shield (British Museum)',
  ],
  E3: [
    'Why does the Iron Age cloud look bigger?',
    "It isn't really bigger. For the Iron Age we zoomed in about {zoom}× on Britain, so the same spread fills more of the screen.",
    'There are also about {ratio}× as many Iron Age people ({n_IronAge} against {n_BellBeaker}), and people whose DNA was poorly preserved scatter furthest.',
    'Comparing only people with well-preserved DNA, the two clouds are the same size.',
    "This workshop's data.",
  ],
  F1: [
    'New rulers, mostly the same families',
    "Hadrian's Wall near Housesteads, Northumberland",
    'Medusa mosaic, Bignor Roman Villa, West Sussex',
    'Roman silver coins from the Hoxne Hoard, Suffolk (British Museum)',
    'What changed',
    "Roads, towns, villas, coins, Latin and Hadrian's Wall.",
    'What the DNA shows',
    'Most people buried in Roman Britain came from Iron Age British families: at least 7 in 10 of 259 in one large study (Silva et al. 2026, not yet peer reviewed).',
    'Newcomers, some from as far as the Middle East and the steppe, lived mostly in towns and forts. Country families mostly stayed the same (Martiniano et al. 2016; Silva et al. 2023; Scheib et al. 2024; Silva et al. 2026).',
    'Our {n_Roman} Roman-group people all sit inside the Iron Age cloud; one York man most like Middle Eastern people today is left out (Martiniano et al. 2016).',
  ],
  G1: [
    'After the Romans left: across the North Sea',
    'Families sailed from what is now northern Germany, the Netherlands and Denmark (Gretzinger et al. 2022).',
    'In Anglo-Saxon-period burials in England, about 3 in 4 parts of the DNA came from them, on average. Wales and Scotland changed much less (Gretzinger et al. 2022; Silva et al. 2026).',
    "Why doesn't Britain today look like this? Newcomers mixed with local families: people in England today carry about a quarter to a half of this ancestry (Gretzinger et al. 2022).",
    'Our Britain today people include some from Orkney, Cornwall and western Scotland, where less arrived.',
    'Arrows show where people came from, not exact routes. Map outline: Made with Natural Earth.',
  ],
  G2: [
    'Anglo-Saxon life: new things, new people, and a surprise',
    'New kinds of houses, brooches and burial customs, and a new language, Old English, came across the North Sea.',
    'Newcomers married local people. At Dover, a local British woman married into a newcomer family; her children and grandchildren had mixed ancestry (Gretzinger et al. 2022).',
    "Culture and DNA don't always match: at Oakington, near Cambridge, the richest Anglo-Saxon-style grave belonged to a woman whose DNA was local British (Schiffels et al. 2016).",
    'A replica of the Sutton Hoo helmet (British Museum)',
    'An Anglo-Saxon square-headed brooch (Metropolitan Museum of Art)',
    'Rebuilt Anglo-Saxon houses at West Stow, Suffolk',
  ],
  H1: [
    'Got milk? Most adults stop making the tool to digest it',
    'Milk contains a sugar called lactose. Babies make a tool, an enzyme called lactase, that cuts lactose into two smaller sugars.',
    'After weaning, most mammals switch lactase off, and so do about 2 in 3 adults worldwide (Itan et al. 2010).',
    'In some people, one DNA letter next to the lactase gene keeps the switch on for life. One copy is enough.',
    'Herders in Europe, East Africa and Arabia each have their own different switch letter, with the same result (Tishkoff et al. 2007; Liebert et al. 2017).',
    'A glass of milk',
    'A dairy cow',
  ],
  H2: [
    'The milk switch today',
    'Numbers show how many of every 100 copies carry the milk switch letter (Liebert et al. 2017).',
    'One copy is enough, so in the UK about 94 adults in 100 can digest milk (Liebert et al. 2017).',
    "The next plot follows this letter across all of West Eurasia, so its line ends lower than the UK's 75.",
    'Could the Bell Beaker people digest milk as adults? Guess the line from the Bell Beaker period to today, then press Enter to see it.',
    'Data: Liebert et al. 2017 (CC BY 4.0). Map outline: Made with Natural Earth.',
    'Ireland: small sample.',
  ],
  I1: [
    'Sunshine and skin colour',
    'Skin colour comes from melanin, a natural sunscreen made by pigment cells. SLC45A2 is one of many genes that help make it.',
    'One DNA letter change in SLC45A2 (scientists write it L374F) means less melanin and lighter skin.',
    'Your skin uses sunlight to make vitamin D for strong bones. Britain is cloudy, and farmers ate less vitamin-rich fish than hunters had (Mathieson & Terhorst 2022).',
    "Scientists' leading idea: lighter skin lets weak northern sunlight make more vitamin D (Mathieson & Terhorst 2022).",
    'A pigment cell (melanocyte) passing melanin to skin cells',
  ],
  I2: [
    'The light-skin version today',
    'Numbers show how many of every 100 copies of this gene carry the light-skin version.',
    'Many people in China and Japan have light skin too, but not from this version: look at their numbers.',
    'Skin colour is set by many genes and tells us nothing else about a person.',
    'The next plot covers all of West Eurasia. Flat, or climbing? A climb that goes on long after the big migrations points to natural selection.',
    'Data: 1000 Genomes Project; gnomAD. Map outline: Made with Natural Earth.',
  ],
  J1: [
    'Blue eyes: a dimmer switch for brown',
    'Eye colour comes from melanin in the iris. Brown eyes have plenty of it.',
    'The gene OCA2 makes that melanin possible. Next to it, inside a neighbouring gene called HERC2, sits a dimmer switch (Sturm et al. 2008).',
    'One letter in that switch turns OCA2 down. People with two "dim" copies almost never have brown eyes (Sturm et al. 2008).',
    'Every blue-eye copy seems to trace back to one change in one person (Eiberg et al. 2008), who is an ancestor of many brown-eyed people too.',
    'Brown, green and blue irises (drawn for this workshop)',
  ],
  J2: [
    'King Richard III: DNA as detective',
    'A skeleton found under a parking lot in Leicester, England, turned out to be King Richard III (King et al. 2014).',
    "His mother-line DNA matched living relatives on his mother's side: one of the clues that confirmed who he was (King et al. 2014).",
    'His DNA also predicted his looks: a 96% chance of blue eyes, and a 77% chance of blond hair, at least as a child (King et al. 2014).',
    'He is not on our maps: scientists read only small parts of his DNA, not his whole genome.',
  ],
  J3: [
    'The blue-eye version today',
    'Numbers show how many of every 100 copies carry the blue-eye switch.',
    'This line is for all of West Eurasia. Does the blue-eye version stay flat, or keep creeping up over many periods? A steady climb long after the big migrations is a sign of natural selection.',
    'Data: 1000 Genomes Project; gnomAD. Map outline: Made with Natural Earth.',
  ],
  K1: [
    'TYK2: a weak link against TB',
    'Tuberculosis (TB) is an infection caused by bacteria, usually in the lungs. It still kills more than a million people a year (Kerner et al. 2021).',
    'Your immune cells pass messages like runners in a relay. TYK2 is one of the runners that carries the "fight TB" message.',
    'One version of TYK2 drops part of the message. People with two copies are much more likely to become seriously ill with TB (Kerner et al. 2021).',
  ],
  K2: [
    'The TB-risk version today',
    "Numbers show how many of every 100 copies carry the TB-risk version. Some numbers, including Britain's, come from only a handful of copies, so they are rough.",
    'Today only about 3 to 4 in every 100 copies in Europe carry this version. Was it always this rare? Guess the shape: flat, rising, falling, or up then down?',
    'Data: gnomAD; 1000 Genomes Project. Europe (large sample) = gnomAD non-Finnish Europeans; Finland = gnomAD Finnish.',
  ],
  L1: [
    "When your body's security guards overreact to bread",
    'Your immune system has ID checkers called HLA molecules. They show bits of protein to defence cells: friend or invader?',
    'One HLA type, DQ2, is very good at holding up pieces of gluten from wheat, barley and rye.',
    'About 1 in 100 people have coeliac (celiac) disease, where this makes the body attack its own gut lining (MedlinePlus).',
    'About 3 in 10 people carry these risk types, but few get coeliac disease (MedlinePlus). Genes load the dice; other things decide the roll.',
  ],
  L2: [
    "Beethoven's hair: a famous genome",
    "Scientists read composer Ludwig van Beethoven's whole genome from a lock of his hair (Begg et al. 2023).",
    'It made coeliac disease and lactose intolerance unlikely causes of his stomach troubles, but showed signs of a liver virus, hepatitis B, and liver-disease risk (Begg et al. 2023).',
    "Genes are not destiny: his DNA score for keeping a beat was lower than about 9 in 10 people's, yet he became a great composer (Wesseldijk et al. 2024).",
    'He is not on our maps: he was German, and this workshop is about Britain.',
  ],
  L3: [
    'The DQ2 marker today (Europe only)',
    'Numbers show how many of every 100 copies carry the DQ2 marker the next plot follows.',
    "We show Europe only: this marker's link to coeliac disease was measured in people of European ancestry (Akbari et al. 2026).",
    'This type makes coeliac disease much more likely. Did it fade away, stay the same, or spread over the last 4,000 years? What could make it worth having?',
    'Data: 1000 Genomes Project; gnomAD. Europe (large sample) = gnomAD non-Finnish Europeans. Map outline: Made with Natural Earth.',
  ],
};

/** CONTRACT §3 kind and flag table. */
const KIND_FEATURE: Record<CardId, [Card['kind'], Card['feature']]> = {
  A1: ['map', 'map.A1'], B1: ['slide', 'images.B1'], C1: ['slide', 'images.C1'], D1: ['map', 'map.D1'], D2: ['slide', undefined],
  E1: ['map', 'map.E1'], E2: ['slide', 'images.E2'], E3: ['slide', undefined], F1: ['slide', 'images.F1'], G1: ['map', 'map.G1'],
  G2: ['slide', 'images.G2'], H1: ['slide', 'images.H1'], H2: ['distribution', 'map.H2'], I1: ['slide', 'images.I1'],
  I2: ['distribution', 'map.I2'], J1: ['slide', 'images.J1'], J2: ['story', undefined], J3: ['distribution', 'map.J3'],
  K1: ['slide', undefined], K2: ['distribution', 'map.K2'], L1: ['slide', undefined], L2: ['story', undefined], L3: ['distribution', 'map.L3'],
};

/** Body words per card under the §3 count (lead, bullets, panel, columns, named-tile lines, lines, puzzle, textForm lines; citations removed). */
const EXPECTED_WORDS: Record<CardId, number> = {
  A1: 80, B1: 48, C1: 69, D1: 70, D2: 74, E1: 80, E2: 68, E3: 59, F1: 78, G1: 77, G2: 64,
  H1: 76, H2: 74, I1: 74, I2: 74, J1: 74, J2: 78, J3: 47, K1: 67, K2: 57, L1: 80, L2: 79, L3: 61,
};

const BEFORE_REGEX = /selection|advantage|rose|spread|once more common|over the last 4,000 years/i;
const NEVER_REGEX = /paternity|illegitim|affair|mismatch/i;
/** Rule 9: a card that shows a digit names a source somewhere in its text or source line. */
const SOURCE_NAMED = /\bet al\. \d{4}|\b[A-Z][A-Za-z]+ & [A-Z][A-Za-z]+ \d{4}|this workshop's data|MedlinePlus|1000 Genomes|gnomAD/i;
const TEMPLATE = /\{[A-Za-z_]+\}/g;

function rule9Ok(card: Card): boolean {
  const strings = cardStrings(card);
  const hasDigit = strings.some((s) => /\d/.test(s.replace(TEMPLATE, '')));
  return !hasDigit || SOURCE_NAMED.test(strings.join('\n'));
}
const beforeIds = (): CardId[] => SCRIPT_STEPS.flatMap((s) => (s.cards?.placement === 'before' ? s.cards.ids : []));
const bulletTexts = (card: Card): string[] => [...card.bullets.map((b) => b.text), ...(card.columns ?? []).flatMap((c) => c.bullets ?? [])];

describe('card ids and the script (spec §5.4)', () => {
  it('SCRIPT and SCRIPT_STEPS have the same length', () => {
    expect(SCRIPT_STEPS).toHaveLength(SCRIPT.length);
  });
  it('every CardId in SCRIPT_STEPS has a card; together they are CARD_IDS in order, each used once', () => {
    expect(SCRIPT_STEPS.flatMap((s) => s.cards?.ids ?? [])).toEqual([...CARD_IDS]);
    expect(Object.keys(CARDS).sort()).toEqual([...CARD_IDS].sort());
    for (const id of CARD_IDS) expect(CARDS[id].id).toBe(id);
  });
  it.each(CARD_IDS)('%s has the kind and upgrade flag of CONTRACT §3', (id) => {
    const [kind, feature] = KIND_FEATURE[id];
    expect(CARDS[id].kind).toBe(kind);
    expect(CARDS[id].feature).toBe(feature);
  });
  it('the "before" cards are exactly the trait cards H1-L3', () => {
    expect(beforeIds()).toEqual(['H1', 'H2', 'I1', 'I2', 'J1', 'J2', 'J3', 'K1', 'K2', 'L1', 'L2', 'L3']);
  });
});

describe('verbatim text (spec §3.1-§3.4)', () => {
  it.each(CARD_IDS)('%s holds exactly the approved strings', (id) => {
    expect(cardStrings(CARDS[id])).toEqual(EXPECTED_STRINGS[id]);
  });
  it('card-level chips (spec §3.5 chip table)', () => {
    const chips = Object.fromEntries(CARD_IDS.map((id) => [id, CARDS[id].chips ?? []]));
    expect(chips).toEqual({
      A1: [], B1: [], C1: ['CHIP_DNA_CHANGED', 'CHIP_CULTURE_CHANGED'], D1: [], D2: [], E1: ['CHIP_DNA_SLIGHT'], E2: [], E3: [],
      F1: ['CHIP_ROMAN'], G1: ['CHIP_DNA_CHANGED_EAST'], G2: [], H1: [], H2: [], I1: [], I2: [], J1: [], J2: [], J3: [],
      K1: [], K2: [], L1: [], L2: [], L3: [],
    });
  });
  it('the two "Culture changed, DNA did not" lines carry their chip (E2 bullet 2, G2 bullet 3)', () => {
    expect(CARDS.E2.bullets.map((b) => b.chip)).toEqual([undefined, 'CHIP_CULTURE_ONLY', undefined]);
    expect(CARDS.G2.bullets.map((b) => b.chip)).toEqual([undefined, undefined, 'CHIP_CULTURE_ONLY']);
    for (const id of CARD_IDS) if (id !== 'E2' && id !== 'G2') expect(CARDS[id].bullets.every((b) => b.chip === undefined), id).toBe(true);
  });
  it('tiles: image ids, optional tiles, the Thornborough image caption (spec §3.1-§3.4, §7.1)', () => {
    const tiles = Object.fromEntries(CARD_IDS.map((id) => [id, (CARDS[id].tiles ?? []).map((t) => `${t.image}${t.optional ? '?' : ''}`)]));
    expect(tiles).toEqual({
      A1: [], B1: ['stonehenge', 'avebury', 'ring-of-brodgar', 'thornborough-plan?', 'castlerigg?'],
      C1: ['amesbury-archer', 'round-barrow', 'shrewton-beaker?'], D1: [], D2: [], E1: [],
      E2: ['roundhouse', 'maiden-castle', 'battersea-shield'], E3: [], F1: ['hadrians-wall', 'bignor-medusa', 'hoxne-coins'],
      G1: [], G2: ['sutton-hoo-helmet', 'square-headed-brooch', 'west-stow'], H1: ['milk', 'cow'], H2: [], I1: ['melanocyte'],
      I2: [], J1: ['irises'], J2: [], J3: [], K1: [], K2: [], L1: [], L2: [], L3: [],
    });
    expect(CARDS.B1.tiles!.every((t) => t.name !== undefined)).toBe(true);
    expect(CARDS.B1.tiles![3]!.imageCaption).toBe('Plan of the three rings, drawn for this workshop.');
    for (const id of CARD_IDS) if (id !== 'B1') expect((CARDS[id].tiles ?? []).every((t) => t.name === undefined), id).toBe(true);
  });
  it('maps, diagram, value genes, text-form extensions and the F1 inset hook', () => {
    expect(Object.fromEntries(CARD_IDS.filter((id) => CARDS[id].map).map((id) => [id, CARDS[id].map]))).toEqual({
      A1: 'A1', D1: 'D1', E1: 'E1', G1: 'G1', H2: 'H2', I2: 'I2', J3: 'J3', K2: 'K2', L3: 'L3',
    });
    expect(Object.fromEntries(CARD_IDS.filter((id) => CARDS[id].values).map((id) => [id, CARDS[id].values]))).toEqual({
      H2: 'LCT', I2: 'SLC45A2', J3: 'HERC2', K2: 'TYK2', L3: 'HLA-DQ2',
    });
    expect(CARDS.D2.diagram?.id).toBe('fatherMotherLines');
    expect(CARDS.A1.textForm).toEqual({ hideSource: true });
    expect(CARDS.E1.textForm).toEqual({ lines: ['The earliest found so far were buried in Kent.'] });
    expect(CARDS.H2.sideNote).toBe(IRELAND_FOOTNOTE);
    expect(CARDS.F1.inset).toEqual({ map: 'F1inset', feature: 'romanInset' });
    expect(CARD_IDS.filter((id) => CARDS[id].cartoon !== undefined)).toEqual([]);   // P3, captions need the instructor's wording (O2)
    expect(CARDS.C1.panel?.title).toBe('The Amesbury Archer');
    expect(CARDS.F1.columns?.map((c) => c.heading)).toEqual(['What changed', 'What the DNA shows']);
  });
  it('field shape: the five distribution cards hold lines, a puzzle and a value list and no bullets; no other card has lines, a puzzle or values', () => {
    // The budget counts lead, bullets, lines and puzzle, and the before-card check exempts only `puzzle`, so a string in the wrong field would slip through.
    const DISTRIBUTION: CardId[] = ['H2', 'I2', 'J3', 'K2', 'L3'];
    const withField = (field: 'lines' | 'puzzle' | 'values'): CardId[] => CARD_IDS.filter((id) => CARDS[id][field] !== undefined);
    expect(withField('lines')).toEqual(DISTRIBUTION);
    expect(withField('puzzle')).toEqual(DISTRIBUTION);
    expect(withField('values')).toEqual(DISTRIBUTION);
    expect(CARD_IDS.filter((id) => CARDS[id].kind === 'distribution')).toEqual(DISTRIBUTION);
    expect(CARD_IDS.filter((id) => CARDS[id].bullets.length === 0)).toEqual(['B1', 'F1', ...DISTRIBUTION]);   // B1 is tiles, F1 is columns
    expect(CARD_IDS.filter((id) => CARDS[id].lead !== undefined)).toEqual(['A1', 'B1']);
  });
  it('open check 1 fallback: Silva et al. 2026 appears nowhere when SILVA_2026_SHOWN is false (spec §3.3)', () => {
    expect(SILVA_2026_SHOWN).toBe(true);
    expect(romanDnaBullets(true)).toEqual(CARDS.F1.columns![1]!.bullets);
    expect(g1Bullet2(true)).toBe(CARDS.G1.bullets[1]!.text);
    expect(romanDnaBullets(false)).toEqual([
      'Most people buried in Roman Britain came from Iron Age British families (Scheib et al. 2024; Martiniano et al. 2016).',
      'Newcomers, some from as far as the Middle East and the steppe, lived mostly in towns and forts. Country families mostly stayed the same (Martiniano et al. 2016; Silva et al. 2023; Scheib et al. 2024).',
      'Our {n_Roman} Roman-group people all sit inside the Iron Age cloud; one York man most like Middle Eastern people today is left out (Martiniano et al. 2016).',
    ]);
    expect(g1Bullet2(false)).toBe(
      'In Anglo-Saxon-period burials in England, about 3 in 4 parts of the DNA came from them, on average. Wales and Scotland changed much less (Gretzinger et al. 2022).',
    );
    for (const s of [...romanDnaBullets(false), g1Bullet2(false)]) {
      expect(s).not.toContain('Silva et al. 2026');
      expect(ruleViolations(fillCard(s, SAMPLE_CARD_VARS))).toEqual([]);
    }
  });
});

describe('content rules over every card string (spec §3, §9 rules 1-3, 11, 14)', () => {
  it.each(CARD_IDS)('%s: no rule violation, templates filled with the sample values and with the fixture', (id) => {
    for (const vars of [SAMPLE_CARD_VARS, cardVars(FIXTURE)]) {
      for (const s of cardStrings(CARDS[id])) expect(ruleViolations(fillCard(s, vars)), s).toEqual([]);
    }
  });
  it('rule 1: the one age phrase on any card is "over the last 4,000 years", once, in the L3 puzzle', () => {
    const hits: string[] = [];
    for (const id of CARD_IDS) for (const s of cardStrings(CARDS[id])) for (const phrase of ALLOWED_AGE_PHRASES) if (s.includes(phrase)) hits.push(`${id}: ${phrase}`);
    expect(hits).toEqual(['L3: over the last 4,000 years']);
    expect(CARDS.L3.puzzle).toContain('over the last 4,000 years');
  });
  it('rule 11 still catches "Britain today" called England, but not G1\'s "people in England today"', () => {
    expect(ruleViolations('Britain today (England today)').some((v) => v.startsWith('rule11'))).toBe(true);
    expect(ruleViolations('Points for modern England').some((v) => v.startsWith('rule11'))).toBe(true);
    expect(ruleViolations(CARDS.G1.bullets[2]!.text)).toEqual([]);
  });
  it('never on screen: no card says paternity, illegitimacy, an affair or a mismatch (rule 14)', () => {
    for (const id of CARD_IDS) for (const s of cardStrings(CARDS[id])) expect(s, `${id}: ${s}`).not.toMatch(NEVER_REGEX);
  });
  it('before cards never give away their puzzle: no "before" card text matches the regex (puzzle line exempt)', () => {
    for (const id of beforeIds()) {
      const card = CARDS[id];
      for (const s of cardStrings(card)) if (s !== card.puzzle) expect(s, `${id}: ${s}`).not.toMatch(BEFORE_REGEX);
    }
  });
  it('the before-card check really bites: the L3 puzzle (exempt) matches it', () => {
    expect(CARDS.L3.puzzle).toMatch(BEFORE_REGEX);
  });
  it('rule 9: every card that shows a digit names a source, or the digit comes from a {template}', () => {
    for (const id of CARD_IDS) expect(rule9Ok(CARDS[id]), id).toBe(true);
    const unsourced: Card = { id: 'K1', kind: 'slide', title: 'A test', bullets: [{ text: 'About 4 in 10 people.' }] };
    expect(rule9Ok(unsourced)).toBe(false);
    const templated: Card = { id: 'E3', kind: 'slide', title: 'A test', bullets: [{ text: 'Zoomed about {zoom}×.' }] };
    expect(rule9Ok(templated)).toBe(true);
  });
});

describe('card budget (spec §3: body <= 80 words, <= 4 bullets, <= 30 words per bullet)', () => {
  it('counts words the §3 way: citations in brackets are free, other brackets count, templates are one word', () => {
    expect(countWords('Hello world (Olalde et al. 2018).')).toBe(2);
    expect(countWords('A (Fokkens & Nicolis 2012) B')).toBe(2);
    expect(countWords('Rare (MedlinePlus).')).toBe(1);
    expect(countWords('About half (35–56%, by region), but none.')).toBe(7);
    expect(countWords('Zoomed in about {zoom}× on Britain')).toBe(6);
    expect(countWords('(scientists write it L374F) means')).toBe(5);
  });
  it.each(CARD_IDS)('%s is within budget (and its count is pinned)', (id) => {
    const card = CARDS[id];
    expect(cardBodyWords(card)).toBe(EXPECTED_WORDS[id]);
    expect(cardBodyWords(card)).toBeLessThanOrEqual(80);
    expect(bulletTexts(card).length).toBeLessThanOrEqual(4);
    for (const b of bulletTexts(card)) expect(countWords(b), b).toBeLessThanOrEqual(30);
  });
  it('titles, chips, sources, image captions and map labels are not counted; named-tile lines and textForm lines are', () => {
    const base: Card = { id: 'B1', kind: 'slide', title: 'Ten words in this title do not count at all here', bullets: [] };
    expect(cardBodyWords(base)).toBe(0);
    expect(cardBodyWords({ ...base, source: 'Five words in the source.', tiles: [{ image: 'avebury', caption: 'An image caption.' }] })).toBe(0);
    expect(cardBodyWords({ ...base, tiles: [{ image: 'avebury', name: 'Avebury', caption: 'Three words here.', imageCaption: 'Not counted.' }] })).toBe(3);
    expect(cardBodyWords({ ...base, textForm: { lines: ['Two words.'] } })).toBe(2);
  });
});

describe('templates (spec §3 {…} values)', () => {
  it('cardVars reads the fixture: zoom equals zoomFactor, ratio = round(IronAge / BellBeaker), period counts, no A1 fit yet', () => {
    const n = (id: string) => FIXTURE.periods.find((p) => p.id === id)!.n_pca;
    expect(cardVars(FIXTURE)).toEqual({
      zoom: String(zoomFactor(FIXTURE)),
      ratio: String(Math.round(n('IronAge') / n('BellBeaker'))),
      n_IronAge: String(n('IronAge')), n_BellBeaker: String(n('BellBeaker')), n_Roman: String(n('Roman')),
      n_pops: '', n_people: '',
    });
  });
  it('A1 source numbers come from europe_fit when the JSON has it', () => {
    const d: WorkshopData = { ...cloneFixture(), europe_fit: { n_pops: 26, n_people: 1234, r_lat: 0.91, r_lon: 0.74 } };
    expect(cardVars(d)).toMatchObject({ n_pops: '26', n_people: '1,234' });
  });
  it('zoom and ratio follow the plot\'s rules on numbers that tell the rules apart (smaller span ratio; round, not floor)', () => {
    const d = cloneFixture();
    d.frames = { europe: { xmin: 0, xmax: 12, ymin: 0, ymax: 18 }, britain: { xmin: 0, xmax: 3, ymin: 0, ymax: 3 } };   // spans 4× and 6×
    d.periods.find((p) => p.id === 'IronAge')!.n_pca = 371;
    d.periods.find((p) => p.id === 'BellBeaker')!.n_pca = 77;
    expect(zoomFactor(d)).toBe(4);
    expect(cardVars(d)).toMatchObject({ zoom: '4', ratio: '5', n_IronAge: '371', n_BellBeaker: '77' });   // 371 / 77 = 4.82
  });
  it('fillCard replaces every template and refuses an unknown one', () => {
    const vars = { ...SAMPLE_CARD_VARS, zoom: '5', ratio: '5' };
    expect(fillCard(CARDS.E3.bullets[0]!.text, vars)).toBe(
      "It isn't really bigger. For the Iron Age we zoomed in about 5× on Britain, so the same spread fills more of the screen.",
    );
    expect(fillCard('no templates here', vars)).toBe('no templates here');
    expect(() => fillCard('a {mystery} value', vars)).toThrow(/mystery/);
    for (const id of CARD_IDS) for (const s of cardStrings(CARDS[id])) expect(fillCard(s, SAMPLE_CARD_VARS)).not.toMatch(/[{}]/);
  });
  it('SAMPLE_CARD_VARS are the current build numbers (spec §3: zoom 5, ratio 5, 371 against 77, 17 Roman, 26 groups)', () => {
    // n_pops / n_people: the Europe fit after the TSI coordinate override (26 groups, 716 people).
    expect(SAMPLE_CARD_VARS).toEqual({ zoom: '5', ratio: '5', n_IronAge: '371', n_BellBeaker: '77', n_Roman: '17', n_pops: '26', n_people: '716' });
  });
});

describe('upgrade flags and source lines (CONTRACT §4.10, decision 4)', () => {
  it('a card is upgradeable only through its own flag; text-only cards never are', () => {
    for (const id of CARD_IDS) {
      const card = CARDS[id];
      expect(cardUpgraded(card, ALL_OFF), id).toBe(false);
      expect(cardUpgraded(card, ALL_ON), id).toBe(card.feature !== undefined);
    }
    expect(cardUpgraded(CARDS.E1, withFeatures({ 'map.E1': true }, ALL_OFF))).toBe(true);
    expect(cardUpgraded(CARDS.E1, withFeatures({ 'map.D1': true }, ALL_OFF))).toBe(false);
  });
  it('text forms drop the Natural Earth suffix; A1 drops its source; upgraded forms keep the full line', () => {
    expect(MAP_SOURCE_SUFFIX).toBe('Map outline: Made with Natural Earth.');
    expect(cardSource(CARDS.E1, false)).toBe('Patterson et al. 2022.');
    expect(cardSource(CARDS.E1, true)).toBe('Patterson et al. 2022. Map outline: Made with Natural Earth.');
    expect(cardSource(CARDS.H2, false)).toBe('Data: Liebert et al. 2017 (CC BY 4.0).');
    expect(cardSource(CARDS.G1, false)).toBe('Arrows show where people came from, not exact routes.');
    expect(cardSource(CARDS.A1, false)).toBeUndefined();
    expect(cardSource(CARDS.A1, true)).toBe(CARDS.A1.source);
    expect(cardSource(CARDS.E3, false)).toBe("This workshop's data.");
    expect(cardSource(CARDS.K2, false)).toBe(CARDS.K2.source);   // no map suffix to drop
    expect(cardSource(CARDS.D2, false)).toBeUndefined();
    for (const id of CARD_IDS) expect(cardSource(CARDS[id], false) ?? '', id).not.toContain(MAP_SOURCE_SUFFIX);
  });
});

describe('distribution rows (spec §3.4, CONTRACT §2.3)', () => {
  it('labels: 33 keys, plain names, codes never shown', () => {
    expect(Object.keys(TRAIT_MAP_LABELS)).toEqual([...TRAIT_MAP_LABEL_KEYS]);
    expect(TRAIT_MAP_LABELS).toEqual({
      'country:Ireland': 'Ireland', 'country:Norway': 'Norway', 'country:UK': 'United Kingdom', 'country:Sweden': 'Sweden',
      'country:Netherlands': 'Netherlands', 'country:Finland': 'Finland', 'country:France': 'France', 'country:Germany': 'Germany',
      'country:Estonia': 'Estonia', 'country:Hungary': 'Hungary', 'country:Portugal': 'Portugal', 'country:Spain': 'Spain',
      'country:Poland': 'Poland', 'country:Russia': 'Russia', 'country:Romania': 'Romania', 'country:Macedonia': 'North Macedonia',
      'country:Belarus': 'Belarus', 'country:Ukraine': 'Ukraine', 'country:Italy': 'Italy', 'country:Greece': 'Greece',
      '1kg:GBR': 'Britain', '1kg:FIN': 'Finland', '1kg:TSI': 'Tuscany', '1kg:IBS': 'Spain', '1kg:PJL': 'Pakistan',
      '1kg:BEB': 'Bangladesh', '1kg:CHB': 'China', '1kg:JPT': 'Japan', '1kg:YRI': 'Nigeria', '1kg:LWK': 'Kenya',
      'gnomad:nfe': 'Europe (large sample)', 'gnomad:mid': 'Middle East', 'gnomad:fin': 'Finland',
    });
    for (const label of Object.values(TRAIT_MAP_LABELS)) expect(label).not.toMatch(/\b(GBR|FIN|TSI|IBS|PJL|BEB|CHB|JPT|YRI|LWK|nfe|mid|fin)\b/);
  });
  it('no two rows of one value list share a label (Finland and Spain each occur under two datasets, never twice on one card)', () => {
    for (const gene of GENE_IDS) {
      const labels = DISTRIBUTION_KEY_ORDER[gene].map((k) => TRAIT_MAP_LABELS[k]);
      expect(new Set(labels).size, gene).toBe(labels.length);
    }
  });
  it('key order per gene is the CONTRACT §2.3 table', () => {
    expect(DISTRIBUTION_KEY_ORDER).toEqual({
      LCT: ['country:Ireland', 'country:Norway', 'country:UK', 'country:Sweden', 'country:Netherlands', 'country:Finland', 'country:France',
        'country:Germany', 'country:Estonia', 'country:Hungary', 'country:Portugal', 'country:Spain', 'country:Poland', 'country:Russia',
        'country:Romania', 'country:Macedonia', 'country:Belarus', 'country:Ukraine', 'country:Italy', 'country:Greece'],
      SLC45A2: ['1kg:GBR', '1kg:TSI', '1kg:FIN', '1kg:IBS', 'gnomad:mid', '1kg:PJL', '1kg:BEB', '1kg:CHB', '1kg:LWK', '1kg:JPT', '1kg:YRI'],
      HERC2: ['1kg:FIN', '1kg:GBR', '1kg:TSI', '1kg:IBS', 'gnomad:mid', '1kg:PJL', '1kg:BEB', '1kg:CHB', '1kg:JPT', '1kg:YRI', '1kg:LWK'],
      TYK2: ['gnomad:nfe', '1kg:IBS', 'gnomad:mid', 'gnomad:fin', '1kg:TSI', '1kg:GBR', '1kg:CHB', '1kg:JPT', '1kg:YRI', '1kg:LWK'],
      'HLA-DQ2': ['1kg:IBS', 'gnomad:nfe', '1kg:TSI', '1kg:GBR', '1kg:FIN'],
    });
  });
  it('scale: copies per 100, TYK2 fixed at 0-15', () => {
    expect(DISTRIBUTION_SCALE_MAX).toEqual({ LCT: 100, SLC45A2: 100, HERC2: 100, TYK2: 15, 'HLA-DQ2': 100 });
  });
  it('formatCopies: whole copies per 100, TYK2 one decimal (O1: Britain is 5 of 182 copies, 0.02747, and shows 2.7)', () => {
    expect(formatCopies('LCT', 0.75)).toBe('75');
    expect(formatCopies('SLC45A2', 0.0051)).toBe('1');
    expect(formatCopies('HERC2', 0.004)).toBe('0');
    expect(formatCopies('HLA-DQ2', 0.0859)).toBe('9');
    expect(formatCopies('TYK2', 0.044)).toBe('4.4');
    expect(formatCopies('TYK2', 0.02747)).toBe('2.7');
    expect(formatCopies('TYK2', 0)).toBe('0.0');
    // the spec §3.4 K2 list, from the as-built data values: Europe 4.4, Spain 3.3, Middle East 3.1, Finland 2.9, Tuscany 2.8, Britain 2.7
    expect([0.044, 0.03271, 0.0306, 0.0287, 0.02804, 0.02747].map((v) => formatCopies('TYK2', v))).toEqual(['4.4', '3.3', '3.1', '2.9', '2.8', '2.7']);
  });
  const withRows = (gene: GeneId, rows: TraitMapRow[]): WorkshopData => {
    const d = cloneFixture();
    d.trait_maps[gene] = rows;
    return d;
  };
  it('shows only the rows present, sorted by value, ties in key order; coordinates pass through', () => {
    const d = withRows('HERC2', [
      { label_key: '1kg:LWK', lat: 0.6, lon: 34.8, value: 0, dataset: '1000g', allele_count: 0 },
      { label_key: '1kg:CHB', lat: 39.9, lon: 116.4, value: 0, dataset: '1000g', allele_count: 0 },
      { label_key: 'gnomad:mid', value: 0.2109, dataset: 'gnomad', allele_count: 62 },
      { label_key: '1kg:GBR', lat: 52.5, lon: -1.5, value: 0.8187, dataset: '1000g', allele_count: 149 },
    ]);
    expect(distributionRows(d, 'HERC2')).toEqual([
      { key: '1kg:GBR', label: 'Britain', value: 0.8187, display: '82', lat: 52.5, lon: -1.5 },
      { key: 'gnomad:mid', label: 'Middle East', value: 0.2109, display: '21' },
      { key: '1kg:CHB', label: 'China', value: 0, display: '0', lat: 39.9, lon: 116.4 },
      { key: '1kg:LWK', label: 'Kenya', value: 0, display: '0', lat: 0.6, lon: 34.8 },
    ]);
  });
  it('no rows for a gene with none in the JSON', () => {
    expect(distributionRows(withRows('TYK2', []), 'TYK2')).toEqual([]);
  });
  it.each(GENE_IDS)('%s on the fixture: one row per trait_maps row, values equal after rounding', (gene) => {
    const rows = distributionRows(FIXTURE, gene);
    expect(rows).toHaveLength(FIXTURE.trait_maps[gene].length);
    const sorted = [...FIXTURE.trait_maps[gene]].map((r) => r.value).sort((a, b) => b - a);
    expect(rows.map((r) => r.display)).toEqual(sorted.map((v) => formatCopies(gene, v)));
  });
});

describe('import rule (CONTRACT §4.1, decision 9)', () => {
  it('cards.ts imports nothing from content.ts at run time, and sharedText.ts is a leaf', () => {
    const cards = readFileSync(resolve(ROOT, 'src/cards.ts'), 'utf8');
    for (const line of cards.split('\n').filter((l) => /from '\.\/content'/.test(l))) expect(line).toMatch(/^import type /);
    expect(cards).not.toMatch(/from '\.\/plotState'/);
    const leaf = readFileSync(resolve(ROOT, 'src/sharedText.ts'), 'utf8');
    for (const line of leaf.split('\n').filter((l) => /^import /.test(l))) expect(line).toMatch(/^import type /);
  });
});
