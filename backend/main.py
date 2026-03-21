from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import os
import pickle
import datetime
import shap
from typing import List, Optional

# ─────────────────────────────────────────────
#  APP INITIALISATION
# ─────────────────────────────────────────────
app = FastAPI(title="SatGuard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
#  ML MODELS SETUP
# ─────────────────────────────────────────────
MODEL_DIR = "backend/models"

isolation_forest  = None
random_forest     = None
scaler            = None
label_map         = {}
shap_explainer    = None
training_metadata = {}

CHANNEL_NAMES = ["Signal Strength", "CMD Frequency", "Power Output", "Thermal (OBC)", "Attitude Control"]
STAT_NAMES    = ["Mean", "Std Dev", "Min", "Max", "Range", "RMS", "Zero-Crossing", "Slope"]
FEATURE_NAMES = [f"{c} {s}" for c in CHANNEL_NAMES for s in STAT_NAMES]  # 40 names total

try:
    os.makedirs(MODEL_DIR, exist_ok=True)

    def _load(fname):
        path = os.path.join(MODEL_DIR, fname)
        if os.path.exists(path):
            with open(path, "rb") as f:
                return pickle.load(f)
        return None

    isolation_forest  = _load("isolation_forest.pkl")
    random_forest     = _load("random_forest.pkl")
    scaler            = _load("scaler.pkl")
    label_map         = _load("label_map.pkl") or {}
    shap_explainer    = _load("shap_explainer.pkl")
    training_metadata = _load("training_metadata.pkl") or {}

    for name, obj in [
        ("Isolation Forest", isolation_forest),
        ("Random Forest",    random_forest),
        ("Scaler",           scaler),
        ("Label Map",        label_map),
        ("SHAP Explainer",   shap_explainer),
    ]:
        status = "✓" if obj is not None else "⚠  NOT FOUND"
        print(f"{status} {name}")

    if training_metadata:
        src = "NASA SMAP/MSL" if not training_metadata.get("synthetic_mode") else "Synthetic fallback"
        print(f"   Data source: {src}")

except Exception as e:
    print(f"ERROR DURING BOOTSTRAP: {e}")

# ─────────────────────────────────────────────
#  INCIDENT LOG
# ─────────────────────────────────────────────
incident_log = []

def add_incident(msg: str, level: str):
    now        = datetime.datetime.utcnow().isoformat()
    time_chunk = now.split("T")[1].split(".")[0]
    incident   = {"timestamp": time_chunk, "message": msg, "level": level}
    incident_log.insert(0, incident)
    if len(incident_log) > 50:
        incident_log.pop()
    return incident

# ─────────────────────────────────────────────
#  FEATURE EXTRACTION
#  Must be identical to train_model.py:
#  8 stats × 5 channels = 40 features per window
# ─────────────────────────────────────────────
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
    return np.array(feat).reshape(1, -1)

# ─────────────────────────────────────────────
#  XAI — SHAP-based root cause analysis
# ─────────────────────────────────────────────
def get_root_cause_shap(X_scaled: np.ndarray, predicted_class_idx: int) -> dict:
    """
    Uses SHAP TreeExplainer to identify which feature most strongly
    drove the predicted attack classification.
    Falls back to argmax heuristic if SHAP explainer is not loaded.
    """
    if shap_explainer is None:
        return _get_root_cause_fallback(X_scaled)

    try:
        shap_vals  = shap_explainer.shap_values(X_scaled)
        class_shap = shap_vals[predicted_class_idx][0]  # shape (40,)

        top_idx   = int(np.argmax(np.abs(class_shap)))
        top_val   = float(class_shap[top_idx])
        direction = "Spike in" if top_val > 0 else "Drop in"

        channel_part = CHANNEL_NAMES[top_idx // 8]
        stat_part    = STAT_NAMES[top_idx % 8]
        if stat_part in ["Std Dev", "Range", "RMS", "Zero-Crossing", "Slope"]:
            root_cause = f"Abnormal {stat_part} on {channel_part}"
        else:
            root_cause = f"{direction} {channel_part} {stat_part}"

        top3_idx = np.argsort(np.abs(class_shap))[::-1][:3]
        top3 = [
            {"feature": FEATURE_NAMES[i], "shap_value": round(float(class_shap[i]), 5)}
            for i in top3_idx
        ]

        return {"root_cause": root_cause, "top_features": top3, "method": "SHAP"}

    except Exception as e:
        print(f"SHAP computation failed: {e} — falling back to heuristic")
        return _get_root_cause_fallback(X_scaled)


def _get_root_cause_fallback(X_scaled: np.ndarray) -> dict:
    """Argmax fallback when SHAP explainer is not available."""
    abs_deviations = np.abs(X_scaled[0])
    max_idx     = int(np.argmax(abs_deviations))
    channel_idx = max_idx // 8
    stat_idx    = max_idx % 8
    ch_name     = CHANNEL_NAMES[channel_idx]
    st_name     = STAT_NAMES[stat_idx]
    direction   = "Spike in" if X_scaled[0][max_idx] > 0 else "Drop in"

    if st_name in ["Std Dev", "Range", "RMS", "Zero-Crossing", "Slope"]:
        root_cause = f"Abnormal {st_name} on {ch_name}"
    else:
        root_cause = f"{direction} {ch_name} {st_name}"

    return {"root_cause": root_cause, "top_features": [], "method": "heuristic"}

# ─────────────────────────────────────────────
#  REAL SMAP DATA LOADER FOR SIMULATION
# ─────────────────────────────────────────────
DATA_TRAIN_DIR = "data/train"

CHANNEL_MAP = {
    "signal_strength": ["P-1", "R-1"],
    "cmd_frequency":   ["C-1", "C-2"],
    "power_output":    ["P-2", "P-3"],
    "thermal":         ["T-1", "T-2"],
    "attitude":        ["A-1", "P-4"],
}

_real_channels: dict = {}

def _load_real_channels():
    global _real_channels
    if not os.path.exists(DATA_TRAIN_DIR):
        print("⚠  data/train/ not found — simulator will use synthetic fallback")
        return

    for feat_name, candidates in CHANNEL_MAP.items():
        for cid in candidates:
            path = os.path.join(DATA_TRAIN_DIR, f"{cid}.npy")
            if os.path.exists(path):
                raw = np.load(path)[:, 0]
                _real_channels[feat_name] = (raw + 1.0) / 2.0
                print(f"✓ Sim channel {feat_name} ← {cid} ({len(raw):,} pts)")
                break

    if len(_real_channels) == 5:
        print("✓ All 5 real SMAP channels loaded for simulation")
    else:
        print(f"⚠  Only {len(_real_channels)}/5 channels loaded — partial synthetic fallback")

_load_real_channels()


def _sample_real_baseline(n_samples: int = 60) -> dict:
    min_len = min(len(v) for v in _real_channels.values())
    start   = np.random.randint(0, max(1, min_len - n_samples))
    return {k: v[start: start + n_samples].copy() for k, v in _real_channels.items()}


def _synthetic_baseline(n_samples: int = 60) -> dict:
    t = np.arange(n_samples)
    return {
        "signal_strength": np.clip(0.6 + 0.05 * np.sin(2 * np.pi * t / 60) + np.random.normal(0, 0.01, n_samples), 0, 1),
        "cmd_frequency":   np.clip(0.3 + 0.02 * np.cos(2 * np.pi * t / 40) + np.random.normal(0, 0.01, n_samples), 0, 1),
        "power_output":    np.clip(0.7 + 0.03 * np.sin(2 * np.pi * t / 80) + np.random.normal(0, 0.01, n_samples), 0, 1),
        "thermal":         np.clip(0.4 + 0.01 * t / n_samples               + np.random.normal(0, 0.005, n_samples), 0, 1),
        "attitude":        np.clip(0.5 + 0.04 * np.sin(2 * np.pi * t / 50) + np.random.normal(0, 0.01, n_samples), 0, 1),
    }


def generate_telemetry_window(mode: str = "normal", n_samples: int = 60) -> dict:
    using_real = len(_real_channels) == 5

    if using_real:
        ch = _sample_real_baseline(n_samples)
    else:
        ch = _synthetic_baseline(n_samples)

    t = np.arange(n_samples)

    if mode == "signal_injection":
        if using_real:
            spike_idx = np.random.randint(10, n_samples - 10, size=8)
            ch["signal_strength"][spike_idx] += np.random.uniform(0.3, 0.55, size=8)
            ch["power_output"][spike_idx]    += np.random.uniform(0.2, 0.4,  size=8)
        else:
            # FIX #4 — matches make_synthetic_window() in train_model.py exactly
            spike_idx = np.random.randint(10, 50, size=5)
            ch["signal_strength"][spike_idx] += np.random.uniform(0.35, 0.55, size=5)
            ch["power_output"][spike_idx]    += np.random.uniform(0.25, 0.45, size=5)

    elif mode == "cmd_spoofing":
        if using_real:
            overlay = 0.45 * np.sin(2 * np.pi * t * 0.4) + np.random.normal(0, 0.03, n_samples)
            ch["cmd_frequency"] = np.clip(ch["cmd_frequency"] + overlay, 0, 1)
        else:
            # FIX #5 — REPLACES channel to match make_synthetic_window() in train_model.py
            ch["cmd_frequency"] = np.clip(
                0.5 + 0.45 * np.sin(2 * np.pi * t * 0.4) + np.random.normal(0, 0.03, n_samples),
                0, 1
            )

    elif mode == "tele_manipulation":
        drift = np.linspace(0, 0.4, n_samples)
        ch["thermal"]      = ch["thermal"]      + drift
        ch["attitude"]     = ch["attitude"]     + drift * 0.5
        ch["power_output"] = ch["power_output"] - drift * 0.3

    elif mode == "hardware_degradation":
        ch["power_output"] = ch["power_output"] - np.linspace(0, 0.5, n_samples)
        ch["thermal"]      = ch["thermal"]      + np.random.normal(0, 0.1, n_samples)

    return {
        "satellite_id":    "SIM-SAT-01",
        "signal_strength": np.clip(ch["signal_strength"], 0, 1).tolist(),
        "cmd_frequency":   np.clip(ch["cmd_frequency"],   0, 1).tolist(),
        "power_output":    np.clip(ch["power_output"],    0, 1).tolist(),
        "thermal":         np.clip(ch["thermal"],         0, 1).tolist(),
        "attitude":        np.clip(ch["attitude"],        0, 1).tolist(),
    }

# ─────────────────────────────────────────────
#  CORE PREDICTION LOGIC
# ─────────────────────────────────────────────
def run_prediction(satellite_id: str, channels: dict) -> dict:
    data = np.column_stack(list(channels.values()))

    if isolation_forest is None or scaler is None:
        return {
            "satellite_id": satellite_id,
            "status":       "warning",
            "message":      "ML Models not loaded. Run train_model.py first."
        }

    X_feat         = extract_features(data)
    X_scaled       = scaler.transform(X_feat)

    # Isolation Forest — anomaly detection
    pred_iso       = isolation_forest.predict(X_scaled)[0]
    score_iso      = isolation_forest.decision_function(X_scaled)[0]
    anomaly_metric = 0.5 - score_iso
    if_anomaly     = bool(pred_iso == -1)

    # Random Forest — always run for classification confidence
    pred_rf_probs       = random_forest.predict_proba(X_scaled)[0]
    predicted_class_idx = int(np.argmax(pred_rf_probs))
    rf_confidence       = float(pred_rf_probs[predicted_class_idx])

    # FIX — CAUSE 1 (RF override):
    # The Isolation Forest sometimes misses attacks because the random SMAP
    # baseline absorbs the injected signature, making the window look normal.
    # The RF classifier is far more sensitive and trained on attack patterns.
    # If RF is confident (>75%) that this is a non-Normal class, treat it as
    # an anomaly regardless of what IF says. This eliminates the majority of
    # missed detections without affecting true-normal windows (RF says class 0
    # with high confidence for those).
    rf_override = (rf_confidence > 0.75 and predicted_class_idx != 0)
    is_anomaly  = if_anomaly or rf_override

    result = {
        "satellite_id":    satellite_id,
        "status":          "ANOMALY" if is_anomaly else "NORMAL",
        "is_anomaly":      is_anomaly,
        "anomaly_score":   float(score_iso),
        "threat_score":    0.0,
        "attack_label":    "NONE DETECTED",
        "threat_level":    "NORMAL",
        "confidence":      0.0,
        "response_action": "MONITORING",
        "root_cause":      "—",
        "top_features":    [],
        "xai_method":      "none",
    }

    if is_anomaly:
        confidence   = rf_confidence
        label        = label_map.get(predicted_class_idx, "Unknown Attack")
        threat_score = (anomaly_metric * 0.6) + (confidence * 0.4)

        result["attack_label"] = label
        result["confidence"]   = round(confidence, 4)
        result["threat_score"] = round(float(threat_score), 4)

        if threat_score > 0.6:
            result["threat_level"] = "HIGH RISK"
            # FIX #3 — class 3 (Telemetry Manipulation) was missing, falling to else
            if predicted_class_idx == 1:
                result["response_action"] = "BLOCK TX NODE"
            elif predicted_class_idx == 2:
                result["response_action"] = "ISOLATE CHANNEL"
            elif predicted_class_idx == 3:
                result["response_action"] = "NOTIFY GROUND CTL"
            elif predicted_class_idx == 4:
                result["response_action"] = "ENTER SAFE MODE"
            else:
                result["response_action"] = "SCRAMBLE COMMS"
        else:
            result["threat_level"]    = "SUSPICIOUS"
            result["response_action"] = "NOTIFY GROUND CTL"

        # SHAP-based XAI
        xai = get_root_cause_shap(X_scaled, predicted_class_idx)
        result["root_cause"]   = xai["root_cause"]
        result["top_features"] = xai["top_features"]
        result["xai_method"]   = xai["method"]

        add_incident(
            f"{label} on {satellite_id} | score={threat_score:.2f} | cause={xai['root_cause']}",
            "crit" if threat_score > 0.6 else "warn"
        )

    else:
        threat_score = max(0, min(1, anomaly_metric * 0.6))
        result["threat_score"] = round(float(threat_score), 4)
        if threat_score > 0.3:
            result["threat_level"]    = "SUSPICIOUS"
            result["response_action"] = "NOTIFY GROUND CTL"

    return result

# ─────────────────────────────────────────────
#  REQUEST SCHEMAS
# ─────────────────────────────────────────────
class TelemetryWindow(BaseModel):
    satellite_id:    str
    signal_strength: List[float]
    cmd_frequency:   List[float]
    power_output:    List[float]
    thermal:         List[float]
    attitude:        List[float]

class PlaybookAction(BaseModel):
    satellite_id: str
    action: str

# ─────────────────────────────────────────────
#  ENDPOINTS
# ─────────────────────────────────────────────
@app.get("/")
def health_check():
    return {"status": "online", "version": "1.0.0", "message": "SatGuard ML Engine Active"}


@app.post("/predict")
def predict_anomaly(telemetry: TelemetryWindow):
    """Live telemetry prediction endpoint."""
    try:
        channels = {
            "signal_strength": telemetry.signal_strength,
            "cmd_frequency":   telemetry.cmd_frequency,
            "power_output":    telemetry.power_output,
            "thermal":         telemetry.thermal,
            "attitude":        telemetry.attitude,
        }
        for name, ch in channels.items():
            if len(ch) < 10:
                raise HTTPException(
                    status_code=422,
                    detail=f"Channel '{name}' needs at least 10 samples, got {len(ch)}."
                )
        return run_prediction(telemetry.satellite_id, channels)
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in prediction pipeline: {e}")
        raise HTTPException(status_code=500, detail="Internal inference error.")


@app.get("/simulate/{attack_type}")
def simulate_attack(attack_type: str):
    """
    Generates realistic telemetry for the given attack mode
    and runs the full ML + SHAP pipeline.

    Modes: normal | signal_injection | cmd_spoofing | tele_manipulation | hardware_degradation
    """
    valid_modes = ["normal", "signal_injection", "cmd_spoofing", "tele_manipulation", "hardware_degradation"]
    if attack_type not in valid_modes:
        return {"status": "error", "message": f"Unknown mode. Use: {valid_modes}"}

    window = generate_telemetry_window(mode=attack_type)
    sat_id = window.pop("satellite_id")
    result = run_prediction(sat_id, window)
    result["mode"] = attack_type
    return result


@app.get("/status")
def system_status():
    models_ready = all([isolation_forest is not None, random_forest is not None, scaler is not None])
    data_source  = "unknown"
    if training_metadata:
        data_source = "NASA SMAP/MSL (Hundman et al. 2018)" if not training_metadata.get("synthetic_mode") else "synthetic"
    return {
        "status":         "online",
        "models_ready":   models_ready,
        "shap_ready":     shap_explainer is not None,
        "data_source":    data_source,
        "incident_count": len(incident_log),
        "last_incident":  incident_log[0] if incident_log else None,
    }


@app.get("/incidents")
def get_incident_log(limit: int = 15):
    return {"incidents": incident_log[:limit]}


@app.get("/model-info")
def model_info():
    """Returns dataset provenance and training metadata."""
    if not training_metadata:
        return {"message": "No training metadata found. Run train_model.py first."}
    return training_metadata


@app.post("/reset")
def reset_server():
    global incident_log
    incident_log = []
    add_incident("System hard reset.", "safe")
    return {"status": "success"}


@app.post("/playbook")
def execute_playbook(payload: PlaybookAction):
    add_incident(f"PLAYBOOK EXECUTED on {payload.satellite_id}: {payload.action}", "safe")
    return {"status": "success", "message": f"Executed {payload.action} on {payload.satellite_id}"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)