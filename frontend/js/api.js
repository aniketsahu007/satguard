// ─────────────────────────────────────────────
// SatGuard — api.js
// Full API ↔ Dashboard Bridge
// ─────────────────────────────────────────────

const BASE_URL      = "http://127.0.0.1:8000";
const POLL_INTERVAL = 3000;  // ms
const ATTACK_HOLD_MS = 8000; // ms — ignore NORMAL results for this long after an attack fires

let backendOnline = false;
let pollTimer     = null;    // held so we can fully stop it via clearInterval
let lastAttackTime = 0;      // timestamp of last user-triggered attack result

// DVR State
const historyBuffer = [];
let isLive       = true;
let currentSatId = null;

// ─────────────────────────────────────────────
// BOOT — runs on script load
// ─────────────────────────────────────────────
(async function boot() {
    console.log("[SatGuard] 🛰️ AI Cyber Immune System Initialising...");
    console.log("[SatGuard] Backend →", BASE_URL);

    backendOnline = await checkBackendHealth();

    try {
        const statusRes  = await fetch(`${BASE_URL}/status`);
        const statusData = await statusRes.json();
        const mlEl = document.getElementById("ml-status");
        if (mlEl && statusData.data_source) {
            mlEl.title = `Trained on: ${statusData.data_source}`;
        }
    } catch {}

    if (backendOnline) {
        console.log("[SatGuard] ✅ Backend online — starting live AI polling");
        updateMLStatus(true);
        startPolling();
    } else {
        console.warn("[SatGuard] ❌ Backend offline — dashboard in standalone mode.");
        console.warn("[SatGuard] Run: uvicorn backend.main:app --reload --port 8000");
        updateMLStatus(false);
        setInterval(async () => {
            if (!backendOnline) {
                backendOnline = await checkBackendHealth();
                if (backendOnline) {
                    updateMLStatus(true);
                    startPolling();
                }
            }
        }, 10000);
    }
})();

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
async function checkBackendHealth() {
    try {
        const res  = await fetch(`${BASE_URL}/`);
        const data = await res.json();
        console.log("[SatGuard] Backend:", data.message, `v${data.version}`);
        return true;
    } catch {
        return false;
    }
}

// FIX #7 — innerHTML preserves the animated dot span
function updateMLStatus(online) {
    const el = document.getElementById("ml-status");
    if (!el) return;
    if (online) {
        el.innerHTML = '<span class="dot"></span> ML Engine Active';
        el.className = "status-badge online";
    } else {
        el.innerHTML = '<span class="dot"></span> ML Offline (Demo)';
        el.className = "status-badge warning";
    }
}

// ─────────────────────────────────────────────
// POLLING — start / stop helpers
// We keep a pollTimer reference so attack buttons
// can call clearInterval() to fully kill the timer,
// eliminating any in-flight race conditions.
// ─────────────────────────────────────────────
function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
        if (!isLive) return;
        await fetchAndApply("normal");
    }, POLL_INTERVAL);
}

