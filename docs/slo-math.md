# SLO Math

## Availability SLO

For a rolling window W:

Availability = successful_probes / total_probes

Compliance is met when:

Availability >= target

## Error budget

Error budget ratio = 1 - target

Remaining budget = max(0, error_budget_ratio - observed_error_ratio)

## Burn rate

Burn rate = observed_error_ratio / error_budget_ratio

- Burn rate > 1 means budget is being consumed faster than planned.
- Burn rate > 2 is typically paging severity.
