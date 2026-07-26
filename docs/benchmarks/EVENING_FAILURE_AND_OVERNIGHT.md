# Evening failure tests + overnight soak

**Branch:** `feature/capture-core`  
**Host:** Terminal.app only (not agent). Leave Mac awake.

Policies: `CAPTURE_CORE_STAGE6_FAILURE_POLICIES.md`  
Matrix: `CAPTURE_CORE_STAGE6_MATRIX.md`

---

## Before you start

```sh
cd /Users/sterlingdigital/eyeballs-capture-core
# optional: confirm devices
sh scripts/dev/run-capture-core-soak.sh list-devices
```

Plug in Brio + Yeti for dual tests. Built-in is fine only where noted.

---

## Short failure battery (~45–60 min total)

Run each script; follow on-screen prompts. Each writes under `/tmp/capture-core-failure/…` and a `FAILURE_RESULT.txt`.

### 1. SIGKILL (automated, ~1 min)

```sh
sh scripts/dev/run-failure-sigkill.sh
cat /tmp/capture-core-failure/sigkill-*/FAILURE_RESULT.txt
```

### 2. Camera unplug (~3 min)

```sh
sh scripts/dev/run-failure-camera-unplug.sh
# When prompted: unplug Brio, wait, press Enter
cat /tmp/capture-core-failure/camera-unplug-*/FAILURE_RESULT.txt
```

### 3. Mic unplug (~3 min)

```sh
sh scripts/dev/run-failure-mic-unplug.sh
# When prompted: unplug Yeti, wait, press Enter
cat /tmp/capture-core-failure/mic-unplug-*/FAILURE_RESULT.txt
```

### 4. Yeti mute / silence (~2 min)

```sh
sh scripts/dev/run-failure-mute.sh
# When prompted: mute Yeti hardware mute ~20s, unmute, press Enter
cat /tmp/capture-core-failure/mute-*/FAILURE_RESULT.txt
```

### 5. Tauri force quit (~5 min, manual)

```sh
npm run prepare:capture-core
npm run tauri dev
```

1. Dataset → match devices → **Run 30s live slice**  
2. After ~10s: **Force Quit** Camera Presence Coach (⌘⌥Esc)  
3. Relaunch app → Dataset → Scan orphans / Developer details  
4. Note: no continuous resume of same take; incomplete session on disk  

Fill matrix row 8 by hand in `CAPTURE_CORE_STAGE6_MATRIX.md` or paste notes to the agent.

---

## Overnight multi-hour dual (after short battery)

Lower-cost 1080p dual, 3 hours (change `10800` if you want longer):

```sh
cd /Users/sterlingdigital/eyeballs-capture-core
# prevent sleep if you want belt-and-suspenders (script also caffeinates capture-core)
caffeinate -dims sh scripts/dev/run-capture-core-soak.sh brio-yeti-1080 10800
```

In the morning:

```sh
cat /tmp/capture-core-soak/brio-yeti-1080-*/SOAK_RESULT.txt
cat /tmp/capture-core-soak/brio-yeti-1080-*/ANALYSIS_REPORT.txt | head -40
```

Paste those to the agent for matrix row 3.

---

## What to send back

1. Each `FAILURE_RESULT.txt` (or the whole `/tmp/capture-core-failure` listing)  
2. Overnight `SOAK_RESULT.txt`  
3. Any crash dialogs or unexpected “complete” seals  

Do **not** fill the system disk for disk-pressure (row 9) tonight unless you have a small external/test volume ready.
