# 🛰️ Kavach — AI Cyber Immune System for Satellite Networks

**Real-time ML-powered anomaly detection and cyber-threat classification for satellite telemetry.**

Kavach (SatGuard) is an AI-based cybersecurity system designed to monitor satellite telemetry, detect abnormal behavior, classify potential cyberattacks, and visualize threats through a 3D mission-control dashboard.

> **Note:** Kavach is a hackathon prototype and is not connected to real satellites.

---

## 🚀 What Kavach Does

Kavach continuously monitors satellite telemetry and uses machine learning to:

* Detect abnormal telemetry behavior
* Identify potential cyberattacks
* Classify the type of attack
* Calculate a real-time threat score
* Log security incidents
* Visualize satellite activity through a 3D dashboard
* Simulate different cyberattack scenarios

---

## 🏗️ System Architecture

The system consists of four major layers:

1. **Telemetry Layer**

   * NASA telemetry or synthetic telemetry data
   * Data is processed using rolling 60-sample windows

2. **ML Feature Extraction**

   * Extracts 8 statistical features from each telemetry channel
   * Uses 5 telemetry channels
   * Produces a 40-dimensional feature vector

3. **AI Immune System**

   * Isolation Forest detects anomalies
   * Random Forest classifies the attack type

4. **Mission Control Dashboard**

   * FastAPI provides the ML results through REST APIs
   * Three.js renders the satellite environment in 3D

### Data Flow

```text
Telemetry Data
      |
      v
60-Sample Rolling Window
      |
      v
Feature Extraction
8 Features × 5 Channels
      |
      v
40-Dimensional Feature Vector
      |
      v
StandardScaler
      |
      +----------------------+
      |                      |
      v                      v
Isolation Forest       Random Forest
Anomaly Detection      Attack Classification
      |                      |
      +----------+-----------+
                 |
                 v
           Threat Engine
                 |
                 v
          Threat Score
                 |
                 v
           FastAPI Backend
                 |
                 v
       3D Mission Dashboard
```

---

# 🤖 Machine Learning Pipeline

## 1. Sliding-Window Feature Engineering

Kavach processes telemetry using a **60-sample rolling window**.

For each of the 5 telemetry channels, 8 statistical features are calculated.

This produces:

```text
8 features × 5 channels = 40 features
```

### Features

| # | Feature            | Description                            |
| - | ------------------ | -------------------------------------- |
| 1 | Mean               | Average value of the signal            |
| 2 | Standard Deviation | Measures signal volatility             |
| 3 | Minimum            | Lowest observed value                  |
| 4 | Maximum            | Highest observed value                 |
| 5 | Range              | Difference between maximum and minimum |
| 6 | RMS                | Effective signal power                 |
| 7 | Zero-Crossing Rate | Approximate frequency-domain behavior  |
| 8 | Slope              | Direction and rate of temporal drift   |

---

# 🛡️ Two-Stage AI Defense

Kavach uses two machine-learning models in sequence.

```text
Raw Telemetry
      |
      v
Feature Extraction
      |
      v
StandardScaler
      |
      v
Isolation Forest
      |
      +---- Normal ----> MONITORING
      |
      +---- Anomaly
              |
              v
        Random Forest
              |
              v
       Attack Classification
              |
              v
         Threat Engine
              |
              v
          Threat Score
```

## Stage 1 — Anomaly Detection

**Isolation Forest** determines whether the incoming telemetry behaves abnormally.

Output:

```text
Normal
or
Anomalous
```

## Stage 2 — Attack Classification

When suspicious behavior is detected, a **Random Forest classifier** predicts the most likely attack type and provides a confidence score.

---

# ⚠️ Threat Scoring

Kavach combines anomaly severity and attack-classification confidence into a single threat score.

```text
Threat Score =
(anomaly_metric × 0.6) +
(confidence × 0.4)
```

### Threat Levels

