---
name: financial-statements
description: Generate financial statements (income statement, balance sheet, cash flow) with period-over-period comparison and variance analysis. Use when preparing a monthly or quarterly P&L, closing the books and need to flag material variances, comparing actuals to budget, building a financial summary for leadership review, or looking up financial-statement presentation requirements and period-end adjustments.
---

# Financial Statements

**Important**: This skill assists with financial statement workflows but does not provide financial advice. All statements should be reviewed by qualified financial professionals before use in reporting or filings.

Generate financial statements with period-over-period comparison and variance analysis. The workflow below walks through income statement generation; balance sheet and cash flow statement reference formats, presentation requirements, and common period-end adjustments are included as supporting reference material.

## Usage

Provide:

- `period-type` — The reporting period type:
  - `monthly` — Single month P&L with prior month and prior year month comparison
  - `quarterly` — Quarter P&L with prior quarter and prior year quarter comparison
  - `annual` — Full year P&L with prior year comparison
  - `ytd` — Year-to-date P&L with prior year YTD comparison
- `period` — The period to report (e.g., `2024-12`, `2024-Q4`, `2024`)

## Workflow

### 1. Gather Financial Data

If an ERP or data warehouse is connected:

- Pull trial balance or income statement data for the specified period
- Pull comparison period data (prior period, prior year, budget/forecast)
- Pull account hierarchy and groupings for presentation

If no data source is connected, prompt the user to provide:

- Current period revenue and expense data (by account or category)
- Comparison period data (prior period, prior year, and/or budget)
- Any known adjustments or reclassifications

### 2. Generate Income Statement

Present in standard multi-column format:

```
INCOME STATEMENT
Period: [Period description]
(in thousands, unless otherwise noted)

                              Current    Prior      Variance   Variance   Budget    Budget
                              Period     Period     (amt)      (%)        Amount    Var (amt)
                              --------   --------   --------   --------   --------  --------
REVENUE
  Product revenue             XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  Service revenue             XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  Other revenue               XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
                              --------   --------   --------              --------  --------
TOTAL REVENUE                 XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX

COST OF REVENUE
  [Cost items]                XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
                              --------   --------   --------              --------  --------
GROSS PROFIT                  XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  Gross Margin                XX.X%      XX.X%

OPERATING EXPENSES
  Research & development      XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  Sales & marketing           XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  General & administrative    XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
                              --------   --------   --------              --------  --------
TOTAL OPERATING EXPENSES      XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX

OPERATING INCOME (LOSS)       XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  Operating Margin            XX.X%      XX.X%

OTHER INCOME (EXPENSE)
  Interest income             XX,XXX     XX,XXX     X,XXX      X.X%
  Interest expense           (XX,XXX)   (XX,XXX)    X,XXX      X.X%
  Other, net                  XX,XXX     XX,XXX     X,XXX      X.X%
                              --------   --------   --------
TOTAL OTHER INCOME (EXPENSE)  XX,XXX     XX,XXX     X,XXX      X.X%

INCOME BEFORE TAXES           XX,XXX     XX,XXX     X,XXX      X.X%
  Income tax expense          XX,XXX     XX,XXX     X,XXX      X.X%
                              --------   --------   --------

NET INCOME (LOSS)             XX,XXX     XX,XXX     X,XXX      X.X%       XX,XXX    X,XXX
  Net Margin                  XX.X%      XX.X%
```

### 3. Variance Analysis

For each line item, calculate and flag material variances.

#### Variance Calculation

For each line item, calculate:

- **Amount variance:** Current period - Prior period (or current period - budget)
- **Percentage variance:** (Current - Prior) / |Prior| x 100
- **Basis point change:** For margins and ratios, express change in basis points (1 bp = 0.01%)

#### Materiality Thresholds

Define what constitutes a "material" variance requiring investigation. Common approaches:

- **Fixed amount threshold:** Variances exceeding a set amount
- **Percentage threshold:** Variances exceeding a set percentage (e.g., 10%, 15%)
- **Combined:** Either the amount OR percentage threshold is exceeded
- **Scaled:** Different thresholds for different line items based on their size and volatility

