import type {
  CHILDREN_PLANS,
  CORE_TRAITS,
  DAILY_RHYTHMS,
  DRINKING_HABITS,
  EDUCATION_LEVELS,
  FINANCIAL_INDEPENDENCE,
  RELIGIONS,
  SMOKING_HABITS,
  SPORTS_HABITS,
} from '@tamgiao/contracts/profile';

export type ChildrenPlan = (typeof CHILDREN_PLANS)[number];
export type Religion = (typeof RELIGIONS)[number];
export type SmokingHabit = (typeof SMOKING_HABITS)[number];
export type DrinkingHabit = (typeof DRINKING_HABITS)[number];
export type DailyRhythm = (typeof DAILY_RHYTHMS)[number];
export type SportsHabit = (typeof SPORTS_HABITS)[number];
export type FinancialIndependence = (typeof FINANCIAL_INDEPENDENCE)[number];
export type CoreTrait = (typeof CORE_TRAITS)[number];
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
