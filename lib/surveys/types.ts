export type SurveyVersion = 1;

export type SurveyFieldType = "text" | "radio" | "checkbox" | "rating" | "ranking";

export type SurveyOption = {
  id: string;
  label: string;
};

export type SurveyScale = {
  min: number;
  max: number;
};

export type SurveyFieldBase = {
  id: string;
  type: SurveyFieldType;
  title: string;
  description: string;
  required: boolean;
};

export type SurveyTextField = SurveyFieldBase & {
  type: "text";
  placeholder: string;
};

export type SurveyRadioField = SurveyFieldBase & {
  type: "radio";
  options: SurveyOption[];
};

export type SurveyCheckboxField = SurveyFieldBase & {
  type: "checkbox";
  options: SurveyOption[];
};

export type SurveyRatingField = SurveyFieldBase & {
  type: "rating";
  scale: SurveyScale; // typically {min:1,max:5}
};

export type SurveyRankingField = SurveyFieldBase & {
  type: "ranking";
  options: SurveyOption[];
  /** Wenn false, können Teilnehmende keine eigenen „Andere“-Einträge ergänzen. Standard: true. */
  allowCustomEntries?: boolean;
};

export type SurveyField =
  | SurveyTextField
  | SurveyRadioField
  | SurveyCheckboxField
  | SurveyRatingField
  | SurveyRankingField;

export type SurveyStep = {
  id: string;
  title: string;
  description: string;
  fields: SurveyField[];
};

export type Survey = {
  version: SurveyVersion;
  id: string;
  title: string;
  description: string;
  steps: SurveyStep[];
};

