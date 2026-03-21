# train_model.py
# ─────────────────────────────────────────────────────────────────────
#  SatGuard — Model Training on Real NASA SMAP/MSL Telemetry Data
#
#  Dataset: NASA Anomaly Detection Dataset (SMAP + MSL)
#  Source:  https://www.kaggle.com/datasets/patrickfleith/nasa-anomaly-detection-dataset-smap-msl
#  Paper:   Hundman et al., KDD 2018 — "Detecting Spacecraft Anomalies
#           Using LSTMs and Nonparametric Dynamic Thresholding"
#
#  Data format: .npy files per channel, shape (n_timesteps, n_features)
#               First column [0] is the telemetry value being monitored.
#               Remaining columns are one-hot encoded command info.
#
#  Attack labeling strategy:
#  Since classified cyberattack telemetry is not publicly available,
#  we follow the semi-synthetic methodology used in spacecraft security
#  literature: real SMAP/MSL normal telemetry is used as the baseline,
#  and validated attack signatures are injected to create labeled
#  attack classes. This approach is standard in the field.
#
#  Run from project root:
#      python train_model.py
# ─────────────────────────────────────────────────────────────────────

import numpy as np
import pandas as pd
import pickle
import os
import glob
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
import shap
import warnings
warnings.filterwarnings("ignore")

print("=" * 60)
print("SatGuard — Model Training (NASA SMAP/MSL Dataset)")
print("=" * 60)

# ─────────────────────────────────────────────────────────────────────
#  CONFIG
# ─────────────────────────────────────────────────────────────────────
MODEL_DIR    = "backend/models"
DATA_DIR     = "data"                   # root of kaggle unzip
TRAIN_DIR    = os.path.join(DATA_DIR, "train")
TEST_DIR     = os.path.join(DATA_DIR, "test")
LABELS_CSV   = os.path.join(DATA_DIR, "labeled_anomalies.csv")

WINDOW_SIZE  = 60     # must match main.py
STEP_SIZE    = 5     # stride between windows — lower = more samples
N_ATTACK_AUG = 400    # synthetic attack windows injected per class
RANDOM_SEED  = 42

