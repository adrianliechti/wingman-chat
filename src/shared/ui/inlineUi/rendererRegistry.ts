import type { ComponentType, ReactNode } from "react";
import type { BasicProps, WingmanProps } from "@/shared/lib/inlineUi/rendererTypes";

export interface RendererContext {
  disabled: boolean;
  readOnly: boolean;
  busy: boolean;
  fieldId: string;
  validation: { "aria-invalid"?: boolean; "aria-errormessage"?: string };
  change: (value: unknown) => void;
  invoke: () => void;
  label: (control: ReactNode) => ReactNode;
  formSubmitted: boolean;
  submitForm: () => void;
  children?: ReactNode;
  renderText?: (markdown: string) => ReactNode;
}

export type ComponentRenderers<Props> = {
  [Name in keyof Props]: ComponentType<
    { props: Props[Name]; change: (value: Props[Name] extends { value?: infer Value } ? Value : never) => void } & Omit<
      RendererContext,
      "change"
    >
  >;
};
export type BasicRenderers = ComponentRenderers<BasicProps>;
export type WingmanRenderers = ComponentRenderers<WingmanProps>;
