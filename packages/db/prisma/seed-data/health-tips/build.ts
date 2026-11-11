/**
 * Health-tip DRAFT content (UI Phase 3). Written from WHO fact sheets and
 * Tanzania Ministry of Health guidance; every tip is seeded as DRAFT and must
 * be reviewed by a verified doctor before it can be published.
 *
 * House rules for this content (checked by the content test):
 *  - no diagnosis, no medicine names with doses, no miracle claims;
 *  - every tip says when to see a health worker (and 112/115 for danger signs);
 *  - every tip cites at least one source (all links checked to resolve).
 */
import type { CreateHealthTipInput, HealthTipCategory, HealthTipIllustration } from '@daktari/schemas';
import { CATEGORY_ILLUSTRATION } from '@daktari/schemas';

export const SOURCES = {
  diet: ['WHO — Healthy diet', 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet'],
  salt: ['WHO — Salt reduction', 'https://www.who.int/news-room/fact-sheets/detail/salt-reduction'],
  malnutrition: ['WHO — Malnutrition', 'https://www.who.int/news-room/fact-sheets/detail/malnutrition'],
  anaemia: ['WHO — Anaemia', 'https://www.who.int/news-room/fact-sheets/detail/anaemia'],
  obesity: ['WHO — Obesity and overweight', 'https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight'],
  activity: ['WHO — Physical activity', 'https://www.who.int/news-room/fact-sheets/detail/physical-activity'],
  water: ['WHO — Drinking-water', 'https://www.who.int/news-room/fact-sheets/detail/drinking-water'],
  sanitation: ['WHO — Sanitation', 'https://www.who.int/news-room/fact-sheets/detail/sanitation'],
  cholera: ['WHO — Cholera', 'https://www.who.int/news-room/fact-sheets/detail/cholera'],
  diarrhoea: ['WHO — Diarrhoeal disease', 'https://www.who.int/news-room/fact-sheets/detail/diarrhoeal-disease'],
  typhoid: ['WHO — Typhoid', 'https://www.who.int/news-room/fact-sheets/detail/typhoid'],
  worms: ['WHO — Soil-transmitted helminth infections', 'https://www.who.int/news-room/fact-sheets/detail/soil-transmitted-helminth-infections'],
  schisto: ['WHO — Schistosomiasis', 'https://www.who.int/news-room/fact-sheets/detail/schistosomiasis'],
  oral: ['WHO — Oral health', 'https://www.who.int/news-room/fact-sheets/detail/oral-health'],
  depression: ['WHO — Depressive disorder', 'https://www.who.int/news-room/fact-sheets/detail/depression'],
  mental: ['WHO — Mental health', 'https://www.who.int/news-room/fact-sheets/detail/mental-health-strengthening-our-response'],
  anxiety: ['WHO — Anxiety disorders', 'https://www.who.int/news-room/fact-sheets/detail/anxiety-disorders'],
  suicide: ['WHO — Suicide', 'https://www.who.int/news-room/fact-sheets/detail/suicide'],
  alcohol: ['WHO — Alcohol', 'https://www.who.int/news-room/fact-sheets/detail/alcohol'],
  tobacco: ['WHO — Tobacco', 'https://www.who.int/news-room/fact-sheets/detail/tobacco'],
  dementia: ['WHO — Dementia', 'https://www.who.int/news-room/fact-sheets/detail/dementia'],
  epilepsy: ['WHO — Epilepsy', 'https://www.who.int/news-room/fact-sheets/detail/epilepsy'],
  hypertension: ['WHO — Hypertension', 'https://www.who.int/news-room/fact-sheets/detail/hypertension'],
  diabetes: ['WHO — Diabetes', 'https://www.who.int/news-room/fact-sheets/detail/diabetes'],
  cvd: ['WHO — Cardiovascular diseases', 'https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)'],
  asthma: ['WHO — Asthma', 'https://www.who.int/news-room/fact-sheets/detail/asthma'],
  kidney: ['WHO — Kidney disease', 'https://www.who.int/news-room/fact-sheets/detail/kidney-disease'],
  cancer: ['WHO — Cancer', 'https://www.who.int/news-room/fact-sheets/detail/cancer'],
  cervical: ['WHO — Cervical cancer', 'https://www.who.int/news-room/fact-sheets/detail/cervical-cancer'],
  breast: ['WHO — Breast cancer', 'https://www.who.int/news-room/fact-sheets/detail/breast-cancer'],
  hiv: ['WHO — HIV and AIDS', 'https://www.who.int/news-room/fact-sheets/detail/hiv-aids'],
  tb: ['WHO — Tuberculosis', 'https://www.who.int/news-room/fact-sheets/detail/tuberculosis'],
  hepb: ['WHO — Hepatitis B', 'https://www.who.int/news-room/fact-sheets/detail/hepatitis-b'],
  sti: ['WHO — Sexually transmitted infections', 'https://www.who.int/news-room/fact-sheets/detail/sexually-transmitted-infections-(stis)'],
  feeding: ['WHO — Infant and young child feeding', 'https://www.who.int/news-room/fact-sheets/detail/infant-and-young-child-feeding'],
  maternal: ['WHO — Maternal mortality', 'https://www.who.int/news-room/fact-sheets/detail/maternal-mortality'],
  newborn: ['WHO — Newborn mortality', 'https://www.who.int/news-room/fact-sheets/detail/newborn-mortality'],
  immunization: ['WHO — Immunization coverage', 'https://www.who.int/news-room/fact-sheets/detail/immunization-coverage'],
  measles: ['WHO — Measles', 'https://www.who.int/news-room/fact-sheets/detail/measles'],
  pneumonia: ['WHO — Pneumonia', 'https://www.who.int/news-room/fact-sheets/detail/pneumonia'],
  family: ['WHO — Family planning/contraception', 'https://www.who.int/news-room/fact-sheets/detail/family-planning-contraception'],
  dengue: ['WHO — Dengue and severe dengue', 'https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue'],
  malaria: ['WHO — Malaria', 'https://www.who.int/news-room/fact-sheets/detail/malaria'],
  road: ['WHO — Road traffic injuries', 'https://www.who.int/news-room/fact-sheets/detail/road-traffic-injuries'],
  drowning: ['WHO — Drowning', 'https://www.who.int/news-room/fact-sheets/detail/drowning'],
  rabies: ['WHO — Rabies', 'https://www.who.int/news-room/fact-sheets/detail/rabies'],
  snakebite: ['WHO — Snakebite envenoming', 'https://www.who.int/news-room/fact-sheets/detail/snakebite-envenoming'],
  amr: ['WHO — Antimicrobial resistance', 'https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance'],
  eyes: ['WHO — Blindness and vision impairment', 'https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment'],
  hearing: ['WHO — Deafness and hearing loss', 'https://www.who.int/news-room/fact-sheets/detail/deafness-and-hearing-loss'],
  moh: ['Wizara ya Afya Tanzania (Ministry of Health)', 'https://www.moh.go.tz'],
} as const satisfies Record<string, readonly [string, string]>;

export type SourceId = keyof typeof SOURCES;

interface Lang {
  /** Title. */
  t: string;
  /** One- or two-line summary. */
  s: string;
  /** "Why it matters" paragraph. */
  why: string;
  /** "What you can do" bullets. */
  do: string[];
  /** "When to see a health worker" paragraph. */
  when: string;
  /** Key takeaways. */
  k: string[];
}

export interface TipDraft {
  slug: string;
  priority?: number;
  illustration?: HealthTipIllustration;
  src: SourceId[];
  sw: Lang;
  en: Lang;
}

const HEADINGS = {
  sw: { why: 'Kwa nini ni muhimu', do: 'Unachoweza kufanya', when: 'Muone mhudumu wa afya lini' },
  en: { why: 'Why it matters', do: 'What you can do', when: 'When to see a health worker' },
} as const;

function body(lang: Lang, h: (typeof HEADINGS)['sw' | 'en']): string {
  return [
    `## ${h.why}`,
    lang.why,
    '',
    `## ${h.do}`,
    ...lang.do.map((item) => `- ${item}`),
    '',
    `## ${h.when}`,
    lang.when,
  ].join('\n');
}

export function build(category: HealthTipCategory, tips: TipDraft[]): CreateHealthTipInput[] {
  return tips.map((tip) => ({
    slug: tip.slug,
    category,
    titleSw: tip.sw.t,
    titleEn: tip.en.t,
    summarySw: tip.sw.s,
    summaryEn: tip.en.s,
    bodySw: body(tip.sw, HEADINGS.sw),
    bodyEn: body(tip.en, HEADINGS.en),
    takeawaysSw: tip.sw.k,
    takeawaysEn: tip.en.k,
    illustration: tip.illustration ?? CATEGORY_ILLUSTRATION[category],
    sources: tip.src.map((id) => ({ name: SOURCES[id][0], url: SOURCES[id][1] })),
    priority: tip.priority ?? 0,
    publishAt: null,
    unpublishAt: null,
  }));
}