_Example thresholds (adjust for your organization, expressed as a share of the relevant line item):_

| Line Item Size | Amount Threshold | Percentage Threshold |
| -------------- | ---------------- | -------------------- |
| Large          | High             | 5%                   |
| Medium         | Moderate         | 10%                  |
| Small          | Low              | 15%                  |

#### Variance Decomposition

Break down total variance into component drivers:

- **Volume/quantity effect:** Change in volume at prior period rates
- **Rate/price effect:** Change in rate/price at current period volume
- **Mix effect:** Shift in composition between items with different rates/margins
- **New/discontinued items:** Items present in one period but not the other
- **One-time/non-recurring items:** Items that are not expected to repeat
- **Timing effect:** Items shifting between periods (not a true change in run rate)
- **Currency effect:** Impact of FX rate changes on translated results

#### Investigation and Narrative

For each material variance:

1. Quantify the variance (amount and %)
2. Identify whether favorable or unfavorable
3. Decompose into drivers using the categories above
4. Provide a narrative explanation of the business reason
5. Assess whether the variance is temporary or represents a trend change
6. Note any actions required (further investigation, forecast update, process change)

### 4. Key Metrics Summary

```
KEY METRICS
                              Current    Prior      Change
Revenue growth (%)                                  X.X%
Gross margin (%)              XX.X%      XX.X%      X.X pp
Operating margin (%)          XX.X%      XX.X%      X.X pp
Net margin (%)                XX.X%      XX.X%      X.X pp
OpEx as % of revenue          XX.X%      XX.X%      X.X pp
Effective tax rate (%)        XX.X%      XX.X%      X.X pp
```

### 5. Material Variance Summary

List all material variances requiring investigation:

| Line Item | Variance (amt) | Variance (%) | Direction | Preliminary Driver | Action      |
| --------- | -------------- | ------------ | --------- | ------------------ | ----------- |
| [Item]    | X,XXX          | X.X%         | Unfav.    | [If known]         | Investigate |

### 6. Output

Provide:

1. Formatted income statement with comparisons
2. Key metrics summary
3. Material variance listing with investigation flags
4. Suggested follow-up questions for unexplained variances
5. Offer to drill into any specific variance

## Presentation Requirements

### Income Statement

- Present all items of income and expense recognized in a period
- Classify expenses either by nature (materials, labor, depreciation) or by function (COGS, R&D, S&M, G&A); choose the basis appropriate to your reporting framework and apply it consistently
- If classified by function, disclose depreciation, amortization, and employee benefit costs by nature in the notes
- Present operating and non-operating items separately
- Show income tax expense as a separate line
- Discontinued operations presented separately, net of tax

**Common presentation considerations:**

- **Revenue disaggregation:** Disaggregate revenue into categories that depict how the nature, amount, timing, and uncertainty of revenue are affected by economic factors
- **Stock-based compensation:** Classify within the functional expense categories (R&D, S&M, G&A) with total SBC disclosed in notes
- **Restructuring charges:** Present separately if material, or include in operating expenses with note disclosure
- **Non-standard adjustments:** If presenting adjusted/non-standard measures (common in earnings releases), clearly label and reconcile to the reported figures

### Balance Sheet

- Distinguish between current and non-current assets and liabilities
- Current: expected to be realized, consumed, or settled within 12 months (or the operating cycle if longer)
- Present assets in order of liquidity or by current/non-current grouping per your reporting framework
- Accounts receivable shown net of allowance for credit losses
- Property and equipment shown net of accumulated depreciation
- Goodwill is not amortized — tested for impairment at least annually
- Leases: recognize right-of-use assets and lease liabilities for in-scope leases per your reporting framework

### Cash Flow Statement

- Indirect method is most common (start with net income, adjust for non-cash items)
- Direct method is permitted but less common
- Interest paid and income taxes paid should be disclosed (either on the face or in notes)
- Non-cash investing and financing activities disclosed separately (e.g., assets acquired under leases, stock issued for acquisitions)
- Cash equivalents: short-term, highly liquid investments with original maturities of 3 months or less

