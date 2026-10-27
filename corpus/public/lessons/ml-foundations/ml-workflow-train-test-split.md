---
title: 'The ML Workflow: Train/Test Split, Validation, and Data Leakage'
topic: ml-foundations
kind: lesson
level: beginner
tags:
- ml-foundations
- foundations
---

## What you will learn
- Describe the seven-step ML workflow from raw data to deployed model
- Implement train/validation/test splits correctly with scikit-learn
- Explain k-fold cross-validation and when it beats a single split
- Identify and prevent data leakage — the most common silent ML bug

## Why this matters
Every ML interview starts here. If you can't explain why you split data before training, or why you never touch the test set until the very end, you signal inexperience immediately. More practically, data leakage silently inflates model performance — projects fail in production because models that looked great on paper had leaked test-set information during training.

## The seven-step ML workflow

Every ML project follows the same core sequence regardless of domain:

1. **Collect and clean data** — gather raw data, handle missing values and outliers
2. **Split the data** — hold out a test set before doing anything else
3. **Explore and engineer features** — EDA and feature creation on training data only
4. **Train models** — fit candidate models on training data
5. **Evaluate and tune** — compare models using the validation set
6. **Final evaluation** — run exactly once on the held-out test set
7. **Deploy** — ship the best model to production

The golden rule: **the test set is a time capsule**. You seal it on day 1 and open it once at the very end. Any decision made using the test set — even just glancing at it — leaks information.

## Three-way split

Most ML projects need three data partitions:

| Split | Typical size | Purpose |
|---|---|---|
| Train | 60–70% | Fit model parameters (weights, splits, centroids) |
| Validation | 15–20% | Compare hyperparameters and select the best model |
| Test | 15–20% | Final, once-only evaluation before deployment |

```python
from sklearn.model_selection import train_test_split
import pandas as pd

df = pd.read_csv("data.csv")
X = df.drop(columns=["target"])
y = df["target"]

# Step 1: carve out the test set first — seal it immediately
X_temp, X_test, y_temp, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Step 2: split the remainder into train and validation
X_train, X_val, y_train, y_val = train_test_split(
    X_temp, y_temp, test_size=0.25, random_state=42, stratify=y_temp
)
# 0.25 of 0.8 = 0.2 of total → 60/20/20 split

print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")
```

Always pass `stratify=y` for classification tasks. It ensures each split has the same class distribution as the original dataset — important when classes are imbalanced.

## K-fold cross-validation

When your dataset is small (under ~10,000 rows), a single validation split is noisy — the score depends too much on which rows landed in the validation set. K-fold solves this by rotating the validation window across the training data:

```python
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.ensemble import RandomForestClassifier

model = RandomForestClassifier(n_estimators=100, random_state=42)
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

# cross_val_score fits on 4/5 folds, evaluates on the remaining 1/5
# repeats 5 times, each time using a different validation fold
scores = cross_val_score(model, X_train, y_train, cv=cv, scoring="f1_macro")

print(f"CV F1 scores: {scores.round(3)}")
print(f"Mean ± std: {scores.mean():.3f} ± {scores.std():.3f}")
```

A high standard deviation (> 0.05 for most tasks) means your model is unstable — it's sensitive to which data it sees. Investigate class imbalance, feature noise, or increase dataset size.

Use `StratifiedKFold` for classification (preserves class ratios in each fold). Use plain `KFold` for regression. Use `TimeSeriesSplit` when your data is ordered chronologically — never shuffle time-series data.

## Data leakage

Leakage happens when information from outside the training set influences the model during training. It produces optimistically inflated evaluation metrics that evaporate in production.

**The three most common leakage patterns:**

**1. Preprocessing before splitting** — fitting a scaler on the full dataset before the split means the scaler has "seen" test-set statistics:

```python
# WRONG — the scaler learns mean/std from test rows too
from sklearn.preprocessing import StandardScaler
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)  # full dataset — leaks test stats
X_train, X_test = train_test_split(X_scaled, ...)

# RIGHT — fit only on training data
X_train, X_test = train_test_split(X, ...)
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)  # learns stats from train only
X_test_scaled  = scaler.transform(X_test)        # applies same stats — no fit
```

**2. Future information in features** — a feature like `days_until_churn` encodes the label. A `transaction_amount_7_days_after_event` feature for a same-day prediction leaks the future.

**3. Target encoding without isolation** — encoding a categorical feature using mean target values computed on the full training set leaks label information. Use `TargetEncoder` from scikit-learn ≥ 1.3 (it uses cross-fitting internally) or compute target statistics only on out-of-fold rows.

## Quick quiz
**Q: You fit a `StandardScaler` on your full dataset before calling `train_test_split`. Then you train and evaluate a model on the resulting splits. Why will your reported test accuracy be misleadingly high?**

- A) The scaler will produce incorrect normalised values for test rows
- B) The scaler's mean and std were computed using test-row values, so the model has indirectly "seen" the test set during training ✅
- C) Scaling must happen after splitting to avoid dimension mismatch
- D) This is only a problem for classification, not regression

## How to explain it in an interview
"I always split data before any preprocessing step. The test set is sealed on day 1 and touched exactly once — at the very end, after all model selection decisions are made. For small datasets I use stratified k-fold cross-validation on the training set to get a stable performance estimate rather than a noisy single-split score. Data leakage — where test-set or future information influences training — is the most common reason a model looks great in development but fails in production. The two biggest leakage risks in practice are fitting preprocessors on the full dataset and including features that encode information available only after the prediction point."
