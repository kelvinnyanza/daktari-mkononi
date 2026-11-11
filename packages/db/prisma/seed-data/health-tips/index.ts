import type { CreateHealthTipInput } from '@daktari/schemas';
import { chronicDisease } from './chronic-disease.js';
import { exercise } from './exercise.js';
import { malaria } from './malaria.js';
import { maternalChild } from './maternal-child.js';
import { mentalHealth } from './mental-health.js';
import { nutrition } from './nutrition.js';
import { prevention } from './prevention.js';
import { waterHygiene } from './water-hygiene.js';

/** All 110 DRAFT health tips (seeded as DRAFT only — a verified doctor must review them). */
export const HEALTH_TIP_DRAFTS: CreateHealthTipInput[] = [
  ...nutrition,
  ...exercise,
  ...waterHygiene,
  ...mentalHealth,
  ...chronicDisease,
  ...maternalChild,
  ...malaria,
  ...prevention,
];
