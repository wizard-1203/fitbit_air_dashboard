# Fitbit Dashboard

A local dashboard for exploring health and fitness data from Google Health. It includes interactive views for heart rate, recovery, sleep, HRV, oxygen saturation, workouts, activity, personal trends, data quality, and Fitbit device health.

**This is a local, single-user application.** The dashboard runs locally: source launch uses `http://localhost:8080`; the standalone Windows app prefers `http://localhost:8080` and falls back to ports 8082 or 8083 if needed. Your database and Google sign-in token stay on that computer. Do not expose the server to the internet or use it as a shared hosted service.

Repository: <https://github.com/wizard-1203/Fitbit-Dashboard>

All project documentation is consolidated in this one file: setup, features, score formulas, the front-end file map, tests, packaging, and troubleshooting.

## Contents

- [Install and run](#install-and-run)
  - [Windows app (no Python)](#windows-app-no-python)
  - [Run from source (Python)](#run-from-source-python)
  - [Preview with synthetic data](#preview-with-synthetic-data)
- [Google sign-in setup](#google-sign-in-setup)
- [What the dashboard includes](#what-the-dashboard-includes)
- [Daily use and syncing](#daily-use-and-syncing)
- [How the scores are calculated](#how-the-scores-are-calculated)
- [Front-end file guide](#front-end-file-guide)
- [Optional command-line tasks](#optional-command-line-tasks)
- [Testing and packaging](#testing-and-packaging)
- [Files and privacy](#files-and-privacy)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Install and run

### Windows app (no Python)

Download `FitbitDashboard-Windows.zip` from the latest GitHub Release, extract it, and run `FitbitDashboard.exe`. It opens the dashboard in your browser at `http://localhost:8080`. If port 8080 is already in use, it switches to 8082, then 8083 if necessary. Keep the console window open while using the app; closing it stops the dashboard.

The app stores its database, Google token, and settings in `%LOCALAPPDATA%\FitbitDashboard`. It does not include anyone's account credentials or health records. Live Google Health access still requires each person to configure their own OAuth client; see [Google sign-in setup](#google-sign-in-setup). For the packaged app, place that person's `client_secret.json` in `%LOCALAPPDATA%\FitbitDashboard` before selecting **Connect Google**. Register callback URLs for ports 8080, 8082, and 8083; the package selects the first available port.

Never share your credentials, `token.json`, or `health.db` with anyone.

For an offline preview with synthetic data, run this from Command Prompt:

```bat
FitbitDashboard.exe --demo
```

### Run from source (Python)

1. Download or clone this repository and keep all files together in one folder.
2. Install Python 3.9 or newer and make sure `python` works in Command Prompt.
3. Set up your own Google Cloud project and OAuth client as described in [Google sign-in setup](#google-sign-in-setup).
4. Save your OAuth client JSON beside `gh.py` as `client_secret.json`.
5. Double-click `Start_Health_Dashboard.bat`.
6. In the dashboard, click **Connect Google**, sign in, and grant the requested read-only access.
7. Leave the terminal window open while the dashboard syncs. Visit `http://localhost:8080` if it did not open automatically.

The Python scripts use the standard library; no `pip install` step is required for the documented core features. To build the Windows package yourself, run `package-windows.ps1` in PowerShell; this installs PyInstaller and creates the zip in `dist`.

### Preview with synthetic data

The repository includes a small `demo.db` containing generated sample records. It is not copied from anyone's Google or Fitbit account. To preview the interface without creating Google credentials:

```bat
python server.py --demo
```

Open `http://localhost:8080`. The dashboard displays a **demo data** badge; Google sign-in and syncing are disabled in this mode. For the packaged app, run `FitbitDashboard.exe --demo` from Command Prompt. The demo database is copied to the app data folder and remains separate from your personal `health.db`.

## Google sign-in setup

Each person must configure their own Google Cloud project and OAuth client. The repository does not include a Google client secret, health database, or saved account token. Do not share your own `client_secret.json`, `token.json`, or `health.db` with friends.

1. In Google Cloud Console, create a project and enable the Google Health API, if your account/project is eligible to use it.
2. Configure the OAuth consent screen. If your app is in **Testing** mode, add the Google account you will sign in with as a test user.
3. Create an OAuth client ID with application type **Web application**.
4. Add this exact **Authorized redirect URI**:

   ```text
   http://localhost:8080/oauth/callback
   http://localhost:8082/oauth/callback
   http://localhost:8083/oauth/callback
   ```

5. Download the client JSON as `client_secret.json`. For the packaged app, place it in `%LOCALAPPDATA%\FitbitDashboard`; for a source checkout, place it beside `gh.py`.
6. Start the dashboard, then use **Connect Google**. The token is saved locally as `token.json` and the initial sync starts in the background.

Google may show an unverified-app warning for a personal OAuth project. Follow the current Google prompts and access requirements. The dashboard requests read-only scopes for:

- Activity and fitness
- Health metrics and measurements
- Sleep
- Device settings
- Location, used for workout route data

**Access depends on Google's API and account permissions.** A requested scope does not guarantee that every endpoint is available. In particular, paired-device battery data may return a permission error even when the device-settings scope is requested. The dashboard can only show fields the API returns.

## What the dashboard includes

The available data depends on what Google returns and what has been synced.

- **Overview:** recovery summary, recent trend, and key heart, sleep, and activity metrics.
- **Heart & recovery:** daily and overnight heart rate, HRV, resting heart rate, SpO₂, respiratory rate, temperature deviation, recovery comparisons, and workout recovery where available.
- **Sleep:** sleep duration and stages, sleep score and debt estimates, overnight HRV/SpO₂, and sleep-related heart-rate views.
- **Activity & fitness:** daily activity, exercise sessions, workout details, pace and heart-rate comparisons, training-load estimates, and VO₂ max when supplied.
- **Personal patterns:** comparisons between selected metrics. Correlation does not establish cause and effect.
- **Data quality:** local database diagnostics and guarded database optimization.
- **Device health:** Fitbit battery history and estimated heart-rate coverage, when the API provides the required data.

Charts may be empty or partial when the source did not provide a value, the selected period lacks enough history, or a required permission is unavailable. A dash means unavailable; it does not mean zero.

## Daily use and syncing

- Start the app with `Start_Health_Dashboard.bat` and keep its terminal window open.
- Use **Sync now** to request an update. When signed in, the server also attempts periodic syncing about every 15 minutes.
- The first sync or a large history backfill can take time. Keep the computer awake and the server running.
- Change the dashboard's date range to explore available history. The server accepts history windows from 7 to 3650 days, subject to API retention and permissions.
- Use **Settings** for personal values such as age and sleep goal. These settings are stored in the local database.
- Use chart hover, date selectors, tables, and **See more** controls where available to inspect details.

The dashboard requires its local server. Opening `index.html` directly from File Explorer will not work as a substitute.

## How the scores are calculated

The formulas below document the dashboard's calculated scores, summaries, trends, and workout estimates as implemented (reference updated 21 October 2026). They intentionally omit heart-rate-zone calculations and thresholds. Values supplied directly by Google Health remain provider values; they are not re-created unless stated otherwise.

All scores are estimates for personal trend review. They are not clinical measurements or diagnoses. Calculated values depend on available records, configured age/sleep goal/sex where noted, and exclusions selected in the dashboard.

Dashboard recovery, sleep, debt, strain, and training-load values are estimates built from available records. They are not Google/Fitbit scores or clinically validated measures. Personal baselines need enough history and can change as more records arrive. Missing or unusual readings may reflect device fit, sampling, movement, or sync gaps. Use health concerns as a reason to consult a qualified clinician, not to rely on a dashboard score.

### 1. Time, units, and source handling

- Stored workout durations are seconds; display helpers format them as seconds, minutes, or hours and minutes.
- Sleep durations used by score calculations are minutes. Workout pace is computed from duration and distance when both are available.
- Local dates are used to group daily measurements and workouts. Missing provider values are left unavailable unless a fallback is explicitly described below.
- Excluded workouts are omitted from active workout summaries and training-load calculations.
- Historical sleep scores are frozen by sleep-session ID after the session has ended for at least six hours. A saved snapshot preserves its score and component detail; unsaved sessions use the current algorithm and available data.

### 2. Sleep score (0-100)

The score is calculated for a main sleep session, not for naps. Positive asleep duration and time-in-bed duration are required. Five fixed weights are used; missing optional components get 50 points and are marked as missing rather than having their weight redistributed.

#### 2.1 Duration versus need (40%)

- Sleep goal is the configured goal, or 8 hours when unset.
- Required sleep = clamp(goal hours + 0.05 × prior-day raw-HR strain score, max(6 hours, goal − 1 hour), 12 hours).
- Ratio = asleep minutes / (60 × required sleep hours).
- If ratio < 1: duration score = 100 × exp(−4.5 × (1 − ratio)²).
- If ratio ≥ 1: duration score = 100 × exp(−1.2 × (ratio − 1)²).

#### 2.2 Continuity (25%)

- Efficiency percent = asleep minutes / in-bed minutes × 100.
- Efficiency score is 0 at or below 50%, linear from 0 to 100 between 50% and 85%, and 100 at or above 85%.
- When stage intervals exist, awake-after-sleep-onset (WASO) is the awake time after the first non-awake sleep stage. WASO score is 100 at 20 minutes or less, 0 at 90 minutes or more, and linear in between.
- A long awakening is an awake interval longer than 5 minutes after sleep onset. Awakening score: 100 for 0-1 events, 70 for 2, 40 for 3, and 0 for 4 or more.
- With stage intervals: continuity = 0.50 × efficiency + 0.30 × WASO + 0.20 × awakening score.
- Without stage intervals: continuity falls back to efficiency alone.

#### 2.3 Architecture (15%)

- Deep percent = deep minutes / asleep minutes × 100. Deep score is 100 from 13%-23%, declines linearly to zero at 8% or 35%, and is zero outside those limits.
- REM percent = REM minutes / asleep minutes × 100. REM score is 100 from 20%-25%, declines linearly to zero at 10% or 40%, and is zero outside those limits.
- Architecture score is the mean of deep and REM scores. It is unavailable when stage data is unavailable.

#### 2.4 Bedtime/wake regularity (15%)

- Uses up to the last 28 eligible main sleeps through the session being scored; at least four are required.
- Bedtimes and wake times are treated as circular times of day, so times close across midnight remain close.
- For each series, circular standard deviation s is converted to 100 × exp(−(s / 30 minutes)^1.5). Regularity is the mean of the bedtime and wake-time scores.

#### 2.5 Sleep latency (5%)

- Latency is derived from session start to the first sleep-stage interval when available.
- Score is 100 through 20 minutes, decreases 2.5 points per minute from 20 to 60 minutes, and is 0 at 60 minutes or more.

#### 2.6 Final sleep score

- Raw weighted score = 0.40 × duration + 0.25 × continuity + 0.15 × architecture + 0.15 × regularity + 0.05 × latency.
- Missing optional components contribute 50 points at their existing weight.
- Final score is the smaller of the raw weighted score and (40 + 0.60 × duration score).

### 3. Sleep debt, naps, and Sleep/Rest

- Goal is the configured nightly target or 8 hours when unset.
- Debt is evaluated over the most recent 14 main-sleep sessions; recorded naps on/after the first included night can repay it.
- For each date, night need = goal hours × number of main sleeps that date. Add the shortfall between need and main-sleep hours.
- Night oversleep repays existing debt at 75% of the excess; debt cannot fall below zero.
- Subtract recorded nap hours one-for-one, again flooring at zero.
- Between processed dates, prior debt decays with a 3.5-night half-life: debt × 0.5^(elapsed nights / 3.5).
- Debt score = max(15, 100 × exp(−net debt hours / 10)).
- Sleep/Rest = 100 × (sleep score / 100)^0.80 × (debt score / 100)^0.20. It is unavailable without a sleep score.

### 4. Recovery score (0-100)

Inputs are current-day deep-sleep HRV, resting HR, and Sleep/Rest.

- Each HRV and resting-HR baseline uses up to 60 earlier recorded days and needs at least 14 values.
- HRV is natural-log transformed. Baseline center is the median; robust spread is 1.4826 × median absolute deviation (MAD).
- Robust z = (current value − baseline median) / (1.4826 × MAD). A signal with no usable MAD is unavailable.
- A normal cumulative distribution maps z to a 0-100 component. Higher HRV is favorable; lower resting HR is favorable, so the resting-HR z is sign-reversed.
- Autonomic score = mean(HRV component, resting-HR component). A missing signal contributes neutral 50 and remains marked missing.
- Recovery = round(0.60 × autonomic + 0.40 × Sleep/Rest). When Sleep/Rest is missing but another component exists, its term uses neutral 50 and the result is marked partial. If every component is missing, recovery is unavailable.
- Recovery is capped at 66 when respiratory rate differs from its personal baseline by more than 2 robust standard deviations, or recorded skin-temperature deviation exceeds 0.5 °C. These are simple flags, not diagnoses.

HRV recovery comparisons use personal history when enough data exists. Recovery can be partial when components are missing. Workout strain is shown separately from recovery. Heart-rate zones and training load are estimates, not medical thresholds.

### 5. Raw-HR strain and load summaries

The dashboard's raw-HR strain series is calculated separately from the recovery score. It also supplies the small strain adjustment to sleep need.

- Raw HR readings are averaged into 10-second bins. Each bin contributes the interval to the next bin, capped at 5 minutes.
- Resting-HR reserve fraction = clamp((HR − resting HR) / (estimated maximum HR − resting HR), 0, 1).
- Intensity weight = reserve fraction × exp(b × reserve fraction), where b = 1.92 for the male setting and 1.67 for the female setting.
- Dose increment = intensity weight × 1.15 × interval minutes. Intervals with reserve fraction below 0.05 contribute no dose.
- Daily strain score = 21 × (1 − exp(−daily dose / (120 / ln(2)))).
- Accumulated load decays by exp(−0.0005 × minutes elapsed) between daily values. The dashboard also reports simple means over the latest 7 and 28 available daily strain scores.
- A separate backend workout-strain estimate sums duration minutes × (average HR / 190) for non-excluded workouts on the current and previous calendar dates. This is a simpler workout summary, not the raw-HR strain formula.

### 6. Workout training load

The Training Load card uses workouts with duration, average HR, and usable resting-HR context.

- Maximum HR = 208 − 0.7 × configured age, or 190 bpm when age is unset.
- Resting HR for a workout is the latest available value on/before that workout date when it is no more than 7 days old; otherwise the median of stored resting-HR values is used.
- Reserve fraction = clamp((workout average HR − resting HR) / (maximum HR − resting HR), 0, 1).
- Per-workout TRIMP = duration minutes × reserve fraction × a × exp(k × reserve fraction). Male setting: a = 0.64, k = 1.92. Female setting: a = 0.86, k = 1.67.
- Daily TRIMP is the sum of included workout TRIMP values for that date.
- Acute training load (ATL) is an exponential moving average with 7-day time constant: ATL_t = ATL_(t−1) + (daily TRIMP − ATL_(t−1)) × (1 − exp(−1/7)).
- Chronic training load (CTL) uses the same recurrence with 28-day time constant: CTL_t = CTL_(t−1) + (daily TRIMP − CTL_(t−1)) × (1 − exp(−1/28)).
- Training stress balance (TSB) = CTL − ATL. Rest days contribute zero daily TRIMP while both averages continue to decay.

### 7. Workout and daily summaries

- Workout distance and duration are taken from usable session records. When pace is derived, pace seconds per kilometre = duration seconds × 1000 / distance metres; display units can be converted to miles.
- Daily workout duration, distance, and calories are sums of the included sessions for that date. Cumulative workout cards sum included records over the selected set.
- Session average HR is the provider value when usable; the UI may use the mean of timestamped HR samples inside the workout interval when the provider value is absent.
- Daily heart-rate distribution is calculated from stored readings: minimum, 25th percentile, median, mean, 75th percentile, maximum, and sample count.
- Where a provider daily rollup exists, it is displayed as supplied. Sample-derived daily HRV and SpO₂ fallback summaries use the median of valid samples for the day.
- Averages displayed over the latest N records use the arithmetic mean unless the chart or metric explicitly says median or uses an exponential baseline.

### 8. VO₂ max and fitness age

- A stored provider VO₂ max is preferred. If unavailable, estimated VO₂ max = 15.3 × estimated maximum HR / resting HR, requiring age and a positive resting-HR value. Estimated maximum HR = 208 − 0.7 × age.
- Fitness age estimate = (intercept − VO₂ max) / 0.28, with intercept 49.6 for the male setting and 44.6 for the female setting.
- Fitness age is first clamped to 18-90 years, then to chronological age ±20 years when chronological age is set. The display rounds to an integer.
- VO₂ fitness category is selected from embedded age-band and sex-specific reference cutoffs; it is a reference category, not a diagnosis.

### 9. Heart-rate recovery after workouts

- Peak HR is the maximum valid timestamped HR sample from workout start through workout end.
- The nominal 1-minute recovery value is the sample nearest 60 seconds after workout end within a window from 30 seconds before to 35 seconds after that point.
- One-minute drop = peak HR − the selected 1-minute recovery HR.
- Descriptive labels: at least 30 bpm = Very strong; at least 18 = Good; at least 12 = Borderline; otherwise Low drop. Missing peak/recovery data is insufficient samples.
- These labels are rough references affected by sampling and cool-down behavior.

### 10. Personal correlations and trend comparisons

- Correlation pairs only dates where both selected metrics are present and numeric. At least 3 matched dates and variation in both metrics are required.
- Pearson r = covariance divided by the product of standard deviations; it measures linear association.
- Spearman rho is Pearson correlation of ranks; tied values receive their average rank. It measures monotonic association.
- When a regression line is shown, it is ordinary least-squares linear fit. r-squared is the square of Pearson r and is not causal evidence.
- Comparisons after hard workouts use the next morning's resting HR and HRV relative to the card's personal medians. Change = next-day value − personal median; negative RHR change and positive HRV change are generally favorable directions.
- Recovery category thresholds and visual bands describe the dashboard's data; they are not clinical decision limits.

### 11. Missing values and interpretation

- Missing measurements are not automatically zero. Composite scores use neutral values only where the formula explicitly specifies them and mark coverage as partial.
- Provider rollups, wearable samples, and estimates can disagree because they use different windows, sampling, or definitions.
- Historical sleep snapshots remain fixed; other trend values can change when new source data, exclusions, or settings change.
- These calculations are personal dashboard summaries, not validated clinical scores, diagnosis, or medical advice.

## Front-end file guide

The dashboard used to be one ~700 KB `index.html`. It is now split into markup, CSS and JS files. The split is lossless: the main script's pieces join back to the original byte for byte, and the page renders identically.

```text
server.py            local server (patched to serve /css and /js, see "Serving")
gh.py                data layer (not part of this split)
index.html           markup only: sidebar, header, views, dialogs, and the <link>/<script> tags
css/                 8 stylesheets
js/                  18 scripts
```

### The one rule: load order matters

The scripts are plain classic `<script src>` files, **not ES modules**. They share one global scope, as the original single script did. That means:

- Keep the `<link>` and `<script>` tags in `index.html` in their current order.
- A file may only use, at load time, things defined in files above it. Functions called later (on click, after data loads) can live anywhere.
- `layout.js` must stay last. It wraps `window.drawChart` and `window.renderCardByElement` after they exist.
- The CSS files are order-dependent too. Later files override earlier ones, and the two override sheets sit last on purpose.

### Serving

The original `server.py` only served `/` and `/api/*`. Linking `css/` and `js/` files would have returned 404s. The included `server.py` adds one branch, placed before the `/` route:

- Serves only `/css/*.css` and `/js/*.js`, resolved inside the app folder (no path traversal).
- Everything else behaves as before, and the existing CSP (`script-src 'self'`) already permits these files.
- Packaged builds (PyInstaller): add the `css/` and `js/` folders to the bundled data, next to `index.html`.

### Files, in load order

Stylesheets 1 to 6 and `detail-box.js` load in the head. The other scripts load at the end of the body. The last two stylesheets come after them.

| # | File | Lines | What is in it |
|---|------|------:|---------------|
| 1 | `css/style.css` | 993 | Base stylesheet: variables, glass UI, layout, cards, tiles, charts, workouts, dialogs. Includes the old consolidated `layout.css`. **The biggest CSS file.** |
| 2 | `css/device-health.css` | 1 | Device-health grid and device header |
| 3 | `css/battery-layout.css` | 2 | Battery card: gauge and layout |
| 4 | `css/wear-hero.css` | 8 | Wear-time hero and stat rows |
| 5 | `css/hr-spread.css` | 31 | Final layout of the daily HR spread card (`#card-hrdaily`) |
| 6 | `css/hover-fixes.css` | 79 | Stops cards, SVGs and dots from scaling on hover. Styles the `.dp-detail-box` hover box |
| 7 | `js/detail-box.js` | 103 | Hover detail-box (`.dp-detail-box`) for chart points. Self-running |
| 8 | `js/theme-utils.js` | 118 | Glass translucency and background palettes. Shared globals (`D` = loaded data, `activeSection`, `activeSubtab`). Date, number and stats helpers (`fmtN`, `fmtDay`, `mean`, `std`, `median`, `esc`, `clamp`). Range helpers (`rangeDays`, `periodStart`). Small SVG helpers (`sparkline`, `niceTicks`, `barPath`, `catmullRom`) |
| 9 | `js/charts.js` | 459 | The chart engine: `drawChart(host, cfg)` and spline helpers. `openDayDetail` for click-through. Workout-chart tooltips |
| 10 | `js/data-helpers.js` | 85 | Daily series helpers (`dailyPts`, `lastVal`, `avgLastN`, `dailyVals`). `splitHtml` (average-split bar). Heart-rate zones (`ZONE_DEFS`, `makeZoneOf`) |
| 11 | `js/scoring.js` | 238 | Dashboard estimates. `buildDataIndexes`. Strain (`dailyStrainScore`). Sleep score and snapshots. Recovery (`computeRecovery`, `restingHrRecoveryScore`, `robustZ`). `renderHero`. VO2 and fitness age. Sleep debt |
| 12 | `js/overview.js` | 372 | Overview tab: `heartBox`, `sleepBox`, `activityBox`, `renderOverview`, zone summary. `drawHr24` (24-hour HR chart with Karvonen stops). `drawRespRate` |
| 13 | `js/recovery.js` | 185 | Heart and recovery cards: `lineCard`, daily HR, HRV vs RHR scatter (with tooltip), temperature, live stress, training prescription |
| 14 | `js/sleep.js` | 190 | Sleep cards: stage averages, duration, per-stage lines, sleep debt, sessions and the date selector, sleeping-HR card. `SLEEP_STAGE_COLORS` |
| 15 | `js/training-load.js` | 194 | Workout-trend cards: workout colors, training load, workout load, VO2 trend, workout timeline |
| 16 | `js/patterns-diagnostics.js` | 241 | Patterns and diagnostics: correlation, baselines, night comparison, data coverage. Database diagnostics and optimize. Karvonen threshold chart |
| 17 | `js/explorers.js` | 251 | `buildSpo2Explorer`, `buildSleepingHrvExplorer`, legacy `buildHrvEnvelopeLegacy` |
| 18 | `js/device-health.js` | 145 | Per-metric range selector, vitals chart, abrupt-sleep patterns. Device battery and wear charts, tooltips, `loadDeviceHealth` |
| 19 | `js/cards.js` | 233 | **`CARDS`**: the registry of every card (38 entries). `applySection` (tab and subtab navigation). HR box tooltip and outlier popover |
| 20 | `js/render-pipeline.js` | 147 | Rendering engine: payload signatures (skip redraw if data unchanged), `buildCards`, `scheduleCard`, lazy `observeChartCards`, `renderCardByElement`, `renderCharts`. Fullscreen card overlay. CSV and PNG export |
| 21 | `js/workouts.js` | 287 | Workouts tab: data prep, pace and type helpers, charts (scatter, duration, distance, recovery), VO2 cards, calendar, HR session graph, Karvonen durations, route preview, run explorer, `renderWorkouts`. Also `renderHeatmap` |
| 22 | `js/settings-boot.js` | 179 | Sync label and status. Settings dialog (`saveSettings`). Greeting. **`load()`**: fetches `/api/data` and `/api/status`, then renders everything. `pollSyncClock`. The app starts here |
| 23 | `js/avg-split.js` | 7 | Hover and focus behavior for average-split bars |
| 24 | `js/layout.js` | 120 | Card layout contract: assigns `data-span` and `--ratio` per card, sizes charts from the plot box, redraws on height change. Open `/?lint=1` for an overflow linter. Must load after the main scripts |
| 25 | `css/liquid-glass-overrides.css` | 320 | Final glass-look pass. Overrides earlier sheets, so keep it near the end |
| 26 | `css/recovery-chart-layout.css` | 23 | Workout recovery/decay chart layout fix. Last stylesheet |

### "Which file do I touch for ...?"

| Change | File |
|---|---|
| A colour, spacing or card style | `css/style.css`, then `css/liquid-glass-overrides.css` if the glass look is involved |
| A card's layout width | `js/layout.js` (the id to span table) |
| Add or remove a card, change its tab | `js/cards.js` (`CARDS`) |
| How any chart draws | `js/charts.js` |
| A score formula (sleep, strain, recovery) | `js/scoring.js` |
| Overview boxes or the 24-hour HR chart | `js/overview.js` |
| A sleep card | `js/sleep.js` |
| HRV, RHR, temperature or stress cards | `js/recovery.js` |
| SpO2 or sleeping-HRV explorers | `js/explorers.js` |
| Battery, wear or vitals | `js/device-health.js` and the three device CSS files |
| Workouts tab | `js/workouts.js` (and `js/training-load.js` for trend cards) |
| Data fetching, settings or start-up | `js/settings-boot.js` |
| Redraw, caching or export behavior | `js/render-pipeline.js` |

### Backend endpoints used by the front end

| Endpoint | Used in |
|---|---|
| `/api/data`, `/api/status`, `/api/sync`, `/api/settings` | `settings-boot.js` |
| `/api/device-health` | `device-health.js` |
| `/api/workout-hr`, `/api/workout-route`, `/api/workout-exclusion` | `workouts.js` |
| `/api/hr-day` | `overview.js`, `render-pipeline.js` |
| `/api/diagnostics`, `/api/database/optimize`, `/api/database/optimize/status` | `patterns-diagnostics.js` |
| `/api/sleep-score-snapshots` | `scoring.js` |

### Known quirk (also in the original)

`detail-box.js` calls `document.body.appendChild` while `<body>` does not exist yet, so it logs a harmless "Cannot read properties of null" error on load. The page works regardless. A fix is to wrap that code in a `DOMContentLoaded` listener, or move its `<script>` tag after `<body>`.

## Optional command-line tasks

Run commands from the project folder. They use the same local database and OAuth files as the dashboard.

```bat
REM Start the local dashboard
python server.py

REM One-time/manual Google sign-in or reauthorization
python gh.py auth

REM Incremental sync
python gh.py sync

REM Request a 365-day history sync (subject to API availability)
python gh.py sync 365

REM Backfill older raw heart-rate samples
python gh.py backfill-hr 120

REM Rebuild derived heart-rate summaries and zones
python gh.py rebuild

REM Read-only diagnostics
python gh.py diagnostics

REM Preview database cleanup; review and back up before applying
python gh.py compact
python gh.py compact --apply
```

`python gh.py inspect` prints stored API samples and may expose personal health information. Do not paste its output into public issues or chats.

## Testing and packaging

From the project folder, run the regression checks:

```bat
python -m py_compile server.py gh.py db_diagnostics.py
python -m unittest discover -s tests -v
```

The tests use a temporary SQLite database and do not connect to Google or read your personal health database. The Windows release workflow runs these checks, builds the package using the same `package-windows.ps1` script, then launches the packaged app in demo mode and verifies its data endpoint before attaching the zip to a release.

`package-windows.ps1` builds `FitbitDashboard.exe` with PyInstaller and produces `dist/FitbitDashboard-Windows.zip`, which contains the executable together with this README. The workflow in `.github/workflows/build-windows.yml` runs the compile and test checks on every pull request and push to `main`, and builds plus attaches the zip on version tags.

## Files and privacy

| File | Purpose |
|---|---|
| `index.html` | Dashboard markup: sidebar, header, views, dialogs, and the `<link>`/`<script>` tags. |
| `css/` | 8 stylesheets loaded in a fixed order; see [Front-end file guide](#front-end-file-guide). |
| `js/` | 18 classic scripts sharing one global scope; see [Front-end file guide](#front-end-file-guide). |
| `jsconfig.json` | Optional editor/JS language-service settings for the split front end. |
| `server.py` | Local web server and dashboard API; default port 8080. |
| `gh.py` | Google sign-in, syncing, SQLite storage, and derived summaries. |
| `db_diagnostics.py` | Read-only database diagnostics. |
| `Start_Health_Dashboard.bat` | Windows launcher for running from source. |
| `FitbitDashboard.exe` | Standalone Windows app, available in the GitHub Release zip. |
| `package-windows.ps1` | Reproducible local Windows package build. |
| `Health Database Visualizer.html` | Separate static visualizer using synthetic sample data; it is not the live dashboard. |
| `tests/` | Offline regression checks and a Windows packaged-demo smoke check. |
| `demo.db` | Synthetic sample data for `python server.py --demo`; contains no account data. |
| `client_secret.json` | Your private OAuth client configuration; create locally. |
| `token.json` | Your private saved Google sign-in; created locally. |
| `health.db` | Your private synced health data; created locally. |
| `LICENSE` | MIT License; see [License](#license). |

The `.gitignore` excludes personal databases, OAuth files, caches, and Python bytecode while allowing the synthetic `demo.db` to be included. Keep these exclusions in place. The repository is code, documentation, and synthetic sample data; it is not a hosted dashboard and does not contain your personal records.

The server binds to `127.0.0.1` and checks local request origins. It is designed for one local user, not multiple accounts. Do not publish port 8080, use a public reverse proxy, or share a running instance without a separate security and data-isolation design.

### Backups

1. Stop the dashboard with **Ctrl+C**.
2. Copy `health.db` to a private backup location.
3. Securely back up `client_secret.json` and `token.json` only if needed; they are credentials.
4. Restart the dashboard after the copy.

Do not delete `health.db` to fix a display issue. It contains locally retained history that Google may not return again. SQLite may create `health.db-wal` and `health.db-shm` while running; do not remove those while the server is active.

## Troubleshooting

### The dashboard will not open

- Confirm the server terminal is still running.
- Open `http://localhost:8080`.
- If another program is using port 8080, stop it or configure a different `PORT` and update the launch URL. The packaged app automatically tries 8082 and then 8083.
- Make sure `index.html`, `server.py`, `gh.py`, and the launcher are together in one folder.

### Python is not recognized

Install or repair Python 3.9+, enable the option to add it to PATH, then open a new Command Prompt. Check with `python --version`.

### Connect Google fails

- Confirm the file is named `client_secret.json` and is beside `gh.py` (source) or in `%LOCALAPPDATA%\FitbitDashboard` (packaged app).
- Confirm it is a **Web application** OAuth client and includes the redirect URI for the app you run: `http://localhost:8080/oauth/callback` for source; add the 8082 and 8083 URLs too if using the packaged app.
- Confirm the Google Health API is enabled and the account is allowed by the OAuth consent screen.
- If the consent screen is in Testing mode, add the signing-in account as a test user.
- Review the message in the browser and the server terminal. Google's project/account access policies can prevent authorization or limit endpoints.

### Battery or location information is missing

The dashboard requests device-settings and location read-only scopes, but the Google Health API may still deny or omit paired-device battery or route information. A 403 means the endpoint is not authorized for that account/project; it is not evidence of a zero battery level. Only data the API returns can be displayed.

### Sync has no data or little history

- Confirm the intended Google account is connected and click **Sync now**.
- Check the terminal for API errors.
- Try `python gh.py sync` from the project folder.
- Historical availability varies by metric and API retention; a backfill cannot recover records the API no longer exposes.

### A chart or score is blank

The metric may not be available for that date, may need more history, or may require permissions or sample fields the API did not return. Treat missing values as unavailable, not as zero.

### Heart-rate zones are missing

Set your age in **Settings**, make sure raw heart-rate data has synced, then run `python gh.py rebuild`. Zone time is derived from the samples available and can be understated when samples are sparse. The zones are estimates.

### The page looks stale

Hard-refresh with **Ctrl+F5**. If files were replaced while the server was running, restart the server and reload `http://localhost:8080`.

## License

This project is available under the MIT License. See [LICENSE](LICENSE).
