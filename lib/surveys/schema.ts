import { z } from "zod";

const idSchema = z.string().min(1);

export const surveyOptionSchema = z.object({
  id: idSchema,
  label: z.string(),
});

export const surveyScaleSchema = z
  .object({
    min: z.number().int(),
    max: z.number().int(),
  })
  .refine((v) => v.min < v.max, { message: "scale.min must be < scale.max" });

const fieldBaseSchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string(),
  required: z.boolean(),
});

export const surveyTextFieldSchema = fieldBaseSchema.extend({
  type: z.literal("text"),
  placeholder: z.string(),
});

export const surveyRadioFieldSchema = fieldBaseSchema.extend({
  type: z.literal("radio"),
  options: z.array(surveyOptionSchema).min(1),
});

export const surveyCheckboxFieldSchema = fieldBaseSchema.extend({
  type: z.literal("checkbox"),
  options: z.array(surveyOptionSchema).min(1),
});

export const surveyRatingFieldSchema = fieldBaseSchema.extend({
  type: z.literal("rating"),
  scale: surveyScaleSchema,
});

export const surveyFieldSchema = z.discriminatedUnion("type", [
  surveyTextFieldSchema,
  surveyRadioFieldSchema,
  surveyCheckboxFieldSchema,
  surveyRatingFieldSchema,
]);

export const surveyStepSchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string(),
  fields: z.array(surveyFieldSchema),
});

export const surveySchemaV1 = z.object({
  version: z.literal(1),
  id: idSchema,
  title: z.string(),
  description: z.string(),
  steps: z.array(surveyStepSchema).min(1),
});

export const surveySchema = surveySchemaV1;

export type SurveyParsed = z.infer<typeof surveySchema>;