| Score     | Threat Level  | Meaning                            |
| --------- | ------------- | ---------------------------------- |
| 0.0 – 0.3 | 🟢 NORMAL     | No significant threat detected     |
| 0.3 – 0.6 | 🟡 SUSPICIOUS | Potential abnormal behavior        |
| 0.6 – 1.0 | 🔴 HIGH RISK  | Strong indication of a cyberattack |

---

# 🎯 Attack Detection

Kavach currently supports four telemetry classes.

| Class | Attack Type            | Typical Signature        | Response          |
| ----- | ---------------------- | ------------------------ | ----------------- |
| 0     | Normal                 | Baseline telemetry       | `MONITORING`      |
| 1     | Signal Injection       | RF channel spikes        | `BLOCK TX NODE`   |
| 2     | Command Spoofing       | Command-frequency bursts | `ISOLATE CHANNEL` |
| 3     | Telemetry Manipulation | Gradual sensor drift     | `SCRAMBLE COMMS`  |

> These response actions are simulated defensive actions for the prototype. They do not control real spacecraft systems.

---

# 📂 Project Structure

```text
satguard/
│
├── train_model.py
├── requirements.txt
├── README.md
│
├── data/
│   ├── train/
│   │   └── *.npy
│   │
│   └── test/
│       └── *.npy
│
├── frontend/
│   ├── index.html
│   │
│   └── js/
│       └── api.js
│
└── backend/
    ├── main.py
    │
    └── models/
        ├── isolation_forest.pkl
        ├── random_forest.pkl
        ├── scaler.pkl
        └── label_map.pkl
```

---

# ⚡ Quick Start

## 1. Clone the Repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd satguard
```

## 2. Install Dependencies

```bash
pip install -r requirements.txt
```

## 3. Train the ML Models

```bash
python train_model.py
```

If a dataset is not available, the training script automatically generates synthetic satellite telemetry.

The training process creates the following files:

```text
backend/models/
├── isolation_forest.pkl
├── random_forest.pkl
├── scaler.pkl
└── label_map.pkl
```

Training typically takes less than 30 seconds.

---

# 🖥️ Start the Backend

Run:

```bash
uvicorn backend.main:app --reload --port 8000
```

The API will be available at:

```text
http://localhost:8000
```

---

# 🌐 Open the Dashboard

Open:

```text
frontend/index.html
```

in a modern web browser.

The dashboard automatically connects to the FastAPI backend and begins receiving telemetry data.

---

# 🔌 API Reference

FastAPI automatically provides interactive API documentation.

Open:

```text
http://localhost:8000/docs
```

### Available Endpoints

| Method | Endpoint           | Description                          |
| ------ | ------------------ | ------------------------------------ |
| GET    | `/`                | Health check and API version         |
| GET    | `/status`          | Model readiness and incident count   |
| POST   | `/predict`         | Run ML inference on telemetry        |
| GET    | `/simulate/{type}` | Simulate an attack scenario          |
| GET    | `/incidents`       | Retrieve detected security incidents |
| POST   | `/reset`           | Clear the incident log               |

---

# 🧪 Attack Simulation

The backend supports four simulation modes:

```text
normal
signal_injection
cmd_spoofing
tele_manipulation
```

Example:

```text
GET /simulate/signal_injection
```

Other examples:

```text
GET /simulate/normal
GET /simulate/cmd_spoofing
GET /simulate/tele_manipulation
```

These simulations generate synthetic telemetry patterns designed to resemble different attack signatures.

---

# 🖥️ Mission Control Dashboard

The frontend uses **Three.js** to create a high-fidelity 3D mission-control interface.

The dashboard provides:

* 3D Earth visualization
* Satellite visualization
* Telemetry monitoring
* Threat indicators
* Attack classification
* Confidence scores
* Threat levels
* Incident history
* Attack simulation controls
* Real-time backend communication

The interface is built using:

* HTML5
* CSS3
* Vanilla JavaScript
* Three.js

---

# 🧰 Technology Stack

| Layer                 | Technology                    |
| --------------------- | ----------------------------- |
| 3D Visualization      | Three.js r128                 |
| Frontend              | HTML, CSS, JavaScript         |
| Backend               | Python, FastAPI, Uvicorn      |
| Anomaly Detection     | Scikit-learn Isolation Forest |
| Attack Classification | Scikit-learn Random Forest    |
| Data Processing       | NumPy, Pandas                 |
| Model Storage         | Pickle                        |
| API Communication     | REST                          |

---

# 🧠 Why Two ML Models?

Using two models allows Kavach to separate **detection** from **classification**.

### Isolation Forest

Answers:

> "Does this telemetry look abnormal?"

### Random Forest

Answers:

> "If it is abnormal, what type of attack does it resemble?"

This creates a simple two-layer cyber-defense pipeline:

```text
Detection
   ↓
