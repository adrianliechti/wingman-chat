import { createContext } from "react";

export const FieldValidationContext = createContext<{ "aria-invalid"?: boolean; "aria-errormessage"?: string }>({});
