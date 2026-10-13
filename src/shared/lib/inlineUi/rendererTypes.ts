import type { z } from "zod-a2ui";
import type {
  ActionSchema,
  DataBindingSchema,
  FunctionCallSchema,
  ChildListSchema,
  ComponentNode,
  TextApi,
  ImageApi,
  IconApi,
  VideoApi,
  AudioPlayerApi,
  RowApi,
  ColumnApi,
  ListApi,
  CardApi,
  TabsApi,
  ModalApi,
  DividerApi,
  ButtonApi,
  TextFieldApi,
  CheckBoxApi,
  ChoicePickerApi,
  SliderApi,
  DateTimeInputApi,
} from "@a2ui/web_core/v1_0";
import type { WINGMAN_COMPONENTS } from "./catalog";

/**
 * Infer literal values before Zod's dynamic-expression `any` can erase them.
 * NodeResolver replaces bindings, actions and child references at the SDK boundary.
 * Unlike GenericBinder's ResolveA2uiProps, its children are live ComponentNodes.
 */
type ResolvedSchema<S extends z.ZodTypeAny> =
  S extends z.ZodOptional<infer Inner>
    ? ResolvedSchema<Inner> | undefined
    : S extends z.ZodDefault<infer Inner>
      ? ResolvedSchema<Inner>
      : S extends typeof DataBindingSchema | typeof FunctionCallSchema
        ? never
        : S extends typeof ActionSchema
          ? () => Promise<void>
          : S extends typeof ChildListSchema
            ? ComponentNode[]
            : S extends z.ZodUnion<infer Options>
              ? ResolvedSchema<Options[number]>
              : S extends z.ZodArray<infer Item>
                ? ResolvedSchema<Item>[]
                : S extends z.ZodObject<infer Shape>
                  ? ResolvedShape<Shape>
                  : S extends z.ZodRecord<z.ZodString, infer Value>
                    ? Record<string, ResolvedSchema<Value>>
                    : S extends z.ZodEffects<infer Inner>
                      ? ResolvedSchema<Inner>
                      : S extends z.ZodAny
                        ? unknown
                        : z.infer<S>;

type ResolvedProperty<K, S extends z.ZodTypeAny> = K extends "child" | "trigger" | "content"
  ? ComponentNode | Extract<ResolvedSchema<S>, undefined>
  : ResolvedSchema<S>;
type ResolvedShape<S extends z.ZodRawShape> = {
  [K in keyof S as S[K] extends z.ZodOptional<z.ZodTypeAny> ? never : K]: ResolvedProperty<K, S[K]>;
} & {
  [K in keyof S as S[K] extends z.ZodOptional<z.ZodTypeAny> ? K : never]?: ResolvedProperty<K, S[K]>;
};

/** Binder metadata is supplied by the SDK, not authored in our catalog. */
export interface ResolvedMetadata {
  isValid?: boolean;
  validationErrors?: string[];
  accessibility?: {
    label?: string;
    description?: string;
    live?: "off" | "polite" | "assertive";
    hidden?: boolean;
  };
}

type BasicApis = {
  Text: typeof TextApi;
  Image: typeof ImageApi;
  Icon: typeof IconApi;
  Video: typeof VideoApi;
  AudioPlayer: typeof AudioPlayerApi;
  Row: typeof RowApi;
  Column: typeof ColumnApi;
  List: typeof ListApi;
  Card: typeof CardApi;
  Tabs: typeof TabsApi;
  Modal: typeof ModalApi;
  Divider: typeof DividerApi;
  Button: typeof ButtonApi;
  TextField: typeof TextFieldApi;
  CheckBox: typeof CheckBoxApi;
  ChoicePicker: typeof ChoicePickerApi;
  Slider: typeof SliderApi;
  DateTimeInput: typeof DateTimeInputApi;
};
type WingmanApis = { [Api in (typeof WINGMAN_COMPONENTS)[number] as Api["name"]]: Api };

export type BasicProps = { [Name in keyof BasicApis]: ResolvedSchema<BasicApis[Name]["schema"]> & ResolvedMetadata };
export type WingmanProps = {
  [Name in keyof WingmanApis]: ResolvedSchema<WingmanApis[Name]["schema"]> & ResolvedMetadata;
};
