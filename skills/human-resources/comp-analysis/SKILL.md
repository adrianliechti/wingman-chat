---
name: comp-analysis
description: Analyze compensation — benchmarking, band placement, and equity modeling. Trigger with "what should we pay a [role]", "is this offer competitive", "model this equity grant", or when uploading comp data to find outliers and retention risks.
---

# Compensation Analysis

Analyze compensation data for benchmarking, band placement, and planning. Helps benchmark compensation against market data for hiring, retention, and equity planning.

## What I Need From You

**Option A: Single role analysis**
"What should we pay a Senior Software Engineer in a given location?"

**Option B: Upload comp data**
Upload a CSV or paste your comp bands. I'll analyze placement, identify outliers, and compare to market.

**Option C: Equity modeling**
"Model a refresh grant of 10K shares over 4 years at a given stock price."

## Compensation Framework

### Components of Total Compensation

- **Base salary**: Cash compensation
- **Equity**: Shares, options, or other equity
- **Bonus**: Annual target bonus, signing bonus
- **Benefits**: Health, retirement, perks (harder to quantify)

### Key Variables

- **Role**: Function and specialization
- **Level**: IC levels, management levels
- **Location**: Geographic pay adjustments
- **Company stage**: Startup vs. growth vs. public
- **Industry**: Tech vs. finance vs. healthcare

### Data Sources

- **With a compensation data source**: Pull verified benchmarks
- **Without**: Use web research, public salary data, and user-provided context
- Always note data freshness and source limitations

## Output

Provide percentile bands (25th, 50th, 75th, 90th) for base, equity, and total comp. Include location adjustments and company-stage context.

```markdown
## Compensation Analysis: [Role/Scope]

### Market Benchmarks

| Percentile | Base | Equity | Total Comp |
| ---------- | ---- | ------ | ---------- |
| 25th       | [X]  | [X]    | [X]        |
| 50th       | [X]  | [X]    | [X]        |
| 75th       | [X]  | [X]    | [X]        |
| 90th       | [X]  | [X]    | [X]        |

**Sources:** [Web research, compensation data tools, or user-provided data]

### Band Analysis (if data provided)

| Employee | Current Base | Band Min | Band Mid | Band Max | Position         |
| -------- | ------------ | -------- | -------- | -------- | ---------------- |
| [Name]   | [X]          | [X]      | [X]      | [X]      | [Below/At/Above] |

### Recommendations

- [Specific compensation recommendations]
- [Equity considerations]
- [Retention risks if applicable]
```

## If Connectors Available

If a **compensation data source** is connected:

- Pull verified market benchmarks by role, level, and location
- Compare your bands against real-time market data

If an **HRIS** is connected:

- Pull current employee comp data for band analysis
- Identify outliers and retention risks automatically

## Tips

1. **Location matters** — Always specify location for benchmarking. Major metros and smaller markets differ significantly.
2. **Total comp, not just base** — Include equity, bonus, and benefits for a complete picture.
3. **Keep data confidential** — Comp data is sensitive. Results stay in your conversation.
