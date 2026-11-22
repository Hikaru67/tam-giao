import type {
  EDUCATION_LEVELS,
  GENDERS,
  HOUSING_TYPES,
  INCOME_RANGES,
  PROFILE_CHILDREN_PLANS,
  PROFILE_RELIGIONS,
} from '@tamgiao/contracts/profile';

// Contracts export mảng hằng (as const) → suy kiểu giá trị từ phần tử mảng.
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];
export type Gender = (typeof GENDERS)[number];
export type HousingType = (typeof HOUSING_TYPES)[number];
export type IncomeRange = (typeof INCOME_RANGES)[number];
export type ProfileChildrenPlan = (typeof PROFILE_CHILDREN_PLANS)[number];
export type ProfileReligion = (typeof PROFILE_RELIGIONS)[number];

export interface FormPhotoItem {
  id: string;
  key: string;
  uri: string;
  status: 'uploading' | 'uploaded' | 'failed';
  error?: string | undefined;
}

export interface ProfileFormData {
  fullName: string;
  birthDate: string;
  gender: Gender | '';
  hometown: string;
  currentCity: string;
  education: EducationLevel | '';
  occupation: string;
  religion: ProfileReligion | '';
  childrenPlan: ProfileChildrenPlan | '';
  bio: string;
  interests: string[];
  incomeRange: IncomeRange | '';
  housing: HousingType | '';
  assets: string;
  photos: FormPhotoItem[];
}
