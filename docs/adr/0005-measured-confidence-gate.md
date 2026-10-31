# ADR 0005: Calibrate the confidence gate from measurements, per knowledge base

Status: accepted (M2)

## Context

The gate refuses to answer when the best cosine similarity is below a cutoff. M1 used 0.55 as a
guess. Measured with the lessons questions as positives and questions from an unrelated corpus
as negatives, 0.55 let through 94% of off-topic questions.

## Decision

The cutoff lives per knowledge base in `kbs.yaml`, set from `cairnly eval`, which reports false
refusals, false accepts and a suggested cutoff. The lessons use 0.67 (0% false refusals and 0%
false accepts). The eval gate fails CI if either error rate drifts too high.

## Consequences

- The cutoff is tied to the embedding model; changing the model means re-measuring.
- Negatives from an unrelated corpus are a proxy for "off-topic". A real deployment should add
  genuinely out-of-scope user questions to the negative set as they appear.
