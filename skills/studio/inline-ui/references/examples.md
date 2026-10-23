# Inline UI examples

These are complete A2UI v1.0 messages. Put their JSON into a `ui` fence. IDs are case-sensitive; every Wingman extension specifies its catalog.

## Seat estimate

The Stepper edits the data model; Metric resolves a reactive calculation with an explicit dependency.

```ui
{
  "version": "v1.0",
  "createSurface": {
    "surfaceId": "seat_estimate",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    "sendDataModel": true,
    "components": [
      {
        "id": "root",
        "component": "Column",
        "children": [
          "seats",
          "total"
        ]
      },
      {
        "id": "seats",
        "component": "Stepper",
        "catalogId": "urn:wingman:inline-ui:catalog:1",
        "label": "Seats",
        "value": {
          "@path": "/seats"
        },
        "min": 1,
        "max": 100
      },
      {
        "id": "total",
        "component": "Metric",
        "catalogId": "urn:wingman:inline-ui:catalog:1",
        "label": "Monthly estimate",
        "value": {
          "@call": "evaluate",
          "args": {
            "expression": "seats * 12",
            "values": {
              "seats": {
                "@path": "/seats"
              }
            }
          },
          "catalogId": "urn:wingman:inline-ui:catalog:1"
        },
        "format": "currency",
        "currency": "EUR"
      }
    ],
    "dataModel": {
      "seats": 5
    }
  }
}
```

## Growth dashboard

[Complete dashboard payload](examples/dashboard.json) combines Basic Row/Column/Tabs with Wingman Metric, Segmented, Chart, Table, Timeline, Progress, KeyValue and Callout. Switching reporting period changes the chart locally; table headers sort. All data is illustrative.

## Live team-day planner

[Complete planner payload](examples/planner.json) combines Basic TextField, DateTimeInput, ChoicePicker, CheckBox, Card and Text with Wingman Form, Grid, Stepper, Select, Toggle, Metric and Collapsible. Change the event name, guest count or catering and the preview/budget updates immediately. Submission sends a named action with current data.

These examples draw on upstream's v1 live-invitation builder and financial grid. Our additional charts, tables and planning controls are explicitly Wingman catalog components. The browser gallery renders these exact files; its interaction test and PNG capture guard against stale screenshots.

## Update an existing surface

A later reply can update the estimate above:

```ui
{"version":"v1.0","updateDataModel":{"surfaceId":"seat_estimate","path":"/seats","value":12}}
```

To replace layout or content, emit `updateComponents` with complete updated definitions and stable component IDs. To remove the interface, emit `deleteSurface`. A surface ID is unique within the conversation.
