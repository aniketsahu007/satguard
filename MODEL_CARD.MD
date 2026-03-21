# SatGuard — Model Card

## Overview
SatGuard is a real-time satellite cyberattack detection system using a two-stage ML pipeline:
an unsupervised Isolation Forest for anomaly detection, followed by a supervised Random Forest
for attack classification. Predictions are explained using SHAP (SHapley Additive exPlanations).

---

## Dataset

| Field | Detail |
|---|---|
| Name | NASA Anomaly Detection Dataset — SMAP & MSL |
| Source | Kaggle: `patrickfleith/nasa-anomaly-detection-dataset-smap-msl` |
| Original paper | Hundman et al., KDD 2018 — *Detecting Spacecraft Anomalies Using LSTMs and Nonparametric Dynamic Thresholding* |
| Publisher | NASA Jet Propulsion Laboratory (JPL) |
| Spacecraft | SMAP (Soil Moisture Active Passive) + MSL (Curiosity Rover) |
| Channels used | 55 real spacecraft housekeeping channels (power, thermal, command, attitude) |
| Total timesteps | 496,444 telemetry values evaluated |
| License | Public / open research use |

---

## Labeling Methodology

Publicly available labeled cyberattack telemetry for spacecraft does not exist — real incidents
are classified by space agencies and operators. We follow the **semi-synthetic injection methodology**
used in spacecraft cybersecurity literature:

1. Real SMAP/MSL normal telemetry is used as the baseline (no modification).
2. Validated attack signatures are injected onto real telemetry windows to generate labeled attack classes.
3. This produces a semi-synthetic corpus: normal class is real, attack classes are real baseline + injected signatures.

Attack patterns are derived from published attack taxonomies:
- MITRE ATT&CK for Space — technique T0046 (Signal Injection), T0048 (Command Spoofing)
- Pavur et al. 2020 — *A Tale of Sea and Sky: On the Security of Maritime VSAT Communications*

---

## Feature Engineering

| Property | Value |
|---|---|
| Window size | 60 timesteps per sample |
| Features | 8 statistical features × 5 channels = **40 features** |
| Stats per channel | Mean, Std Dev, Min, Max, Range, RMS, Zero-Crossing Rate, Slope |
| Channels | Signal Strength, CMD Frequency, Power Output, Thermal (OBC), Attitude Control |
| Normalization | StandardScaler fitted on normal class only |

---

## Models

### Stage 1 — Isolation Forest (anomaly detector)
- Trained on normal telemetry only (unsupervised)
- Flags whether a window is anomalous before classification
- `n_estimators=200`, `contamination=0.05`

### Stage 2 — Random Forest Classifier (attack classifier)
- Only runs if Stage 1 flags an anomaly
- `n_estimators=200`, `class_weight=balanced`, stratified 80/20 train/test split
- Output: attack class + per-class probability

---

## Performance (on held-out 20% test split)

> Run `python train_model.py` to regenerate these metrics on your environment.

| Class | Precision | Recall | F1 |
|---|---|---|---|
| Normal | — | — | — |
| Signal Injection | — | — | — |
| Command Spoofing | — | — | — |
| Telemetry Manipulation | — | — | — |
| Hardware Degradation | — | — | — |

*(Fill in after running train_model.py — values printed in terminal output)*

---

## Explainability (XAI)

Root cause analysis uses **SHAP TreeExplainer** on the Random Forest classifier.
For each anomalous prediction, the top contributing feature is identified by absolute
SHAP value and returned as a human-readable string (e.g. *"Spike in CMD Frequency Std Dev"*).
The top 3 contributing features with SHAP scores are also returned via the API.

---

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/predict` | POST | Live telemetry prediction + SHAP XAI |
| `/simulate/{mode}` | GET | Demo mode: generate + classify |
| `/status` | GET | Model readiness + data source |
| `/model-info` | GET | Full training metadata |
| `/incidents` | GET | Last N security incidents |
| `/playbook` | POST | Log operator response action |
| `/reset` | POST | Clear incident log |

---

## Limitations

- Attack classes are semi-synthetic — not derived from real classified cyberattack telemetry.
- Channel mapping from SMAP/MSL to SatGuard's 5 abstract channels is an approximation.
- The system is a research prototype and has not been validated in a live satellite environment.

---

## Citation

If referencing this work, please also cite the underlying dataset:

```
Hundman, K., Constantinou, V., Laporte, C., Colwell, I., & Soderstrom, T. (2018).
Detecting Spacecraft Anomalies Using LSTMs and Nonparametric Dynamic Thresholding.
Proceedings of the 24th ACM SIGKDD International Conference on Knowledge Discovery & Data Mining.
```