function stopPolling() {
    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// ─────────────────────────────────────────────
// FETCH — calls /simulate/{mode} and applies to UI
// ─────────────────────────────────────────────
async function fetchAndApply(mode = "normal", userTriggered = false) {
    if (!backendOnline || !isLive) return;
    try {
        const res = await fetch(`${BASE_URL}/simulate/${mode}`);
        if (!res.ok) {
            console.error("[SatGuard] API error:", res.status);
            return;
        }
        const result = await res.json();

        historyBuffer.push(result);
        if (historyBuffer.length > 100) historyBuffer.shift();

        const slider = document.getElementById("dvr-slider");
        if (slider) {
            slider.max = historyBuffer.length - 1;
            if (isLive) slider.value = slider.max;
        }

        applyToUI(result, userTriggered);
        return result;

    } catch (err) {
        if (err instanceof TypeError) {
            console.error("[SatGuard] Network failure:", err.message);
            backendOnline = false;
            updateMLStatus(false);
        } else {
            console.warn("[SatGuard] Non-fatal error:", err.message);
        }
    }
}

// ─────────────────────────────────────────────
// APPLY — maps every backend field to a UI element
// ─────────────────────────────────────────────
function applyToUI(result, userTriggered = false) {
    if (!result) return;

    const score     = result.threat_score    || 0;
    const level     = result.threat_level    || "NORMAL";
    const atkLabel  = result.attack_label    || "NONE DETECTED";
    const conf      = result.confidence      || 0;
    const resp      = result.response_action || "MONITORING";
    const anomaly   = result.anomaly_score   || 0;
    const isAnomaly = result.is_anomaly      || false;
    const satId     = result.satellite_id    || "—";

    // FIX — CAUSE 2:
    // If a poll result arrives shortly after an attack was triggered,
    // and it says NORMAL, ignore it. The attack state should hold for
    // ATTACK_HOLD_MS milliseconds so a stale in-flight poll can't
    // overwrite the threat panel.
    const timeSinceAttack = Date.now() - lastAttackTime;
    if (!userTriggered && !isAnomaly && timeSinceAttack < ATTACK_HOLD_MS) {
        return;
    }

    // Record the time of a confirmed attack result
    if (userTriggered && isAnomaly) {
        lastAttackTime = Date.now();
    }

    const cls = level === "HIGH RISK"  ? "critical"
              : level === "SUSPICIOUS" ? "suspicious"
              : "normal";

    // Always updates — anomaly score number only
    const anomEl = document.getElementById("t-anom");
    if (anomEl) {
        anomEl.textContent = Math.abs(anomaly).toFixed(3);
        anomEl.className   = "val";
    }

    // Everything below ONLY updates when user pressed a button
    if (!userTriggered) return;

    // Threat Score
    const numEl = document.getElementById("threat-num");
    if (numEl) {
        numEl.textContent = score.toFixed(2);
        numEl.className   = "threat-score-main " + cls;
    }

    // Threat Label
    const lblEl = document.getElementById("threat-lbl");
    if (lblEl) {
        lblEl.innerHTML = level === "NORMAL"
            ? "<span>●</span> NORMAL"
            : `<span>●</span> ${level}`;
        lblEl.className = "threat-level-tag " + cls;
    }

    // Threat Bar
    const barEl = document.getElementById("threat-bar");
    if (barEl) {
        barEl.style.width      = Math.min(score * 100, 100) + "%";
        barEl.style.background = cls === "critical"   ? "var(--crit)"
                               : cls === "suspicious" ? "var(--warn)"
                               : "var(--ok)";
    }

    // Attack Vector / Confidence / Response
    const atkEl  = document.getElementById("atk-type-val");
    const confEl = document.getElementById("atk-conf-val");
    const respEl = document.getElementById("atk-resp-val");
    if (atkEl)  atkEl.textContent  = isAnomaly ? atkLabel : "— No Threat Detected";
    if (confEl) confEl.textContent = conf > 0 ? (conf * 100).toFixed(1) + "%" : "—";
    if (respEl) {
        respEl.textContent = resp;
        respEl.style.color = cls === "critical"   ? "var(--crit)"
                           : cls === "suspicious" ? "var(--warn)"
                           : "var(--ok)";
    }

    // XAI Root Cause
    const xaiEl = document.getElementById("t-xai");
    if (xaiEl) {
        let xaiText = isAnomaly ? (result.root_cause || "—") : "—";
        if (isAnomaly && result.xai_method === "SHAP" && result.top_features?.length > 0) {
            xaiText += " (SHAP)";
        }
        xaiEl.textContent = xaiText;
        xaiEl.className   = cls === "critical"   ? "val crit"
                          : cls === "suspicious" ? "val warn"
                          : "val";
    }

    // Playbook Button
    const btnPlaybook = document.getElementById("btn-playbook");
    if (btnPlaybook) {
        btnPlaybook.disabled = !isAnomaly;
        currentSatId = isAnomaly ? satId : null;
    }

    // System Status Pills
    if (typeof setSystemStatus === "function") {
        setSystemStatus(isAnomaly ? cls : "normal");
    }

    // Alert Banner
    const banner = document.getElementById("alert-banner");
    if (banner) {
        if (isAnomaly) {
            banner.textContent = `⚠ ${atkLabel.toUpperCase()} DETECTED — ${satId}`;
            banner.classList.add("show");
            clearTimeout(window._bannerTimer);
            window._bannerTimer = setTimeout(() => banner.classList.remove("show"), 7000);
        } else {
            banner.classList.remove("show");
        }
    }

    // FIX #2 — triggerSatelliteAttack removed.
    // _originalSimulate() already handles 3D satellite visuals.

    console.log(
        `[SatGuard] ${level.padEnd(9)} | ${atkLabel.padEnd(24)} | score=${score.toFixed(2)} | conf=${(conf * 100).toFixed(0)}%`
    );
}

// ─────────────────────────────────────────────
// INCIDENT LOG — only syncs when user presses a button
// ─────────────────────────────────────────────
async function syncIncidentLog() {
    if (!backendOnline) return;
    try {
        const res  = await fetch(`${BASE_URL}/incidents?limit=15`);
        const data = await res.json();
        const list = document.getElementById("log-list");
        if (!list || !data.incidents) return;

        list.innerHTML = "";
        data.incidents.forEach(inc => {
            const div = document.createElement("div");
            div.className = "log-entry " + (inc.level || "safe");
            // FIX #6 — log-dot span matches frontend addLog() style
            div.innerHTML = `<span class="log-dot"></span>`
                          + `<span class="log-time">${inc.timestamp}</span>`
                          + `<span class="log-msg">${inc.message}</span>`;
            list.appendChild(div);
        });
    } catch {
        // Silently fail
    }
}

// ─────────────────────────────────────────────
// SIMULATE BUTTONS
// ─────────────────────────────────────────────
const _sim_key_map = {
    "normal": "normal",
    "spoof":  "cmd_spoofing",
    "inject": "signal_injection",
    "manip":  "tele_manipulation",
    "hw":     "hardware_degradation"
};

const _originalSimulate = window.simulate;

window.simulate = function (mode) {
    isLive = true;

    const dvrSlider = document.getElementById("dvr-slider");
    if (dvrSlider) {
        dvrSlider.value = dvrSlider.max;
        const dvrText = document.getElementById("dvr-text");
        const dvrDot  = document.getElementById("dvr-dot");
        if (dvrText) { dvrText.textContent = "LIVE"; dvrText.style.color = "var(--ok)"; }
        if (dvrDot)  { dvrDot.style.background = "var(--ok)"; dvrDot.style.animation = "pulse 2s infinite"; }
    }

    // Normal button — clear attack hold, reset UI, restart polling
    if (mode === "normal") {
        lastAttackTime = 0;              // clear attack hold so polling resumes normally
        resetThreatUI();
        if (typeof _originalSimulate === "function") _originalSimulate(mode);
        startPolling();                  // restart clean polling
        return;
    }

    // Attack buttons — fully stop polling to kill any in-flight requests
    stopPolling();
    if (typeof _originalSimulate === "function") _originalSimulate(mode);

    if (backendOnline) {
        const backendMode = _sim_key_map[mode] || "normal";
        fetchAndApply(backendMode, true).then(() => syncIncidentLog());
    }
};

// ─────────────────────────────────────────────
// RESET THREAT UI — clean normal state
// ─────────────────────────────────────────────
function resetThreatUI() {
    // FIX #9 — clear both banner timers to prevent flash-back on reset
    clearTimeout(window._bannerTimer);

    const numEl  = document.getElementById("threat-num");
    const lblEl  = document.getElementById("threat-lbl");
    const barEl  = document.getElementById("threat-bar");
    const atkEl  = document.getElementById("atk-type-val");
    const confEl = document.getElementById("atk-conf-val");
    const respEl = document.getElementById("atk-resp-val");
    const xaiEl  = document.getElementById("t-xai");
    const btn    = document.getElementById("btn-playbook");
    const banner = document.getElementById("alert-banner");

    if (numEl)  { numEl.textContent = "0.00"; numEl.className = "threat-score-main normal"; }
    if (lblEl)  { lblEl.innerHTML = "<span>●</span> NORMAL"; lblEl.className = "threat-level-tag normal"; }
    if (barEl)  { barEl.style.width = "0%"; barEl.style.background = "var(--ok)"; }
    if (atkEl)  atkEl.textContent  = "— No Threat Detected";
    if (confEl) confEl.textContent = "—";
    if (respEl) { respEl.textContent = "MONITORING"; respEl.style.color = "var(--ok)"; }
    if (xaiEl)  { xaiEl.textContent = "—"; xaiEl.className = "val"; }
    if (btn)    { btn.disabled = true; }
    if (banner) banner.classList.remove("show");
    if (typeof setSystemStatus === "function") setSystemStatus("normal");
    currentSatId = null;
}

// ─────────────────────────────────────────────
// PLAYBOOK LOGIC
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const btnPlaybook = document.getElementById("btn-playbook");
    if (btnPlaybook) {
        btnPlaybook.addEventListener("click", async () => {
            if (!currentSatId) return;
            const action = document.getElementById("atk-resp-val").textContent || "ISOLATE";

            btnPlaybook.textContent = "Executing...";
            btnPlaybook.disabled    = true;

            try {
                const res = await fetch(`${BASE_URL}/playbook`, {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify({ satellite_id: currentSatId, action })
                });
                if (res.ok) {
                    btnPlaybook.textContent = "Operation Pending";
                    setTimeout(() => {
                        window.simulate("normal");
                        btnPlaybook.textContent = "Execute Playbook";
                    }, 1500);
                    syncIncidentLog();
                }
            } catch (err) {
                console.error("Playbook execution failed", err);
                btnPlaybook.textContent = "Failed";
                setTimeout(() => {
                    btnPlaybook.textContent = "Execute Playbook";
                    btnPlaybook.disabled    = false;
                }, 2000);
            }
        });
    }

    // ─────────────────────────────────────────────
    // DVR LOGIC
    // ─────────────────────────────────────────────
    const dvrSlider = document.getElementById("dvr-slider");
    const dvrText   = document.getElementById("dvr-text");
    const dvrDot    = document.getElementById("dvr-dot");

    if (dvrSlider) {
        dvrSlider.addEventListener("input", (e) => {
            const idx = parseInt(e.target.value, 10);
            const max = parseInt(e.target.max,   10);

            if (idx === max) {
                isLive = true;
                dvrText.textContent     = "LIVE";
                dvrText.style.color     = "var(--ok)";
                dvrDot.style.background = "var(--ok)";
                dvrDot.style.animation  = "pulse 2s infinite";
                // FIX #1 — userTriggered=true so full threat panel renders
                applyToUI(historyBuffer[idx], true);
            } else {
                isLive = false;
                dvrText.textContent     = `PAST: -${max - idx}s`;
                dvrText.style.color     = "var(--warn)";
                dvrDot.style.background = "var(--warn)";
                dvrDot.style.animation  = "none";
                // FIX #1 — same fix for past events
                if (historyBuffer[idx]) applyToUI(historyBuffer[idx], true);
            }
        });
    }
});