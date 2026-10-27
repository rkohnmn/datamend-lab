# DataMend Lab — Reproducible Cleaning Recipe Format (`RECIPE_FORMAT.md`)

## 1. Schema Specification (`DataMendRecipe` v1.0.0)

```json
{
  "$schema": "https://datasense-studio.github.io/schemas/v1/datamend-recipe.json",
  "recipeId": "rcp_preset_messy_customers_m9x2",
  "title": "Cleaning Recipe for Regional Customer Audit",
  "recipeVersion": "1.0.0",
  "applicationVersion": "1.0.0",
  "createdAt": "2026-10-26T17:35:00.000Z",
  "sourceFingerprint": "fnv1a_8b19c402_n12",
  "requiredInputSchema": [
    { "name": "customer_id", "originalName": "customer_id", "semanticType": "identifier", "unit": null }
  ],
  "learnedParameters": {
    "demand_index": { "mean": 106.9 }
  },
  "validationRules": [],
  "steps": [
    {
      "stepNumber": 1,
      "operationType": "DEDUPLICATE_EXACT",
      "label": "Deduplicate Records",
      "category": "Duplicate Resolution",
      "riskLevel": "High risk",
      "params": { "strategy": "keep_first" }
    }
  ],
  "expectedOutputSchema": []
}
```

## 2. Schema-Drift Detection & Transactional Replay

- Before executing any imported recipe, `validateRecipeCompatibility()` checks every step against `OPERATION_REGISTRY` (never executing arbitrary code) and compares `requiredInputSchema` against the target dataset.
- If a column was renamed or changed semantic type, DataMend Lab reports `MISSING_COLUMN` or `TYPE_DRIFT` and allows explicit column remapping (`columnMapping`).
- If any step fails during replay, `replayCleaningRecipe()` rolls back the dataset to its exact pre-replay snapshot.
