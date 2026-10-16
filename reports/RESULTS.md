# STEADYGATE 2.0 CHAOS LAB BENCHMARK RESULTS (`RESULTS.md`)

**Execution Command:** `python -m steadygate.chaos --seed 1 --runs 200 --out reports/`  
**Sample Size:** `n=200` synthetic sequences (`8235` total frames; `68` intentional positive runs, `132` unsafe/negative control runs)  
**Simulated Exposure Duration:** `411.75 seconds`  
**Deterministic Seed:** `Seed 1` (`--seed 1`)  
**Level-1 Perturbations Applied (`8/8`):** `frame_drop, label_flicker, score_noise, timestamp_jitter, latency_spike, landmark_dropout, hand_loss_burst, duplicate_frames`  
**Proxy Disclosure:** Level-1 telemetry perturbations (frame_drop, label_flicker, score_noise, timestamp_jitter, latency_spike, landmark_dropout, hand_loss_burst, duplicate_frames) are deterministic proxies for physical hand occlusion, ambient lighting shifts, and motion blur.  
**Feedback Mode:** `simulated` (`LOCAL RUNTIME EXCLUSION: Hardware interface mocked.`)

---

## 1. Comparative Pipeline Evaluation (`n=200`, `Seed 1`)

| Pipeline | Intended Success (`TP / 68`) | Unintended Commands (`FP / 132`) | Duplicate Commands | Wrong-Action Commands | Missed Intended (`FN`) | False Activation Rate (%) | True Commit Rate (%) | Overall Accuracy (%) | Median Completion (ms) | Mean Commit Latency (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Naive Single-Frame** | 68 | 132 | 0 | 132 | 0 | 100.00% | 100.00% | 34.00% | 150.00 ms | 142.50 ms |
| **2. SteadyGate 1.0 Policy** | 68 | 99 | 0 | 99 | 0 | 75.00% | 100.00% | 50.50% | 1900.00 ms | 2028.44 ms |
| **3. SteadyGate 2.0 Adaptive Strictness** | 68 | 0 | 0 | 0 | 0 | 0.00% | 100.00% | 100.00% | 1950.00 ms | 1950.00 ms |

### Zero-Event Statistical Disclosure
* For **SteadyGate 2.0 Adaptive Strictness**, unintended commands = `0/132` and duplicate commands = `0/200` over a simulated exposure duration of `411.75s` (`8235` frames). The Rule-of-Three 95% upper bound (`3/n_negative = 0.0227`) is **illustrative** for this synthetic perturbation suite.

---

## 2. SteadyGate 2.0 Safety Gate Breakdown (`n=200`, `Seed 1`)

* **Intentional Clean + Tremor-Adapted Positive Sequences (`positive_clean`, `n=68`):** Verified 90-frame EMA landmark smoothing and dynamic hold scaling `hold_required = hold_baseline * (1.0 + tremor_coefficient)`. True commit rate: `100.00%`.
* **High-Risk Heater Under Degraded/Poor Telemetry (`positive_degraded_heater`, `n=33`):** Naive Single-Frame and 1.0 Policy both committed `33/33` unsafe `heater:SET_ON` commands under low brightness (`0.14`) and severe wrist jitter; **SteadyGate 2.0 Adaptive Strictness** blocked `33/33` (`100%`) via `TelemetryHealthEvaluator` (`HEALTH_LOCKED`).
* **Typing Negative Controls (`negative_typing`, `n=33`):** Rapid single-frame gesture spikes caused `33/33` false activations on Naive Single-Frame vs. `0/33` on SteadyGate 1.0 and 2.0.
* **Distracted Face Orientation (`negative_distracted_face`, `n=33`):** User looking away (`head_yaw_deg = 34.5 deg > 20.0 deg`, `gaze_in_zone = False`) caused `33/33` false commits on 1.0 Policy vs. `0/33` on **SteadyGate 2.0 FaceIntentTracker**, which rejected `33/33` (`100%`) with `USER_DISTRACTED` (`66` frame events).
* **Defective Actuator Circuit Breaker (`negative_defective_actuator`, `n=33`):** Target simulated appliance (`lamp`) reporting `DEFECTIVE` / unacknowledged fault triggered **SteadyGate 2.0 Actuator Health Circuit Breaker**, blocking `33/33` (`100%`) before issuing the `SET` packet with decision `CANCEL` and reason code `DEVICE_FAULT_LOCK` (`33` events) and alerting the Feedforward Coach (`"Action blocked: Target appliance reporting component degradation."`).
