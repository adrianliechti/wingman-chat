# Layout and content

Use [protocol.md](protocol.md) for the envelope, catalog selection, dynamic values and child IDs. The signatures below are the exact available property names; do not add CSS, gap or styling props to components that do not declare them.

Use Row/Column for simple groups, Grid for columns, Card for a single grouped child, and Tabs/Collapsible for optional detail. Basic Text supports limited noninteractive Markdown; use Heading for a heading and Link for a clickable link. Svg supports sanitized drawings; Html embeds a sandboxed preview. For large applications or requested files, use artifacts.

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Generated signatures; `?` means optional.

### Basic catalog

`catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"`

Every component also accepts { weight?: number }.

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
