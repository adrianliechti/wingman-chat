# Layout and content

Use [protocol.md](protocol.md) for the envelope, catalog selection, dynamic values and child IDs. The signatures below are the exact available property names; do not add CSS, gap or styling props to components that do not declare them.

Use Row/Column for simple groups, Grid for columns, Card for a single grouped child, and Tabs/Collapsible for optional detail. Basic Text supports limited noninteractive Markdown; use Heading for a heading and Link for a clickable link. Svg supports sanitized drawings; Html embeds a sandboxed preview. For large applications or requested files, use artifacts.

## Component-specific properties

- Heading is Wingman-only. Every Heading needs `catalogId:"urn:wingman:inline-ui:catalog:1"`, even if another Heading already declares it. Components without catalogId inherit the surface default, not the catalog of their parent or siblings.
- Row/Column have no `gap` or `columns`; use Grid for those properties.
- Text accepts `variant:"body"` or `"caption"`; headings use Heading.level, and colored notices use Callout.tone or Badge.tone.
- Callout.tone and Badge.tone are literal enums, not bindings or function calls. For a changing status, use separate Callouts/Badges with conditional `visible` values; choose a literal tone for each.
- Image has no `height`; use its declared `variant` and `fit`. `height` belongs to Svg, Html and Chart.
- `defaultOpen` belongs to Collapsible; Basic Tabs and Modal reject it. Basic tab titles belong inside `tabs[]`, not at the component's top level.
- CSS props such as `padding`, `margin`, `style`, `className` and `fontSize` are unsupported in both catalogs.

## Conditional visibility

Basic components, including Text, Row and Column, do **not** accept `visible` or `disabled`. To show/hide Basic content, put it inside a Wingman Grid with `visible` bound to a boolean or calculation. Keep the Basic child in the Basic catalog; adding a Wingman catalogId to Text does not make it a Wingman component.

This complete example shows/hides drawing text locally:

```ui
{
  "version": "v1.0",
  "createSurface": {
    "surfaceId": "drawing_details",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    "components": [
      { "id": "root", "component": "Column", "children": ["show", "drawing"] },
      {
        "id": "show",
        "component": "Toggle",
        "catalogId": "urn:wingman:inline-ui:catalog:1",
        "label": "Show drawing details",
        "value": { "@path": "/showDrawing" }
      },
      {
        "id": "drawing",
        "component": "Grid",
        "catalogId": "urn:wingman:inline-ui:catalog:1",
        "columns": 1,
        "gap": "none",
        "visible": { "@path": "/showDrawing" },
        "children": ["drawtext"]
      },
      { "id": "drawtext", "component": "Text", "text": "Drawing details" }
    ],
    "dataModel": { "showDrawing": true }
  }
}
```

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Generated signatures; `?` means optional.

### Basic catalog

`catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"`

Every component also accepts { weight?: number }.

`visible` and `disabled` are Wingman-only properties; Basic components reject them.

- Row { children: ChildList, justify?: "center"|"end"|"spaceAround"|"spaceBetween"|"spaceEvenly"|"start"|"stretch", align?: "start"|"center"|"end"|"stretch" }
- Column { children: ChildList, justify?: "start"|"center"|"end"|"spaceBetween"|"spaceAround"|"spaceEvenly"|"stretch", align?: "center"|"end"|"start"|"stretch" }
- List { children: ChildList, direction?: "vertical"|"horizontal", align?: "start"|"center"|"end"|"stretch" }
- Card { child: Child }
- Tabs { tabs: { title: DynamicString, child: Child }[] }
- Modal { trigger: Child, content: Child }
- Divider { axis?: "horizontal"|"vertical" }
- Text { text: DynamicString, variant?: "caption"|"body" }
- Image { url: DynamicString, description?: DynamicString, fit?: "contain"|"cover"|"fill"|"none"|"scaleDown", variant?: "icon"|"avatar"|"smallFeature"|"mediumFeature"|"largeFeature"|"header" }
- Icon { name: "accountCircle"|"add"|"arrowBack"|"arrowForward"|"attachFile"|"calendarToday"|"call"|"camera"|"check"|"close"|"delete"|"download"|"edit"|"event"|"error"|"fastForward"|"favorite"|"favoriteOff"|"folder"|"help"|"home"|"info"|"locationOn"|"lock"|"lockOpen"|"mail"|"menu"|"moreVert"|"moreHoriz"|"notificationsOff"|"notifications"|"pause"|"payment"|"person"|"phone"|"photo"|"play"|"print"|"refresh"|"rewind"|"search"|"send"|"settings"|"share"|"shoppingCart"|"skipNext"|"skipPrevious"|"star"|"starHalf"|"starOff"|"stop"|"upload"|"visibility"|"visibilityOff"|"volumeDown"|"volumeMute"|"volumeOff"|"volumeUp"|"warning"|{ svgPath: DynamicString }|DataBinding }
- Video { url: DynamicString, posterUrl?: DynamicString }
- AudioPlayer { url: DynamicString, description?: DynamicString }

### Wingman catalog

`catalogId: "urn:wingman:inline-ui:catalog:1"`

Every component also accepts { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number }.

- Grid { columns?: DynamicNumber, gap?: "none"|"sm"|"md"|"lg", children: ChildList }
- Collapsible { title: DynamicString, description?: DynamicString, defaultOpen?: DynamicBoolean, children: ChildList }
- Heading { text: DynamicString, level?: DynamicNumber }
- Callout { text: DynamicString, title?: DynamicString, tone?: "info"|"success"|"warning"|"error" }
- Badge { text: DynamicString, tone?: "neutral"|"info"|"success"|"warning"|"error" }
- Code { text: DynamicString, language?: DynamicString }
- Svg { markup: DynamicString, height?: DynamicNumber, label?: DynamicString }
- Link { text: DynamicString, href: DynamicString, description?: DynamicString, kind?: "link"|"chip" }
- Html { markup: DynamicString, height?: DynamicNumber, title?: DynamicString }
- TextList { items: DynamicString[]|DataBinding|FunctionCall, ordered?: DynamicBoolean }

<!-- A2UI-CATALOG:END -->