## Balance Sheet Reference Format

```
ASSETS
Current Assets
  Cash and cash equivalents
  Short-term investments
  Accounts receivable, net
  Inventory
  Prepaid expenses and other current assets
Total Current Assets

Non-Current Assets
  Property and equipment, net
  Operating lease right-of-use assets
  Goodwill
  Intangible assets, net
  Long-term investments
  Other non-current assets
Total Non-Current Assets

TOTAL ASSETS

LIABILITIES AND EQUITY
Current Liabilities
  Accounts payable
  Accrued liabilities
  Deferred revenue, current portion
  Current portion of long-term debt
  Operating lease liabilities, current portion
  Other current liabilities
Total Current Liabilities

Non-Current Liabilities
  Long-term debt
  Deferred revenue, non-current
  Operating lease liabilities, non-current
  Other non-current liabilities
Total Non-Current Liabilities

Total Liabilities

Equity
  Share capital
  Additional paid-in capital
  Retained earnings (accumulated deficit)
  Accumulated other comprehensive income (loss)
  Treasury shares
Total Equity

TOTAL LIABILITIES AND EQUITY
```

## Cash Flow Statement Reference Format (Indirect Method)

```
CASH FLOWS FROM OPERATING ACTIVITIES
Net income (loss)
Adjustments to reconcile net income to net cash from operations:
  Depreciation and amortization
  Stock-based compensation
  Amortization of debt issuance costs
  Deferred income taxes
  Loss (gain) on disposal of assets
  Impairment charges
  Other non-cash items
Changes in operating assets and liabilities:
  Accounts receivable
  Inventory
  Prepaid expenses and other assets
  Accounts payable
  Accrued liabilities
  Deferred revenue
  Other liabilities
Net Cash Provided by (Used in) Operating Activities

CASH FLOWS FROM INVESTING ACTIVITIES
  Purchases of property and equipment
  Purchases of investments
  Proceeds from sale/maturity of investments
  Acquisitions, net of cash acquired
  Other investing activities
Net Cash Provided by (Used in) Investing Activities

CASH FLOWS FROM FINANCING ACTIVITIES
  Proceeds from issuance of debt
  Repayment of debt
  Proceeds from issuance of shares
  Repurchases of shares
  Dividends paid
  Payment of debt issuance costs
  Other financing activities
Net Cash Provided by (Used in) Financing Activities

Effect of exchange rate changes on cash

Net Increase (Decrease) in Cash and Cash Equivalents
Cash and cash equivalents, beginning of period
Cash and cash equivalents, end of period
```

## Common Adjustments and Reclassifications

### Period-End Adjustments

1. **Accruals:** Record expenses incurred but not yet paid (AP accruals, payroll accruals, interest accruals)
2. **Deferrals:** Adjust prepaid expenses, deferred revenue, and deferred costs for the period
3. **Depreciation and amortization:** Book periodic depreciation/amortization from fixed asset and intangible schedules
4. **Bad debt provision:** Adjust allowance for credit losses based on aging analysis and historical loss rates
5. **Inventory adjustments:** Record write-downs for obsolete, slow-moving, or impaired inventory
6. **FX revaluation:** Revalue foreign-currency-denominated monetary assets and liabilities at period-end rates
7. **Tax provision:** Record current and deferred income tax expense
8. **Fair value adjustments:** Mark-to-market investments, derivatives, and other fair-value items

### Reclassifications

1. **Current/non-current reclassification:** Reclassify long-term debt maturing within 12 months to current
2. **Contra account netting:** Net allowances against gross receivables, accumulated depreciation against gross assets
3. **Intercompany elimination:** Eliminate intercompany balances and transactions in consolidation
4. **Discontinued operations:** Reclassify results of discontinued operations to a separate line item
5. **Equity method adjustments:** Record share of investee income/loss for equity method investments
6. **Segment reclassifications:** Ensure transactions are properly classified by operating segment