Classification
   ↓
Threat Scoring
   ↓
Defensive Response
```

---

# 🗺️ Enhancement Roadmap

## Tier 1 — Immediate Improvements

### WebSocket Streaming

Replace REST polling with WebSockets for continuous real-time telemetry streaming.

### Persistent Incident Database

Replace the current in-memory incident log with SQLite so incidents survive backend restarts.

### Configuration File

Move configurable values into a YAML configuration file.

Possible configuration:

```yaml
window_size: 60
anomaly_weight: 0.6
confidence_weight: 0.4

threat_levels:
  normal: 0.3
  suspicious: 0.6
```

---

# Tier 2 — Short-Term Improvements

### LSTM Autoencoder

Replace or complement Isolation Forest with an LSTM autoencoder capable of learning temporal patterns in telemetry.

### Multi-Satellite Inference

Allow a single API request to analyze telemetry from multiple satellites simultaneously.

### Model Versioning

Store multiple versions of trained models to make retraining and rollback easier.

Example:

```text
models/
├── v1/
├── v2/
└── v3/
```

### Responsive Dashboard

Add dedicated layouts for:

* Desktop
* Tablet
* Mobile

---

# Tier 3 — Advanced Research

### Graph Neural Networks

Represent the satellite constellation as a graph and detect coordinated attacks across multiple satellites.

### Reinforcement Learning

Develop an autonomous defensive agent capable of selecting optimal simulated responses.

### Federated Learning

Allow satellites to train models locally while sharing model updates instead of raw telemetry.

### Real Orbital Data

Integrate live Two-Line Element (TLE) data to display realistic satellite positions and orbital trajectories.

---

# 🔐 Security Considerations

Kavach is designed as a **research and hackathon prototype**.

It currently operates on synthetic or publicly available telemetry and does not connect to operational spacecraft.

The simulated defensive actions such as:

```text
BLOCK TX NODE
ISOLATE CHANNEL
SCRAMBLE COMMS
```

are visualization concepts only.

They do not send commands to real satellites or communication infrastructure.

---

# 📊 Example Detection Flow

A simulated signal-injection attack might produce:

```text
Telemetry
    ↓
RF channel spike detected
    ↓
Feature extraction
    ↓
Isolation Forest
    ↓
ANOMALY DETECTED
    ↓
Random Forest
    ↓
SIGNAL INJECTION
    ↓
Confidence: 94%
    ↓
Threat Score: 0.89
    ↓
HIGH RISK
    ↓
BLOCK TX NODE
```

---

# 🌌 Inspiration

Kavach is inspired by real-world satellite cybersecurity incidents, including the **2022 Viasat cyberattack**.

The project explores how machine learning and real-time telemetry analysis could contribute to a cyber-defense layer for future space infrastructure.

---

# ⚠️ Disclaimer

**Kavach is a hackathon/research prototype.**

It is not connected to real satellites, spacecraft, ground stations, or operational communication systems.

All attack scenarios and defensive actions are simulated.

---

# 👨‍💻 Project

**Kavach — AI Cyber Immune System for Satellite Networks**

Built to explore:

```text
AI
+
Cybersecurity
+
Satellite Telemetry
+
Real-Time Anomaly Detection
+
3D Mission Control
```

**Detect. Classify. Respond. Protect. 🛰️**