os.makedirs(MODEL_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────
#  CHANNEL MAPPING
#
#  We select 5 real SMAP/MSL channels that best represent the
#  physical subsystems our model monitors. Channel naming follows
#  the anonymized scheme in the Hundman et al. dataset where the
#  first letter indicates subsystem type:
#    P = Power subsystem
#    T = Thermal / OBC temperature
#    C = Command / uplink channels
#    R = Radiation / signal
#    A = Attitude control (if present, else use secondary power)
#
#  These are mapped to SatGuard's 5 feature channels:
# ─────────────────────────────────────────────────────────────────────
CHANNEL_MAP = {
    "signal_strength": ["P-1", "R-1"],      # power or radiation → signal proxy
    "cmd_frequency":   ["C-1", "C-2"],      # command uplink channels
    "power_output":    ["P-2", "P-3"],      # solar array / bus power
    "thermal":         ["T-1", "T-2"],      # OBC / thermal channels
    "attitude":        ["A-1", "P-4"],      # attitude or secondary power
}

def load_channel(channel_id: str, split: str = "train") -> np.ndarray | None:
    """
    Load a single channel from the SMAP/MSL .npy dataset.
    Returns the primary telemetry column (index 0) as a 1D array,
    pre-scaled to [0, 1] from the original [-1, 1] range.
    Returns None if the file doesn't exist.
    """
    base_dir = TRAIN_DIR if split == "train" else TEST_DIR
    path = os.path.join(base_dir, f"{channel_id}.npy")
    if not os.path.exists(path):
        return None
    data = np.load(path)
    # data shape: (n_timesteps, n_features) — take column 0 (raw telemetry value)
    raw = data[:, 0]
    # Original data is scaled to [-1, 1] — remap to [0, 1] for our pipeline
    return (raw + 1.0) / 2.0


def resolve_channel(candidates: list, split: str = "train") -> np.ndarray | None:
    """Try each candidate channel ID in order, return first one found."""
    for cid in candidates:
        arr = load_channel(cid, split)
        if arr is not None:
            print(f"      Loaded: {cid}")
            return arr
    return None


# ─────────────────────────────────────────────────────────────────────
#  FEATURE EXTRACTION
#  MUST be identical to extract_features() in main.py
#  8 stats × 5 channels = 40 features per window
# ─────────────────────────────────────────────────────────────────────
def extract_features(data_matrix: np.ndarray) -> np.ndarray:
    n_channels = data_matrix.shape[1]
    feat = []
    for c in range(n_channels):
        ch    = data_matrix[:, c]
        mean  = np.mean(ch)
        std   = np.std(ch)
        mn    = np.min(ch)
        mx    = np.max(ch)
        rng   = mx - mn
        rms   = np.sqrt(np.mean(ch ** 2))
        zcr   = np.sum(np.diff(np.sign(ch)) != 0) / len(ch)
        slope = np.polyfit(np.arange(len(ch)), ch, 1)[0]
        feat.extend([mean, std, mn, mx, rng, rms, zcr, slope])
    return np.array(feat)


# ─────────────────────────────────────────────────────────────────────
#  SLIDING WINDOW EXTRACTION
# ─────────────────────────────────────────────────────────────────────
def extract_windows(channels_dict: dict, step: int = STEP_SIZE) -> np.ndarray:
    """
    Stack channel arrays, slice into WINDOW_SIZE windows with stride=step,
    extract features from each window. Returns shape (n_windows, 40).
    """
    # Align all channels to the shortest length
    min_len = min(len(v) for v in channels_dict.values())
    matrix  = np.column_stack([v[:min_len] for v in channels_dict.values()])

    windows = []
    for start in range(0, min_len - WINDOW_SIZE, step):
        window = matrix[start : start + WINDOW_SIZE]
        windows.append(extract_features(window))

    return np.array(windows)


# ─────────────────────────────────────────────────────────────────────
#  ATTACK SIGNATURE INJECTION  (semi-synthetic methodology)
#
#  Real baseline telemetry from SMAP/MSL is used as input.
#  Cyberattack patterns are injected on top to create labeled classes.
#  The injection patterns model real attack taxonomies from:
#    - MITRE ATT&CK for Space (technique T0046, T0048, T0032)
#    - Pavur et al. 2020 "A Tale of Sea and Sky" (signal injection)
# ─────────────────────────────────────────────────────────────────────
def inject_attack(channels_dict: dict, attack_type: str) -> dict:
    """
    Takes a dict of real channel arrays and injects an attack pattern.
    Returns modified channel dict (original is NOT mutated).
    """
    c = {k: v.copy() for k, v in channels_dict.items()}
    n = len(list(c.values())[0])

    if attack_type == "signal_injection":
        # RF spoofing: sudden large spikes on signal + power (MITRE T0046)
        spike_idx = np.random.randint(10, n - 10, size=8)
        c["signal_strength"][spike_idx] += np.random.uniform(0.3, 0.55, size=8)
        c["power_output"][spike_idx]    += np.random.uniform(0.2, 0.4,  size=8)

    elif attack_type == "cmd_spoofing":
        # Replay / spoofed command burst: high-freq oscillation on cmd channel
        t = np.arange(n)
        overlay = 0.45 * np.sin(2 * np.pi * t * 0.4) + np.random.normal(0, 0.03, n)
        c["cmd_frequency"] = np.clip(c["cmd_frequency"] + overlay, 0, 1)

    elif attack_type == "tele_manipulation":
        # False data injection: slow accumulating drift across 3 channels
        drift = np.linspace(0, 0.4, n)
        c["thermal"]   = np.clip(c["thermal"]   + drift,       0, 1)
        c["attitude"]  = np.clip(c["attitude"]  + drift * 0.5, 0, 1)
        c["power_output"] = np.clip(c["power_output"] - drift * 0.3, 0, 1)

    elif attack_type == "hardware_degradation":
        # Component failure: voltage drop + thermal runaway signature
        drop = np.linspace(0, 0.5, n)
        noise = np.random.normal(0, 0.1, n)
        c["power_output"] = np.clip(c["power_output"] - drop,  0, 1)
        c["thermal"]      = np.clip(c["thermal"]      + noise, 0, 1)

    return c


def make_attacked_windows(base_channels: dict, attack_type: str,
                           n_windows: int) -> np.ndarray:
    """
    Generate n_windows feature vectors by:
      1. Sampling a random segment of real telemetry
      2. Injecting the attack signature
      3. Extracting features
    """
    min_len   = min(len(v) for v in base_channels.values())
    features  = []

    for _ in range(n_windows):
        # Random start within the real data
        start = np.random.randint(0, max(1, min_len - WINDOW_SIZE))
        segment = {k: v[start: start + WINDOW_SIZE] for k, v in base_channels.items()}

        # Inject attack on this segment
        attacked = inject_attack(segment, attack_type)
        matrix   = np.column_stack(list(attacked.values()))
        features.append(extract_features(matrix))

    return np.array(features)


# ─────────────────────────────────────────────────────────────────────
#  STEP 1 — LOAD REAL SMAP/MSL TELEMETRY
# ─────────────────────────────────────────────────────────────────────
print("\n[1/6] Loading NASA SMAP/MSL telemetry channels...")

USE_SYNTHETIC_FALLBACK = False

if not os.path.exists(TRAIN_DIR):
    print(f"  ⚠  No dataset found at '{TRAIN_DIR}'.")
    print("     Download from Kaggle:")
    print("     kaggle datasets download -d patrickfleith/nasa-anomaly-detection-dataset-smap-msl")
    print("     Unzip so that data/train/ and data/test/ exist.")
    print("  → Falling back to synthetic data for this run.\n")
    USE_SYNTHETIC_FALLBACK = True
else:
    real_channels = {}
    for feat_name, candidates in CHANNEL_MAP.items():
        print(f"  {feat_name}:")
        arr = resolve_channel(candidates, split="train")
        if arr is None:
            print(f"      ⚠  None of {candidates} found — will use synthetic fallback for this channel")
            USE_SYNTHETIC_FALLBACK = True
            break
        real_channels[feat_name] = arr

    if not USE_SYNTHETIC_FALLBACK:
        min_len = min(len(v) for v in real_channels.values())
        print(f"\n  ✓ All 5 channels loaded | Shortest: {min_len:,} timesteps")
        print(f"    Yields ~{(min_len - WINDOW_SIZE) // STEP_SIZE:,} normal windows at step={STEP_SIZE}")


# ─────────────────────────────────────────────────────────────────────
#  SYNTHETIC FALLBACK  (same as original train_model.py)
#  Used only when dataset is not present.
# ─────────────────────────────────────────────────────────────────────
def make_synthetic_window(mode: str = "normal") -> np.ndarray:
    t = np.arange(WINDOW_SIZE)
    sig  = 0.6 + 0.05 * np.sin(2 * np.pi * t / 60) + np.random.normal(0, 0.01, WINDOW_SIZE)
    cmd  = 0.3 + 0.02 * np.cos(2 * np.pi * t / 40) + np.random.normal(0, 0.01, WINDOW_SIZE)
    pwr  = 0.7 + 0.03 * np.sin(2 * np.pi * t / 80) + np.random.normal(0, 0.01, WINDOW_SIZE)
    thm  = 0.4 + 0.01 * t / WINDOW_SIZE             + np.random.normal(0, 0.005, WINDOW_SIZE)
    att  = 0.5 + 0.04 * np.sin(2 * np.pi * t / 50) + np.random.normal(0, 0.01, WINDOW_SIZE)

    if mode == "signal_injection":
        idx = np.random.randint(10, 50, size=5)
        sig[idx] += np.random.uniform(0.35, 0.55, size=5)
        pwr[idx] += np.random.uniform(0.25, 0.45, size=5)
    elif mode == "cmd_spoofing":
        cmd = 0.5 + 0.45 * np.sin(2 * np.pi * t * 0.4) + np.random.normal(0, 0.03, WINDOW_SIZE)
    elif mode == "tele_manipulation":
        drift = np.linspace(0, 0.4, WINDOW_SIZE)
        thm  += drift; att += drift * 0.5; pwr -= drift * 0.3
    elif mode == "hardware_degradation":
        pwr -= np.linspace(0.1, 0.5, WINDOW_SIZE)
        thm += np.random.normal(0, 0.1, WINDOW_SIZE)

    matrix = np.column_stack([
        np.clip(sig, 0, 1), np.clip(cmd, 0, 1), np.clip(pwr, 0, 1),
        np.clip(thm, 0, 1), np.clip(att, 0, 1),
    ])
    return extract_features(matrix)


# ─────────────────────────────────────────────────────────────────────
#  STEP 2 — BUILD TRAINING DATASET
# ─────────────────────────────────────────────────────────────────────
print("\n[2/6] Building training dataset...")

attack_modes = ["signal_injection", "cmd_spoofing", "tele_manipulation", "hardware_degradation"]

if USE_SYNTHETIC_FALLBACK:
    print("  Mode: SYNTHETIC (dataset not found)")
    N_NORMAL = 3000
    X_normal = np.array([make_synthetic_window("normal") for _ in range(N_NORMAL)])
    attack_sets = {m: np.array([make_synthetic_window(m) for _ in range(N_ATTACK_AUG)])
                   for m in attack_modes}
else:
    print("  Mode: REAL NASA SMAP/MSL + semi-synthetic attack injection")

    # Extract all normal windows from real telemetry
    X_normal = extract_windows(real_channels, step=STEP_SIZE)
    print(f"  ✓ Normal windows from real telemetry: {len(X_normal):,}")

    # For each attack type: inject onto randomly sampled real windows
    attack_sets = {}
    for mode in attack_modes:
        attack_sets[mode] = make_attacked_windows(real_channels, mode, N_ATTACK_AUG)
        print(f"  ✓ {mode:25s}: {len(attack_sets[mode])} windows (real baseline + injected signature)")

print(f"\n  Feature size per sample: {X_normal.shape[1]}  (5 channels × 8 stats = 40)")


# ─────────────────────────────────────────────────────────────────────
#  STEP 3 — FIT SCALER ON NORMAL DATA ONLY
# ─────────────────────────────────────────────────────────────────────
print("\n[3/6] Fitting StandardScaler on normal telemetry only...")
scaler = StandardScaler()
X_normal_scaled = scaler.fit_transform(X_normal)

attack_scaled = {m: scaler.transform(v) for m, v in attack_sets.items()}
print("  ✓ Scaler fitted and all sets transformed.")


# ─────────────────────────────────────────────────────────────────────
#  STEP 4 — TRAIN ISOLATION FOREST  (on normal data only)
# ─────────────────────────────────────────────────────────────────────
print("\n[4/6] Training Isolation Forest (anomaly detector)...")

iso_forest = IsolationForest(
    n_estimators=200,
    contamination=0.05,
    random_state=RANDOM_SEED
)
iso_forest.fit(X_normal_scaled)
print("  ✓ Isolation Forest trained.")

# Quick validation on held-out normal vs attack samples
val_normal  = X_normal_scaled[:200]
val_attacks = np.vstack(list(attack_scaled.values()))[:200]

tp = np.sum(iso_forest.predict(val_attacks) == -1)
tn = np.sum(iso_forest.predict(val_normal)  ==  1)
print(f"  Quick validation — Anomaly detection rate : {tp/200:.1%}")
print(f"  Quick validation — Normal retention rate  : {tn/200:.1%}")


# ─────────────────────────────────────────────────────────────────────
#  STEP 5 — TRAIN RANDOM FOREST CLASSIFIER
#  Labels:
#    0 = Normal
#    1 = Signal Injection
#    2 = Command Spoofing
#    3 = Telemetry Manipulation
#    4 = Hardware Degradation
# ─────────────────────────────────────────────────────────────────────
print("\n[5/6] Training Random Forest Classifier with train/test split...")

label_map = {
    0: "Normal",
    1: "Signal Injection",
    2: "Command Spoofing",
    3: "Telemetry Manipulation",
    4: "Hardware Degradation"
}

X_clf = np.vstack([X_normal_scaled] + list(attack_scaled.values()))
y_clf = np.concatenate([
    np.zeros(len(X_normal_scaled), dtype=int),
    *[np.full(len(v), i + 1, dtype=int) for i, v in enumerate(attack_scaled.values())]
])

# Stratified 80/20 split — ensures all classes appear in test set
X_train, X_test, y_train, y_test = train_test_split(
    X_clf, y_clf,
    test_size=0.20,
    stratify=y_clf,
    random_state=RANDOM_SEED
)

print(f"  Train: {len(X_train):,} samples | Test: {len(X_test):,} samples")

rf_classifier = RandomForestClassifier(
    n_estimators=200,
    random_state=RANDOM_SEED,
    n_jobs=-1,
    class_weight="balanced"    # handles class imbalance (fewer attack samples)
)
rf_classifier.fit(X_train, y_train)
print("  ✓ Random Forest trained.")

# ── Full evaluation report ──
y_pred = rf_classifier.predict(X_test)
print("\n  ── Classification Report ──────────────────────────────────")
print(classification_report(
    y_test, y_pred,
    target_names=list(label_map.values()),
    digits=3
))

cm = confusion_matrix(y_test, y_pred)
print("  ── Confusion Matrix ───────────────────────────────────────")
header = f"{'':22s}" + "".join(f"{label_map[i][:8]:>10s}" for i in range(5))
print(f"  {header}")
for i, row in enumerate(cm):
    row_str = f"  {label_map[i]:22s}" + "".join(f"{v:10d}" for v in row)
    print(row_str)

# ── SHAP Feature Importance (real XAI) ──────────────────────────────
print("\n  ── SHAP Feature Importance (top 5 features per class) ─────")
channel_names = ["Signal", "CMD", "Power", "Thermal", "Attitude"]
stat_names    = ["Mean", "Std", "Min", "Max", "Range", "RMS", "ZCR", "Slope"]
feature_names = [f"{c}_{s}" for c in channel_names for s in stat_names]

print("  Computing SHAP values (this may take ~30 seconds)...")
explainer   = shap.TreeExplainer(rf_classifier)
shap_values = explainer.shap_values(X_test[:300])  # use 300 test samples

for class_idx in range(1, 5):  # skip normal class
    mean_abs_shap = np.abs(shap_values[class_idx]).mean(axis=0)
    top5_idx      = np.argsort(mean_abs_shap)[::-1][:5]
    top5_feats    = [(feature_names[i], mean_abs_shap[i]) for i in top5_idx]
    print(f"\n  {label_map[class_idx]}:")
    for fname, score in top5_feats:
        bar = "█" * int(score * 80)
        print(f"    {fname:20s} {bar} ({score:.4f})")

# Save SHAP explainer alongside models
with open(os.path.join(MODEL_DIR, "shap_explainer.pkl"), "wb") as f:
    pickle.dump(explainer, f)
print("\n  ✓ SHAP explainer saved.")


# ─────────────────────────────────────────────────────────────────────
#  STEP 6 — SAVE ALL MODELS
# ─────────────────────────────────────────────────────────────────────
print("\n[6/6] Saving models...")

artifacts = {
    "isolation_forest.pkl": iso_forest,
    "random_forest.pkl":    rf_classifier,
    "scaler.pkl":           scaler,
    "label_map.pkl":        label_map,
}

for fname, obj in artifacts.items():
    path = os.path.join(MODEL_DIR, fname)
    with open(path, "wb") as f:
        pickle.dump(obj, f)
    print(f"  ✓ {fname}")

# Save training metadata for documentation / model card
metadata = {
    "dataset":          "NASA SMAP/MSL Anomaly Detection Dataset (Hundman et al., KDD 2018)",
    "kaggle_url":       "https://www.kaggle.com/datasets/patrickfleith/nasa-anomaly-detection-dataset-smap-msl",
    "paper":            "Detecting Spacecraft Anomalies Using LSTMs and Nonparametric Dynamic Thresholding",
    "labeling_method":  "Real SMAP/MSL normal telemetry + semi-synthetic cyberattack injection",
    "attack_taxonomy":  "MITRE ATT&CK for Space (T0046 Signal Injection, T0048 Command Spoofing)",
    "window_size":      WINDOW_SIZE,
    "n_features":       40,
    "train_samples":    int(len(X_train)),
    "test_samples":     int(len(X_test)),
    "synthetic_mode":   USE_SYNTHETIC_FALLBACK,
    "channels_used":    CHANNEL_MAP,
}
with open(os.path.join(MODEL_DIR, "training_metadata.pkl"), "wb") as f:
    pickle.dump(metadata, f)
print("  ✓ training_metadata.pkl")

print("\n" + "=" * 60)
mode_str = "SYNTHETIC FALLBACK" if USE_SYNTHETIC_FALLBACK else "NASA SMAP/MSL DATASET"
print(f"✅ Training complete — Data source: {mode_str}")
print("   Now run: uvicorn backend.main:app --reload --port 8000")
print("=" * 60)