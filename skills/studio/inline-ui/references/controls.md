# Controls, forms and validation

Use [protocol.md](protocol.md) for bindings and Action payloads. Every editable control's `value` must be a data binding. Initialize its data model with the matching type:

| Control                              | Writes                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| TextField, DateTimeInput             | string; TextField's number variant still writes a string              |
| CheckBox, Toggle                     | boolean                                                               |
| ChoicePicker, MultiSelect, Checklist | string array; ChoicePicker remains an array in mutuallyExclusive mode |
| Select, Segmented, Radio             | string                                                                |
| Slider, Stepper                      | number                                                                |

For one choice, use Radio for visible alternatives, Segmented for a short mode switch, or Select for a compact menu. For several choices use ChoicePicker or MultiSelect. Use `ask_questions` when the agent must wait for clarification before proceeding; use a Form for an exploratory interface that submits its current values.

## Checks

`CheckRule` is `{condition, message}`. Conditions return `{valid, message?, code?, severity?}`. For example:

```json
{
  "condition": {
    "@call": "email",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    "args": { "value": { "@path": "/email" } }
  },
  "message": "Enter a valid email"
}
```

Basic validators inside Wingman controls require the Basic catalogId above. `required` accepts false, zero and whitespace; it rejects null, undefined, empty strings and empty arrays. Use regex or additional checks for stricter rules. Field errors appear after blur or submission. Button checks gate that action. Form checks its descendants; disabled/hidden Wingman fields are excluded. See [functions.md](functions.md) to combine checks with and/or/not.

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Generated signatures; `?` means optional.

### Basic catalog

`catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"`

Every component also accepts { weight?: number }.

- Button { checks?: CheckRule[], child: Child, variant?: "default"|"primary"|"borderless", action: Action }
- TextField { checks?: CheckRule[], label: DynamicString, value?: DynamicString, placeholder?: DynamicString, variant?: "longText"|"number"|"shortText"|"obscured" }
- CheckBox { checks?: CheckRule[], label: DynamicString, value: DynamicBoolean }
- ChoicePicker { checks?: CheckRule[], label?: DynamicString, variant?: "multipleSelection"|"mutuallyExclusive", options: { label: DynamicString, value: string }[], value: DynamicStringList, displayStyle?: "checkbox"|"chips", filterable?: boolean }
- Slider { checks?: CheckRule[], label?: DynamicString, min?: number, max: number, value: DynamicNumber, steps?: integer }
- DateTimeInput { checks?: CheckRule[], value: DynamicString, enableDate?: boolean, enableTime?: boolean, min?: DynamicString, max?: DynamicString, label?: DynamicString }

Functions:

- required { value: JSON }: validationResult
- email { value: DynamicString }: validationResult
- regex { value: DynamicString, pattern: string }: validationResult
- length { value: DynamicString, min?: integer, max?: integer }: validationResult
- numeric { value: DynamicNumber, min?: number, max?: number }: validationResult

### Wingman catalog

`catalogId: "urn:wingman:inline-ui:catalog:1"`

Every component also accepts { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number }.

- Select { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicString, options: { value: string, label: DynamicString }[] }
- MultiSelect { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicStringList, options: { value: string, label: DynamicString }[] }
- Segmented { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicString, options: { value: string, label: DynamicString }[] }
- Radio { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicString, options: { value: string, label: DynamicString }[] }
- Toggle { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicBoolean }
- Stepper { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicNumber, min?: DynamicNumber, max?: DynamicNumber, step?: DynamicNumber, unit?: DynamicString }
- Checklist { label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicStringList, items: (string|{ label: DynamicString, time?: DynamicValue, description?: DynamicString })[] }
- Form { children: ChildList, action: Action, submit: DynamicString, checks?: CheckRule[] }

<!-- A2UI-CATALOG:END -->
