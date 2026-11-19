"""Google Health API client + SQLite store. Standard library only (Python 3.8+).

Usage:
    python gh.py auth              # one-time sign-in
    python gh.py sync              # incremental sync
    python gh.py sync 365          # full backfill
    python gh.py backfill-hr 120   # older raw heart-rate readings
    python gh.py rebuild           # rebuild derived HR tables + zones
    python gh.py inspect           # print raw API samples
    python gh.py diagnostics      # read-only database/storage report
    python gh.py compact          # preview safe storage cleanup
    python gh.py compact --apply  # backup, safely clean and compact
"""
import datetime as dt
import gzip
import http.client
import json
import os
import queue
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from performance_optimizations import rebuild_hr_days_optimized

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("HEALTH_DATA_DIR") or HERE
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.environ.get("HEALTH_DB") or os.path.join(DATA_DIR, "health.db")
SECRET_PATH = os.environ.get("HEALTH_CLIENT_SECRET") or os.path.join(DATA_DIR, "client_secret.json")
TOKEN_PATH = os.environ.get("HEALTH_TOKEN") or os.path.join(DATA_DIR, "token.json")

BASE = "https://health.googleapis.com/v4"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/googlehealth."
SCOPES = [SCOPE + s + ".readonly" for s in ("activity_and_fitness", "health_metrics_and_measurements", "sleep", "settings", "location")]

SCHEMA_VERSION = 10
HR_BACKFILL_DAYS = 120
HR_SYNC_OVERLAP_SECONDS = 60 * 60  # Recheck an hour for provider-delayed samples.
SAMPLE_SYNC_OVERLAP_SECONDS = 3 * 86400  # Reconcile recent late-arriving SpO2 samples.
PAIRED_DEVICES_SYNC_TTL = 15 * 60  # Preserve the dashboard's 15-minute battery sampling cadence.
PAIRED_DEVICES_BUCKET_SECONDS = 15 * 60
DEVICE_HEALTH_CACHE_TTL = 60.0
PROGRESS = {"job": "", "detail": "", "since": None}
WARNINGS = {}
_token_lock = threading.RLock()
_cached_token = {"mtime_ns": None, "value": None}
_ssl_context = ssl.create_default_context()
_https_pools = {}
_https_pools_lock = threading.Lock()
_sampled_types = set()
_sampled_lock = threading.Lock()
_device_health_cache = {}
_device_health_cache_lock = threading.RLock()

ROLLUPS = {
    "steps": "steps",
    "total-calories": "calories",
    "active-minutes": "active_minutes",
    "distance": "distance_m",
    "sedentary-period": "sedentary_seconds",
    "active-zone-minutes": "active_zone_minutes_raw",
}
DAILY_FIELDS = {
    "daily-resting-heart-rate": {"resting_hr": "beatsPerMinute"},
    "daily-heart-rate-variability": {
        "hrv": "averageHeartRateVariabilityMilliseconds",
        "hrv_deep": "deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds",
        "hrv_nrem_hr": "nonRemHeartRateBeatsPerMinute", "hrv_entropy": "entropy"},
    "daily-oxygen-saturation": {"spo2": "averagePercentage", "spo2_low": "lowerBoundPercentage",
                                "spo2_high": "upperBoundPercentage"},
    "daily-respiratory-rate": {"resp_rate": "breathsPerMinute"},
    "daily-vo2-max": {"vo2max": "vo2Max", "vo2max_level": "cardioFitnessLevel"},
    "daily-sleep-temperature-derivations": {
        "skin_temp_night": "nightlyTemperatureCelsius", "skin_temp_base": "baselineTemperatureCelsius",
        "skin_temp_sd30": "relativeNightlyStddev30dCelsius"},
}
HEADLINE = {"daily-resting-heart-rate": "resting_hr", "daily-heart-rate-variability": "hrv",
            "daily-oxygen-saturation": "spo2", "daily-respiratory-rate": "resp_rate", "daily-vo2-max": "vo2max"}
PREFERRED_KEYS = ("beatsPerMinute", "restingHeartRate", "rmssd", "heartRateVariabilityMilliseconds",
                  "averageHeartRateVariabilityMilliseconds", "percentage", "averagePercentage",
                  "breathsPerMinute", "vo2Max", "value", "countSum", "kcalSum", "minutesSum",
                  "millimetersSum", "durationSum", "sumInFatBurnHeartZone", "sumInCardioHeartZone",
                  "sumInPeakHeartZone", "strokeCountSum")

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily(day TEXT, metric TEXT, value REAL, PRIMARY KEY(day, metric));
CREATE TABLE IF NOT EXISTS sleep(id TEXT PRIMARY KEY, day TEXT, start TEXT, end TEXT,
    asleep INT, awake INT, deep INT, light INT, rem INT, in_bed INT, main INT);
CREATE TABLE IF NOT EXISTS sleep_stages(sleep_id TEXT, start INT, end INT, type TEXT);
CREATE TABLE IF NOT EXISTS sleep_score_snapshots(sleep_id TEXT PRIMARY KEY, score REAL NOT NULL, coverage INT NOT NULL, detail TEXT NOT NULL, scored_at TEXT NOT NULL, algorithm TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sleep_stages_id ON sleep_stages(sleep_id);
CREATE TABLE IF NOT EXISTS hr_raw(ts INTEGER PRIMARY KEY, bpm INTEGER);
CREATE TABLE IF NOT EXISTS sleep_hr(sleep_id TEXT, ts INTEGER, bpm INTEGER, PRIMARY KEY(sleep_id, ts));
CREATE TABLE IF NOT EXISTS hr_min(m INTEGER PRIMARY KEY, avg REAL, lo INTEGER, hi INTEGER, n INTEGER);
CREATE TABLE IF NOT EXISTS hr_day(day TEXT PRIMARY KEY, n INT, lo INT, q1 REAL, med REAL, mean REAL, q3 REAL, hi INT);
CREATE TABLE IF NOT EXISTS hr_coverage_day(day TEXT PRIMARY KEY, worn_seconds INTEGER NOT NULL, quarters TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS hrv_samples(ts INTEGER PRIMARY KEY, rmssd REAL, sd REAL);
CREATE TABLE IF NOT EXISTS spo2_samples(ts INTEGER PRIMARY KEY, pct REAL);
CREATE TABLE IF NOT EXISTS steps_hourly(hour TEXT PRIMARY KEY, steps INT);
CREATE TABLE IF NOT EXISTS steps_5m(time TEXT PRIMARY KEY, steps INT);
CREATE TABLE IF NOT EXISTS exercise(id TEXT PRIMARY KEY, day TEXT, start TEXT, end TEXT, type TEXT, raw TEXT);
CREATE TABLE IF NOT EXISTS exercise_exclusions(id TEXT PRIMARY KEY, excluded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS samples(type TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS device_battery_samples(
    paired_device TEXT NOT NULL, observed_at INTEGER NOT NULL, device_version TEXT, device_type TEXT,
    battery_level INTEGER, battery_status TEXT, last_sync_time TEXT, PRIMARY KEY(paired_device, observed_at));
CREATE INDEX IF NOT EXISTS device_battery_observed ON device_battery_samples(observed_at);
CREATE TABLE IF NOT EXISTS hr_zone_time(day TEXT PRIMARY KEY,
    z1_sec INT DEFAULT 0, z2_sec INT DEFAULT 0, z3_sec INT DEFAULT 0, z4_sec INT DEFAULT 0, z5_sec INT DEFAULT 0,
    light_sec INT DEFAULT 0, moderate_sec INT DEFAULT 0, vigorous_sec INT DEFAULT 0, peak_sec INT DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_daily_metric_day ON daily(metric, day);
CREATE INDEX IF NOT EXISTS idx_sleep_day_end ON sleep(day, end);
CREATE INDEX IF NOT EXISTS idx_sleep_day_start ON sleep(day, start);
CREATE INDEX IF NOT EXISTS idx_exercise_day_start ON exercise(day, start);
"""
EXTRA_COLUMNS = [("sleep", "nap", "INT DEFAULT 0"), ("sleep", "has_stages", "INT DEFAULT 0"),
                 ("hr_min", "q25", "REAL"),
                 ("hrv_samples", "hf_power", "REAL"), ("hrv_samples", "lf_power", "REAL"),
                 ("exercise", "name", "TEXT"), ("exercise", "duration_s", "REAL"), ("exercise", "distance_m", "REAL"),
                 ("exercise", "steps", "INT"), ("exercise", "kcal", "REAL"), ("exercise", "avg_hr", "REAL"),
                 ("exercise", "vo2max", "REAL")]

_ready = set()
_ready_lock = threading.Lock()


def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=30000")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA temp_store=MEMORY")
    con.execute("PRAGMA cache_size=-8192")
    con.execute("PRAGMA mmap_size=134217728")
    if DB_PATH not in _ready:
        with _ready_lock:
            if DB_PATH not in _ready:
                try:
                    con.execute("PRAGMA journal_mode=WAL")
                except sqlite3.DatabaseError:
                    pass
                con.executescript(SCHEMA)
                for table, col, decl in EXTRA_COLUMNS:
                    if col not in [r[1] for r in con.execute(f"PRAGMA table_info({table})")]:
                        try:
                            con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
                        except sqlite3.OperationalError:
                            pass
                try:
                    _migrate(con)
                except Exception as ex:
                    print(f"[gh.db] migration warning: {ex}", file=sys.stderr)
                if get_meta(con, "hr_coverage_schema") != "1":
                    try:
                        rebuild_hr_days(con)
                        set_meta(con, "hr_coverage_schema", "1")
                        con.commit()
                    except Exception as ex:
                        print(f"[gh.db] HR coverage backfill deferred: {ex}", file=sys.stderr)
                if get_meta(con, "hr_min_q25_ready") != "1":
                    try:
                        rebuild_hr_min(con)
                        set_meta(con, "hr_min_q25_ready", "1")
                        con.commit()
                    except Exception as ex:
                        print(f"[gh.db] HR minute percentile backfill deferred: {ex}", file=sys.stderr)
                _ready.add(DB_PATH)
    return con


def set_meta(con, k, v):
    con.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, v if isinstance(v, str) else json.dumps(v)))


def get_meta(con, k, default=None):
    r = con.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r["v"] if r else default


def _has_table(con, name):
    return con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None


def _migrate(con):
    """One-time schema migration. Preserve legacy tables until explicit cleanup."""
    ver = int(get_meta(con, "schema_v", "0") or 0)
    if ver >= SCHEMA_VERSION:
        return

    moved = 0
    # Merge valid legacy heart-rate timestamps that are missing from hr_raw.
    # Never overwrite the canonical hr_raw value; never drop the legacy table here.
    if _has_table(con, "hr"):
        try:
            before = con.total_changes
            con.execute(
                "INSERT OR IGNORE INTO hr_raw(ts, bpm) "
                "SELECT CAST(strftime('%s', ts) AS INTEGER), CAST(bpm AS INTEGER) "
                "FROM hr WHERE ts IS NOT NULL AND bpm IS NOT NULL AND CAST(bpm AS INTEGER)>0 "
                "AND strftime('%s', ts) IS NOT NULL")
            moved = con.total_changes - before
            if moved:
                set_meta(con, "legacy_hr_rows_merged", str(moved))
        except sqlite3.DatabaseError as ex:
            print(f"[gh._migrate] legacy HR merge deferred: {ex}", file=sys.stderr)

    try:
        rebuild_hr_min(con)
        set_meta(con, "hr_min_q25_ready", "1")
    except Exception as ex:
        print(f"[gh._migrate] rebuild_hr_min: {ex}", file=sys.stderr)
    try:
        rebuild_hr_days(con)
        set_meta(con, "hr_coverage_schema", "1")
    except Exception as ex:
        print(f"[gh._migrate] rebuild_hr_days: {ex}", file=sys.stderr)
    set_meta(con, "schema_v", str(SCHEMA_VERSION))
    if moved > 0 and not get_meta(con, "full_resync_pending"):
        set_meta(con, "full_resync_pending", "1")
    con.commit()


def rebuild_hr_min(con, lo_ts=None, hi_ts=None):
    if lo_ts is None:
        con.execute("DELETE FROM hr_min")
        lo_ts, hi_ts = con.execute("SELECT MIN(ts), MAX(ts) FROM hr_raw").fetchone()
        if lo_ts is None:
            return
    elif hi_ts is None:
        raise ValueError("hi_ts is required when rebuilding a bounded HR range")
    a, b = (lo_ts // 60) * 60, (hi_ts // 60 + 1) * 60
    rows = con.execute("SELECT ts, bpm FROM hr_raw WHERE ts >= ? AND ts < ? ORDER BY ts", (a, b))
    minute, values, output = None, [], []

    def save_minute(m, vals):
        if not vals:
            return
        vals.sort()
        output.append((m, sum(vals) / len(vals), vals[0], vals[-1], len(vals), quantile(vals, .25)))

    for ts, bpm in rows:
        m = ts // 60
        if minute is not None and m != minute:
            save_minute(minute, values)
            values = []
        minute = m
        values.append(bpm)
    save_minute(minute, values)
    con.executemany("INSERT OR REPLACE INTO hr_min(m,avg,lo,hi,n,q25) VALUES(?,?,?,?,?,?)", output)


def day_bounds(d):
    a = dt.datetime.combine(d, dt.time.min).astimezone()
    b = dt.datetime.combine(d + dt.timedelta(days=1), dt.time.min).astimezone()
    return int(a.timestamp()), int(b.timestamp())


def quantile(sorted_vals, q):
    if not sorted_vals:
        return None
    pos = (len(sorted_vals) - 1) * q
    i = int(pos)
    j = min(i + 1, len(sorted_vals) - 1)
    return sorted_vals[i] * (1 - (pos - i)) + sorted_vals[j] * (pos - i)


def rebuild_hr_days(con, lo_ts=None, hi_ts=None):
    return rebuild_hr_days_optimized(con, lo_ts, hi_ts)


def estimate_zone_max_hr(age, rhr, workouts, as_of=None):
    """Prefer recorded recent workout peak HR, then qualifying run averages, then age estimate.

    A run qualifies when its recorded average HR reaches the Peak threshold
    (90% HRR) calculated against the age-based max-HR estimate. Using this
    fixed reference avoids a circular qualification threshold as the estimate
    changes over time.
    """
    fallback = (208 - 0.7 * age) if age and age > 0 else 190.0
    as_of = as_of or dt.date.today()
    cutoff = (as_of - dt.timedelta(days=30)).isoformat()
    peak_threshold = rhr + 0.90 * (fallback - rhr)
    qualifying = []
    observed_peaks = []
    for workout in workouts:
        day = str(workout.get("day") or "")
        kind = str(workout.get("type") or "").upper()
        try:
            peak_hr = float(workout.get("peak_hr"))
            if day >= cutoff and "RUN" in kind and 30 < peak_hr < 250:
                observed_peaks.append(peak_hr)
        except (TypeError, ValueError):
            pass
        try:
            avg_hr = float(workout.get("avg_hr"))
        except (TypeError, ValueError):
            continue
        if day >= cutoff and "RUN" in kind and avg_hr >= peak_threshold:
            qualifying.append(avg_hr)
    if observed_peaks:
        return max(observed_peaks)
    return sum(qualifying) / len(qualifying) if qualifying else fallback


def rebuild_zone_time(con, days=None):
    """Derive Karvonen zone time; scheduled syncs rebuild only the recent window."""
    age_raw = get_meta(con, "setting_age")
    if not age_raw:
        return
    try:
        age = int(json.loads(age_raw))
    except Exception:
        return

    today = dt.date.today()
    cutoff_day = today - dt.timedelta(days=max(0, int(days or 1) - 1)) if days else None
    thirty_days_ago = (today - dt.timedelta(days=30)).isoformat()
    try:
        rhr_row = con.execute(
            "SELECT AVG(value) FROM daily WHERE metric='resting_hr' AND day >= ?",
            (thirty_days_ago,)).fetchone()
        rhr = rhr_row[0] if rhr_row and rhr_row[0] else 60
    except Exception:
        rhr = 60

    workouts = [dict(row) for row in con.execute(
        "SELECT e.day, e.type, e.avg_hr, (SELECT MAX(h.bpm) FROM hr_raw h WHERE h.ts >= CAST(strftime('%s', e.start) AS INTEGER) AND h.ts <= CAST(strftime('%s', e.end) AS INTEGER)) AS peak_hr FROM exercise e LEFT JOIN exercise_exclusions x ON x.id=e.id WHERE x.id IS NULL AND e.day >= ? AND e.avg_hr IS NOT NULL",
        (thirty_days_ago,))]
    # Keep the user's requested rolling average of qualifying peak-zone run averages.
    hr_max = estimate_zone_max_hr(age, rhr, workouts)
    hrr = hr_max - rhr
    bounds = [
        ("z1_sec", rhr + 0.50 * hrr, rhr + 0.60 * hrr),
        ("z2_sec", rhr + 0.60 * hrr, rhr + 0.70 * hrr),
        ("z3_sec", rhr + 0.70 * hrr, rhr + 0.80 * hrr),
        ("z4_sec", rhr + 0.80 * hrr, rhr + 0.90 * hrr),
        ("z5_sec", rhr + 0.90 * hrr, hr_max + 1),
    ]
    zone_keys = [key for key, _, _ in bounds]
    if cutoff_day is None:
        con.execute("DELETE FROM hr_zone_time")
        cursor = con.execute("SELECT ts, bpm FROM hr_raw ORDER BY ts")
    else:
        cutoff_iso = cutoff_day.isoformat()
        cutoff_ts = int(dt.datetime.combine(cutoff_day, dt.time.min).astimezone().timestamp())
        con.execute("DELETE FROM hr_zone_time WHERE day >= ?", (cutoff_iso,))
        cursor = con.execute("SELECT ts, bpm FROM hr_raw WHERE ts >= ? ORDER BY ts", (cutoff_ts,))

    # Stream with one-row lookahead: this keeps rebuild memory constant even
    # when doing a full historical rebuild on a large heart-rate archive.
    daily = {}
    previous = cursor.fetchone()
    while previous is not None:
        following = cursor.fetchone()
        ts, bpm = int(previous["ts"]), int(previous["bpm"])
        next_ts = int(following["ts"]) if following is not None else ts + 1
        duration = max(0, min(next_ts - ts, 5))
        if duration > 0:
            day = dt.datetime.fromtimestamp(ts).date().isoformat()
            bucket = daily.setdefault(day, dict.fromkeys(zone_keys, 0))
            # Zone 1 includes all readings below its 60% HRR ceiling. Dropping
            # values below the 50% lower edge omits most resting/light activity
            # and makes daily zone minutes appear far too small.
            zone_index = next((i for i, (_, _, hi) in enumerate(bounds) if bpm < hi), 4)
            bucket[zone_keys[zone_index]] += duration
        previous = following

    sql = "INSERT OR REPLACE INTO hr_zone_time(day,z1_sec,z2_sec,z3_sec,z4_sec,z5_sec) VALUES(?,?,?,?,?,?)"
    con.executemany(sql, ((day, *(values[key] for key in zone_keys)) for day, values in daily.items()))
    con.commit()



# ---------------------------------------------------------------- auth
def _client():
    if not os.path.exists(SECRET_PATH):
        sys.exit("Missing client_secret.json - see README.")
    raw = json.load(open(SECRET_PATH))
    c = raw.get("web") or raw.get("installed") or raw
    redirect = (c.get("redirect_uris") or ["https://www.google.com"])[0]
    return c["client_id"], c["client_secret"], redirect



def oauth_authorize_url(redirect, state):
    """Build a local loopback OAuth URL using an explicitly registered redirect."""
    if not os.path.exists(SECRET_PATH):
        raise RuntimeError("Google OAuth is not configured. The dashboard owner must install the shared client_secret.json first.")
    with open(SECRET_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    c = raw.get("web") or raw.get("installed") or raw
    if redirect not in (c.get("redirect_uris") or []):
        raise RuntimeError(f"Add this one-time local callback to the shared Google OAuth client: {redirect}")
    q = urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code",
        "access_type": "offline", "prompt": "consent", "state": state,
        "scope": " ".join(SCOPES)})
    return AUTH_URL + "?" + q


def finish_oauth(code, redirect):
    """Exchange this user's authorization code and persist its token locally."""
    if not os.path.exists(SECRET_PATH):
        raise RuntimeError("Google OAuth client configuration is missing.")
    with open(SECRET_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    c = raw.get("web") or raw.get("installed") or raw
    if redirect not in (c.get("redirect_uris") or []):
        raise RuntimeError("The callback URI is not registered in the Google OAuth client.")
    tok = _post_form(TOKEN_URL, {"code": code, "client_id": c["client_id"],
        "client_secret": c["client_secret"], "redirect_uri": redirect,
        "grant_type": "authorization_code"})
    tok["expires_at"] = time.time() + tok.get("expires_in", 3600) - 60
    _save_token(tok)
    return api("GET", "/users/me/identity")



def _post_form(url, data):
    req = urllib.request.Request(url, urllib.parse.urlencode(data).encode(),
                                 {"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if "invalid_grant" in body:
            raise RuntimeError("Google rejected the saved sign-in. Run: python gh.py auth") from None
        raise RuntimeError(f"token endpoint {e.code}: {body}") from None


def auth():
    cid, secret, redirect = _client()
    q = urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code",
        "access_type": "offline", "prompt": "consent", "scope": " ".join(SCOPES)})
    print("1. Open this URL in your browser and approve access:\n\n  %s?%s\n" % (AUTH_URL, q))
    print("2. Your browser will land on %s (it may show an error page - that's fine)." % redirect)
    print("3. Copy the FULL address from the address bar and paste it here.\n")
    pasted = input("Pasted URL (or just the code): ").strip()
    code = urllib.parse.parse_qs(urllib.parse.urlparse(pasted).query).get("code", [pasted])[0]
    tok = _post_form(TOKEN_URL, {"code": code, "client_id": cid, "client_secret": secret,
                                 "redirect_uri": redirect, "grant_type": "authorization_code"})
    tok["expires_at"] = time.time() + tok.get("expires_in", 3600) - 60
    _save_token(tok)
    ident = api("GET", "/users/me/identity")
    print("Signed in. Health user id:", ident.get("healthUserId"))


def _save_token(tok):
    with _token_lock:
        os.makedirs(os.path.dirname(os.path.abspath(TOKEN_PATH)), exist_ok=True)
        old = {}
        if os.path.exists(TOKEN_PATH):
            with open(TOKEN_PATH, encoding="utf-8") as f:
                old = json.load(f)
        old.update(tok)
        tmp = TOKEN_PATH + f".{os.getpid()}.tmp"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(old, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, TOKEN_PATH)
            _cached_token.update(mtime_ns=os.stat(TOKEN_PATH).st_mtime_ns, value=old)
        finally:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass

def have_token():
    return os.path.exists(TOKEN_PATH)


def access_token():
    with _token_lock:
        if not have_token():
            raise RuntimeError("Not signed in. Run: python gh.py auth")
        mtime_ns = os.stat(TOKEN_PATH).st_mtime_ns
        tok = _cached_token["value"]
        if tok is None or _cached_token["mtime_ns"] != mtime_ns:
            with open(TOKEN_PATH, encoding="utf-8") as f:
                tok = json.load(f)
            _cached_token.update(mtime_ns=mtime_ns, value=tok)
        if tok.get("expires_at", 0) > time.time():
            return tok["access_token"]
        cid, secret, _ = _client()
        new = _post_form(TOKEN_URL, {"client_id": cid, "client_secret": secret,
                                     "refresh_token": tok["refresh_token"], "grant_type": "refresh_token"})
        new["expires_at"] = time.time() + new.get("expires_in", 3600) - 60
        _save_token(new)
        return new["access_token"]

# ---------------------------------------------------------------- http
def _https_pool(host, port):
    key = (host, port)
    with _https_pools_lock:
        pool = _https_pools.get(key)
        if pool is None:
            pool = queue.LifoQueue(maxsize=8)
            _https_pools[key] = pool
        return pool


def _api_http_request(method, url, data, headers, timeout=90):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Google API requests must use HTTPS")
    host, port = parsed.hostname, parsed.port or 443
    target = parsed.path or "/"
    if parsed.query:
        target += "?" + parsed.query
    pool = _https_pool(host, port)
    conn = None
    try:
        try:
            conn = pool.get_nowait()
        except queue.Empty:
            conn = http.client.HTTPSConnection(host, port, timeout=timeout, context=_ssl_context)
        request_headers = {"Accept-Encoding": "gzip", "Connection": "keep-alive"}
        request_headers.update(headers)
        try:
            conn.request(method, target, body=data, headers=request_headers)
            response = conn.getresponse()
        except (http.client.HTTPException, OSError):
            conn.close()
            conn = http.client.HTTPSConnection(host, port, timeout=timeout, context=_ssl_context)
            conn.request(method, target, body=data, headers=request_headers)
            response = conn.getresponse()
        raw = response.read()
        status = response.status
        if (response.getheader("Content-Encoding") or "").lower() == "gzip" and raw:
            raw = gzip.decompress(raw)
        if status < 400 and not response.will_close and conn.sock is not None:
            try:
                pool.put_nowait(conn)
                conn = None
            except queue.Full:
                pass
        return status, raw
    finally:
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass


def api(method, path, params=None, body=None, retries=4):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(retries + 1):
        headers = {
            "Authorization": "Bearer " + access_token(), "Accept": "application/json",
            "Content-Type": "application/json"}
        try:
            status, raw = _api_http_request(method, url, data, headers, timeout=90)
            if status in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt * 2)
                continue
            if status >= 400:
                raise RuntimeError(f"{method} {path} -> {status}: {raw.decode(errors='replace')[:400]}")
            return json.loads(raw) if raw else {}
        except RuntimeError:
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError,
                http.client.HTTPException) as e:
            if attempt < retries:
                time.sleep(2 ** attempt * 2)
                continue
            raise RuntimeError(f"{method} {path} -> network error: {e}") from None


def export_exercise_tcx(data_point_name):
    """Download one exercise route. Location scope is required by Google Health."""
    import re
    point_id = str(data_point_name or "").rstrip("/").split("/")[-1]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", point_id):
        raise ValueError("Invalid workout data point id")
    url = f"{BASE}/users/me/dataTypes/exercise/dataPoints/{urllib.parse.quote(point_id)}:exportExerciseTcx?alt=media"
    req = urllib.request.Request(url, method="GET", headers={
        "Authorization": "Bearer " + access_token(), "Accept": "application/tcx+xml, application/xml"})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            body = response.read(20 * 1024 * 1024 + 1)
            if len(body) > 20 * 1024 * 1024:
                raise RuntimeError("Workout route is larger than the 20 MB safety limit")
            return body
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GPS route request -> {e.code}: {e.read().decode(errors='replace')[:300]}") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as e:
        raise RuntimeError(f"GPS route request failed: {e}") from None


def pages(path, params):
    token = None
    while True:
        p = dict(params)
        if token:
            p["page_token"] = token
        res = api("GET", path, p)
        yield res.get("dataPoints", [])
        token = res.get("nextPageToken")
        if not token:
            return


def sync_paired_devices(con, force=False):
    """Record paired-device battery snapshots when the API scope is available."""
    now = time.time()
    try:
        last_attempt = float(get_meta(con, "paired_devices_last_attempt_at", "0") or 0)
    except (TypeError, ValueError):
        last_attempt = 0
    if not force and now - last_attempt < PAIRED_DEVICES_SYNC_TTL:
        progress("paired devices: skipped (recently checked)")
        return 0

    # Persist the attempt before network I/O so a failing/slow permissions check
    # is also throttled instead of blocking every scheduled sync.
    set_meta(con, "paired_devices_last_attempt_at", str(now))
    con.commit()
    observed_at = int(now) // PAIRED_DEVICES_BUCKET_SECONDS * PAIRED_DEVICES_BUCKET_SECONDS
    if get_meta(con, "paired_devices_bucketed_v1") != "1":
        con.execute("""DELETE FROM device_battery_samples
            WHERE rowid NOT IN (SELECT keep_id FROM (
                SELECT MAX(rowid) AS keep_id FROM device_battery_samples
                GROUP BY paired_device, observed_at / ?))""", (PAIRED_DEVICES_BUCKET_SECONDS,))
        set_meta(con, "paired_devices_bucketed_v1", "1")
        con.commit()
    page_token = None
    count = 0
    while True:
        params = {"pageSize": 100}
        if page_token:
            params["pageToken"] = page_token
        result = api("GET", "/users/me/pairedDevices", params)
        for device in result.get("pairedDevices", []):
            name = str(device.get("name") or "").strip()
            if not name:
                continue
            raw_level = device.get("batteryLevel")
            try:
                level = int(raw_level) if raw_level is not None else None
            except (TypeError, ValueError, OverflowError):
                level = None
            if level is not None and not 0 <= level <= 100:
                level = None
            con.execute("DELETE FROM device_battery_samples WHERE paired_device=? AND observed_at / ? = ?",
                        (name, PAIRED_DEVICES_BUCKET_SECONDS, observed_at // PAIRED_DEVICES_BUCKET_SECONDS))
            con.execute(
                "INSERT OR REPLACE INTO device_battery_samples "
                "(paired_device,observed_at,device_version,device_type,battery_level,battery_status,last_sync_time) "
                "VALUES(?,?,?,?,?,?,?)",
                (name, observed_at, str(device.get("deviceVersion") or "")[:120],
                 str(device.get("deviceType") or "")[:40], level,
                 str(device.get("batteryStatus") or "")[:20], str(device.get("lastSyncTime") or "")[:80]))
            count += 1
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    con.commit()
    _invalidate_device_health_cache()
    progress(f"{count} paired device(s); battery state recorded")
    return count


# ---------------------------------------------------------------- helpers
def camel(s):
    a = s.split("-")
    return a[0] + "".join(w.title() for w in a[1:])


def snake(s):
    return s.replace("-", "_")


def number(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def duration_sec(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).rstrip("s")
    try:
        return float(s)
    except ValueError:
        return None


def find_value(obj):
    def walk(o, keys):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in keys and number(v) is not None:
                    return number(v)
            for k, v in o.items():
                if any(t in k.lower() for t in ("time", "date", "metadata", "datasource")):
                    continue
                r = walk(v, keys)
                if r is not None:
                    return r
        return None
    found = walk(obj, PREFERRED_KEYS)
    if found is not None:
        return found

    def first_number(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if any(t in k.lower() for t in ("time", "date", "metadata", "datasource")):
                    continue
                r = first_number(v)
                if r is not None:
                    return r
            return None
        return number(o) if not isinstance(o, (list, bool, str)) or isinstance(o, str) else None
    return first_number(obj)


def civil_day(d):
    d = d.get("date", d)
    return "%04d-%02d-%02d" % (d["year"], d["month"], d["day"])


def epoch(iso):
    return int(dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def iso_utc(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_day(iso, offset="0s"):
    t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    off_str = str(offset or "0s").rstrip("s")
    seconds = int(off_str) if off_str and off_str != "None" else 0
    return (t + dt.timedelta(seconds=seconds)).strftime("%Y-%m-%d")


def civil_dt(day):
    y, m, d = map(int, day.split("-"))
    return {"date": {"year": y, "month": m, "day": d}, "time": {"hours": 0, "minutes": 0, "seconds": 0, "nanos": 0}}


def chunks(start, end, n):
    s = start
    while s < end:
        e = min(s + dt.timedelta(days=n), end)
        yield s, e
        s = e


def sample(con, typ, obj):
    with _sampled_lock:
        if typ in _sampled_types:
            return
        # INSERT OR IGNORE also covers another local process recording the same
        # sample type since this process initialized its in-memory set.
        con.execute("INSERT OR IGNORE INTO samples VALUES(?,?)", (typ, json.dumps(obj)[:6000]))
        _sampled_types.add(typ)


def _init_sampled_types(con):
    with _sampled_lock:
        _sampled_types.clear()
        _sampled_types.update(row[0] for row in con.execute("SELECT type FROM samples"))


def progress(detail):
    PROGRESS["detail"] = detail


# ---------------------------------------------------------------- sync: daily rollups
def sync_rollups(con, start, end):
    for typ, metric in ROLLUPS.items():
        for s, e in chunks(start, end, 14):
            try:
                res = api("POST", f"/users/me/dataTypes/{typ}/dataPoints:dailyRollUp", body={
                    "range": {"start": civil_dt(s.isoformat()), "end": civil_dt(e.isoformat())}, "windowSizeDays": 1})
            except Exception as ex:
                progress(f"{typ} rollup failed: {str(ex)[:120]}")
                WARNINGS[f"rollup:{typ}"] = str(ex)[:180]
                continue
            for p in res.get("rollupDataPoints", []):
                sample(con, typ, p)
                body = p.get(camel(typ)) or p.get(snake(typ)) or {k: v for k, v in p.items() if "ivil" not in k}
                day = civil_day(p["civilStartTime"])
                if typ == "distance":
                    v = number(body.get("millimetersSum"))
                    if v is not None:
                        con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)", (day, "distance_m", v / 1000000.0))
                elif typ == "sedentary-period":
                    v = duration_sec(body.get("durationSum"))
                    if v is not None:
                        con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)", (day, "sedentary_seconds", v))
                elif typ == "active-zone-minutes":
                    for key, field in (("azm_fatburn", "sumInFatBurnHeartZone"),
                                       ("azm_cardio", "sumInCardioHeartZone"),
                                       ("azm_peak", "sumInPeakHeartZone")):
                        v = number(body.get(field))
                        if v is not None:
                            con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)", (day, key, v))
                elif typ == "active-minutes":
                    levels = body.get("activeMinutesRollupByActivityLevel") or []
                    if levels:
                        total = sum((number(x.get("activeMinutesSum")) or 0) for x in levels)
                        con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)",
                                    (day, "active_minutes", total))
                    else:
                        v = find_value(body)
                        if v is not None:
                            con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)", (day, "active_minutes", v))
                else:
                    v = find_value(body)
                    if v is not None:
                        con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)", (day, metric, v))
            # Release the single-writer lock before requesting the next chunk.
            con.commit()


def sync_daily_types(con, start):
    today = dt.date.today()
    now = time.time()
    for typ, fields in DAILY_FIELDS.items():
        endpoint = f"/users/me/dataTypes/{typ}/dataPoints:reconcile"
        filter_path = snake(typ) + ".date"
        filtered = {"filter": f'{filter_path} >= "{start.isoformat()}"', "page_size": 100}

        def ingest(params, fields=fields, typ=typ, endpoint=endpoint):
            count = 0
            for page in pages(endpoint, params):
                for p in page:
                    sample(con, typ, p)
                    body = p.get(camel(typ)) or p.get(snake(typ)) or {}
                    if "date" not in body:
                        continue
                    day, got = civil_day(body["date"]), {}
                    for metric, key in fields.items():
                        v = number(body.get(key))
                        if v is not None:
                            got[metric] = v
                    head = HEADLINE.get(typ)
                    if head and head not in got:
                        v = find_value({k: x for k, x in body.items() if k != "date"})
                        if v is not None:
                            got[head] = v
                    if "skin_temp_night" in got and "skin_temp_base" in got:
                        got["body_temp"] = round(got["skin_temp_night"] - got["skin_temp_base"], 3)
                    for metric, v in got.items():
                        con.execute("INSERT OR REPLACE INTO daily VALUES(?,?,?)", (day, metric, v))
                        count += 1
                # Commit this page before pages() fetches the next one remotely.
                con.commit()
            con.commit()
            return count

        err = None
        try:
            ingest(filtered)
        except Exception as ex:
            err = f"filtered: {str(ex)[:150]}"

        try:
            latest = con.execute(
                "SELECT MAX(day) FROM daily WHERE metric IN (%s)" % ",".join("?" for _ in fields),
                tuple(fields.keys())).fetchone()[0]
        except Exception:
            latest = None
        stale = (not latest) or (dt.date.fromisoformat(latest) < today - dt.timedelta(days=1))

        try:
            last_unfiltered = float(get_meta(con, f"daily_unfiltered_at_{typ}", "0") or 0)
        except (TypeError, ValueError):
            last_unfiltered = 0.0
        if err or (stale and now - last_unfiltered >= 6 * 3600):
            try:
                progress(f"{typ}: checking latest dates without filter")
                ingest({"page_size": 100})
                set_meta(con, f"daily_unfiltered_at_{typ}", str(now))
                con.commit()
            except Exception as ex:
                err = (err + " | " if err else "") + f"unfiltered: {str(ex)[:150]}"

        if err:
            WARNINGS[typ] = err
            print(f"[sync_daily_types] {typ}: {err}", file=sys.stderr)


# ---------------------------------------------------------------- sync: sleep
def store_sleep(con, p):
    s = p.get("sleep", {})
    iv, sm, md = s.get("interval", {}), s.get("summary", {}), s.get("metadata", {})
    if "startTime" not in iv or "endTime" not in iv:
        return
    pid = p.get("name") or p.get("dataPointName") or iv["startTime"]
    summary = {x.get("type"): int(number(x.get("minutes")) or 0) for x in sm.get("stagesSummary", [])}
    stages = s.get("stages", [])
    if not summary and stages:
        for x in stages:
            mins = (epoch(x["endTime"]) - epoch(x["startTime"])) // 60
            summary[x.get("type")] = summary.get(x.get("type"), 0) + mins
    in_bed = int(number(sm.get("minutesInSleepPeriod")) or (epoch(iv["endTime"]) - epoch(iv["startTime"])) // 60)
    if "mainSleep" in md or "nap" in md:
        is_main, is_nap = bool(md.get("mainSleep")), bool(md.get("nap"))
    else:
        is_main, is_nap = in_bed >= 180, in_bed < 180
    con.execute("INSERT OR REPLACE INTO sleep(id,day,start,end,asleep,awake,deep,light,rem,in_bed,main,nap,has_stages) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        pid, local_day(iv["endTime"], iv.get("endUtcOffset", "0s")), iv["startTime"], iv["endTime"],
        int(number(sm.get("minutesAsleep")) or 0), int(number(sm.get("minutesAwake")) or summary.get("AWAKE", 0)),
        summary.get("DEEP", 0), summary.get("LIGHT", 0), summary.get("REM", 0), in_bed,
        1 if is_main else 0, 1 if is_nap else 0, 1 if stages else 0))
    con.execute("DELETE FROM sleep_stages WHERE sleep_id=?", (pid,))
    con.executemany("INSERT INTO sleep_stages VALUES(?,?,?,?)", [
        (pid, epoch(x["startTime"]), epoch(x["endTime"]), str(x.get("type", "UNKNOWN")).upper())
        for x in stages if "startTime" in x and "endTime" in x])


def sync_sleep(con, start):
    flt = f'sleep.interval.civil_end_time >= "{start.isoformat()}"'
    n = 0
    for page in pages("/users/me/dataTypes/sleep/dataPoints:reconcile", {"filter": flt}):
        for p in page:
            sample(con, "sleep", p)
            store_sleep(con, p)
            n += 1
        con.commit()
        progress(f"{n} sleep sessions")


# ---------------------------------------------------------------- sync: heart rate
def _fetch_hr(con, lo_ts, hi_ts=None):
    t = "heart_rate.sample_time.physical_time"
    flt = f'{t} >= "{iso_utc(lo_ts)}"' + (f' AND {t} < "{iso_utc(hi_ts)}"' if hi_ts else "")
    total, tmin, tmax = 0, None, None
    for page in pages("/users/me/dataTypes/heart-rate/dataPoints:reconcile", {"filter": flt, "page_size": 10000}):
        rows = []
        for p in page:
            h = p.get("heartRate", {})
            bpm = number(h.get("beatsPerMinute"))
            if bpm is None:
                bpm = number(h.get("value"))
            st = h.get("sampleTime", {}).get("physicalTime")
            if bpm and st:
                rows.append((epoch(st), int(bpm)))
        if rows:
            sample(con, "heart-rate", page[0])
            con.executemany(
                "INSERT INTO hr_raw(ts,bpm) VALUES(?,?) "
                "ON CONFLICT(ts) DO UPDATE SET bpm=excluded.bpm "
                "WHERE hr_raw.bpm IS NOT excluded.bpm", rows)
            con.commit()
            total += len(rows)
            lo, hi = min(r[0] for r in rows), max(r[0] for r in rows)
            tmin = lo if tmin is None else min(tmin, lo)
            tmax = hi if tmax is None else max(tmax, hi)
            progress(f"{total:,} heart-rate readings")
    if tmin is not None:
        rebuild_hr_min(con, tmin, tmax)
        rebuild_hr_days(con, tmin, tmax)
        con.commit()
    return total


def sync_hr(con, days=None):
    now = time.time()
    floor = now - (days or HR_BACKFILL_DAYS) * 86400
    last = con.execute("SELECT MAX(ts) FROM hr_raw").fetchone()[0]
    # The provider can publish recent readings late. Re-fetch an overlap window
    # on every scheduled sync; timestamp PK + conditional UPSERT keeps it cheap
    # and prevents duplicate records or needless writes.
    return _fetch_hr(con, max(last - HR_SYNC_OVERLAP_SECONDS, floor) if last else floor)


def backfill_hr_older(con, days):
    first = con.execute("SELECT MIN(ts) FROM hr_raw").fetchone()[0]
    since = time.time() - days * 86400
    if first is None or first <= since + 3600:
        return 0
    return _fetch_hr(con, since, first + 60)


# ---------------------------------------------------------------- sync: HRV
def _hrv_rows_from_page(con, page, out):
    for p in page:
        sample(con, "heart-rate-variability", p)
        h = p.get("heartRateVariability") or p.get("heart_rate_variability") or {}
        st = (h.get("sampleTime") or h.get("sample_time") or {}).get("physicalTime") \
             or (h.get("sampleTime") or h.get("sample_time") or {}).get("physical_time")
        rmssd = number(h.get("rootMeanSquareOfSuccessiveDifferencesMilliseconds"))
        sd = number(h.get("standardDeviationMilliseconds"))
        metadata = h.get("metadata") or {}
        hf = number(metadata.get("highFrequencyPower"))
        lf = number(metadata.get("lowFrequencyPower"))
        if rmssd is None and sd is None:
            rmssd = find_value({k: v for k, v in h.items() if "sample" not in k.lower()})
        if st and (rmssd is not None or sd is not None):
            out.append((epoch(st), rmssd, sd, hf, lf))


def sync_hrv(con, days=None):
    now = time.time()
    floor = now - (days or HR_BACKFILL_DAYS) * 86400
    last = con.execute("SELECT MAX(ts) FROM hrv_samples").fetchone()[0]
    since = max(last - 3600, floor) if last else floor
    attempts = [
        f'heart_rate_variability.sample_time.physical_time >= "{iso_utc(since)}"',
        f'heartRateVariability.sampleTime.physicalTime >= "{iso_utc(since)}"',
        f'heart_rate_variability.interval.start_time >= "{iso_utc(since)}"',
        None,
    ]
    n = 0
    for flt in attempts:
        params = {"page_size": 10000}
        if flt:
            params["filter"] = flt
        try:
            rows_batch = []
            for page in pages("/users/me/dataTypes/heart-rate-variability/dataPoints:reconcile", params):
                _hrv_rows_from_page(con, page, rows_batch)
            if rows_batch:
                con.executemany(
                    "INSERT INTO hrv_samples(ts,rmssd,sd,hf_power,lf_power) VALUES(?,?,?,?,?) "
                    "ON CONFLICT(ts) DO UPDATE SET rmssd=excluded.rmssd, sd=excluded.sd, "
                    "hf_power=excluded.hf_power, lf_power=excluded.lf_power "
                    "WHERE hrv_samples.rmssd IS NOT excluded.rmssd OR hrv_samples.sd IS NOT excluded.sd "
                    "OR hrv_samples.hf_power IS NOT excluded.hf_power OR hrv_samples.lf_power IS NOT excluded.lf_power",
                    rows_batch)
                con.commit()
                n += len(rows_batch)
                progress(f"{n:,} HRV readings")
                break
        except Exception as ex:
            progress(f"HRV attempt failed: {str(ex)[:120]}")
            continue
    return n


# ---------------------------------------------------------------- sync: SpO2 samples
def sync_spo2_samples(con, days=None):
    floor = time.time() - (days or HR_BACKFILL_DAYS) * 86400
    last = con.execute("SELECT MAX(ts) FROM spo2_samples").fetchone()[0]
    since = max(floor, int(last) - SAMPLE_SYNC_OVERLAP_SECONDS) if last is not None else floor
    n = 0
    for flt in [f'oxygen_saturation.sample_time.physical_time >= "{iso_utc(since)}"', None]:
        params = {"page_size": 10000}
        if flt:
            params["filter"] = flt
        try:
            rows = []
            for page in pages("/users/me/dataTypes/oxygen-saturation/dataPoints:reconcile", params):
                for p in page:
                    sample(con, "oxygen-saturation", p)
                    o = p.get("oxygenSaturation") or {}
                    st = (o.get("sampleTime") or {}).get("physicalTime")
                    pct = number(o.get("percentage"))
                    if st and pct:
                        rows.append((epoch(st), pct))
            if rows:
                con.executemany(
                    "INSERT INTO spo2_samples(ts,pct) VALUES(?,?) "
                    "ON CONFLICT(ts) DO UPDATE SET pct=excluded.pct "
                    "WHERE spo2_samples.pct IS NOT excluded.pct", rows)
                con.commit()
                n += len(rows)
                progress(f"{n:,} SpO2 samples")
                break
        except Exception as ex:
            progress(f"SpO2 attempt failed: {str(ex)[:120]}")
            continue
    return n


# ---------------------------------------------------------------- sync: hourly steps, workouts
def sync_hourly_steps(con, hours=48):
    end = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)
    start = end - dt.timedelta(hours=hours)
    res = api("POST", "/users/me/dataTypes/steps/dataPoints:rollUp", body={
        "range": {"startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ")},
        "windowSize": "3600s"})
    for p in res.get("rollupDataPoints", []):
        con.execute("INSERT OR REPLACE INTO steps_hourly VALUES(?,?)",
                    (p["startTime"], int(number(p.get("steps", {}).get("countSum")) or 0)))


def sync_5m_steps(con, days=60):
    """Keep fine-grained movement flags for the personal stress baseline."""
    end = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
    end -= dt.timedelta(minutes=end.minute % 5)
    floor_start = end - dt.timedelta(days=days)
    last_time = con.execute("SELECT MAX(time) FROM steps_5m").fetchone()[0]
    if last_time:
        try:
            last_dt = dt.datetime.fromisoformat(str(last_time).replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=dt.timezone.utc)
            start = max(floor_start, last_dt.astimezone(dt.timezone.utc) - dt.timedelta(days=3))
        except (TypeError, ValueError, OverflowError):
            start = floor_start
    else:
        start = floor_start
    res = api("POST", "/users/me/dataTypes/steps/dataPoints:rollUp", body={
        "range": {"startTime": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "endTime": end.strftime("%Y-%m-%dT%H:%M:%SZ")},
        "windowSize": "300s"})
    rows = [
        (p["startTime"], int(number(p.get("steps", {}).get("countSum")) or 0))
        for p in res.get("rollupDataPoints", [])
    ]
    if rows:
        con.executemany(
            "INSERT INTO steps_5m(time,steps) VALUES(?,?) "
            "ON CONFLICT(time) DO UPDATE SET steps=excluded.steps "
            "WHERE steps_5m.steps IS NOT excluded.steps", rows)


def sync_exercise(con, start):
    flt = f'exercise.interval.civil_start_time >= "{start.isoformat()}"'
    for page in pages("/users/me/dataTypes/exercise/dataPoints:reconcile", {"filter": flt}):
        for p in page:
            sample(con, "exercise", p)
            e = p.get("exercise", {})
            iv, ms = e.get("interval", {}), e.get("metricsSummary", {})
            if "startTime" not in iv:
                continue
            pid = p.get("name") or p.get("dataPointName") or iv["startTime"]
            dur = number(str(e.get("activeDuration", "")).rstrip("s"))
            if dur is None and "endTime" in iv:
                dur = float(epoch(iv["endTime"]) - epoch(iv["startTime"]))
            dist = number(ms.get("distanceMillimeters"))
            vo2 = number(ms.get("runVo2Max", ms.get("vo2Max")))
            avg_hr = number(ms.get("averageHeartRateBeatsPerMinute"))
            kcal = next((number(ms.get(key)) for key in
                         ("caloriesKcal", "totalCaloriesKcal", "activeCaloriesKcal", "calories")
                         if number(ms.get(key)) is not None), None)
            dist_km = dist / 1000000.0 if dist is not None else None
            con.execute("INSERT OR REPLACE INTO exercise(id,day,start,end,type,raw,name,duration_s,distance_m,steps,kcal,avg_hr,vo2max) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                pid, local_day(iv["startTime"], iv.get("startUtcOffset", "0s")), iv["startTime"], iv.get("endTime", iv["startTime"]),
                e.get("exerciseType", "WORKOUT"), json.dumps(e, separators=(",", ":")), e.get("displayName"), dur,
                dist_km, int(number(ms.get("steps")) or 0) or None,
                kcal, avg_hr, vo2))
        con.commit()


# ---------------------------------------------------------------- sync: body measurements (weight and blood pressure)
def _first_metric_value(obj, paths):
    for path in paths:
        cur = obj
        try:
            for part in path.split("."):
                cur = cur[part]
            val = number(cur)
            if val is not None:
                return val
        except (KeyError, TypeError):
            continue
    return None

def sync_body_measurements(con, start):
    """Import dated weight and blood-pressure records when exposed by the connected Google Health API."""
    specs = [
      ("weight", [("weight", ["weight.weightGrams", "weight.weightKilograms", "weight.kilograms", "weight.value", "weightKg", "weight_kg", "value"])]),
    ]
    for typ, metrics in specs:
        try:
            query_start = start
            if typ == "weight":
                has_weight = con.execute("SELECT 1 FROM daily WHERE metric='weight' LIMIT 1").fetchone()
                if not has_weight:
                    query_start = min(start, dt.date.today() - dt.timedelta(days=365))
            flt = f'{typ.replace("-", "_")}.sample_time.physical_time >= "{query_start.isoformat()}T00:00:00Z"'
            count = 0
            for batch in pages(f"/users/me/dataTypes/{typ}/dataPoints:reconcile", {"filter": flt, "page_size": 1000}):
                for point in batch:
                    sample(con, typ, point)
                    body = point.get("weight", {}) if typ == "weight" else point.get("bloodPressure", point.get("blood_pressure", {}))
                    if not isinstance(body, dict): body = point
                    sample_time = body.get("sampleTime", body.get("sample_time", {})) if isinstance(body, dict) else {}
                    interval = body.get("interval", {}) if isinstance(body, dict) else {}
                    stamp = sample_time.get("physicalTime") or sample_time.get("civilTime") or interval.get("startTime") or interval.get("endTime") or body.get("measurementTime") or body.get("time") or point.get("startTime") or point.get("endTime") or point.get("measurementTime") or point.get("timestamp")
                    if isinstance(stamp, dict):
                        stamp = stamp.get("date") or stamp.get("physicalTime")
                    if not isinstance(stamp, str) or len(stamp) < 10: continue
                    try: day = local_day(stamp, sample_time.get("utcOffset", interval.get("startUtcOffset", "0s")))
                    except Exception: day = stamp[:10]
                    if day < query_start.isoformat(): continue
                    for metric, paths in metrics:
                        val = _first_metric_value(point, paths)
                        if val is None: val = _first_metric_value(body, paths)
                        if val is None: continue
                        if metric == "weight":
                            if val > 500: val /= 1000.0
                            if not 20 <= val <= 400: continue
                        elif metric == "systolic_bp" and not 50 <= val <= 300: continue
                        elif metric == "diastolic_bp" and not 20 <= val <= 200: continue
                        con.execute("INSERT OR REPLACE INTO daily(day,metric,value) VALUES(?,?,?)", (day, metric, val)); count += 1
                con.commit()
            progress(f"{typ}: {count} measurement values")
        except Exception as ex:
            WARNINGS[f"measurements:{typ}"] = str(ex)[:180]
            print(f"[sync_body_measurements] {typ}: {ex}", file=sys.stderr)


# ---------------------------------------------------------------- orchestration
def sync_all(backfill_days=None):
    con = db()
    _init_sampled_types(con)
    pending = get_meta(con, "full_resync_pending") == "1"
    try:
        days_of_data = con.execute("SELECT COUNT(DISTINCT day) FROM daily WHERE metric='steps'").fetchone()[0]
    except Exception:
        days_of_data = 0
    first = get_meta(con, "last_sync") is None or pending or days_of_data < 30
    if backfill_days is not None:
        days = max(1, int(backfill_days))
    elif first:
        days = 365
    else:
        days = 14
        last_iso = get_meta(con, "last_sync")
        if last_iso:
            try:
                last_dt = dt.datetime.fromisoformat(str(last_iso).replace("Z", "+00:00"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=dt.timezone.utc)
                elapsed = (dt.datetime.now(dt.timezone.utc) - last_dt.astimezone(dt.timezone.utc)).total_seconds()
                days = max(14, int(elapsed // 86400) + 2)
            except (TypeError, ValueError, OverflowError):
                pass
    today = dt.date.today()
    start, end = today - dt.timedelta(days=days), today + dt.timedelta(days=1)
    errors, timings = {}, {}
    WARNINGS.clear()
    jobs = [
        ("daily totals", lambda: sync_rollups(con, start, end)),
        ("weight and blood pressure", lambda: sync_body_measurements(con, start)),
        ("daily vitals", lambda: sync_daily_types(con, start)),
        ("sleep", lambda: sync_sleep(con, start)),
        ("heart rate", lambda: sync_hr(con)),
        ("older heart rate", lambda: backfill_hr_older(con, HR_BACKFILL_DAYS) if first else 0),
        ("sleep HRV", lambda: sync_hrv(con)),
        ("SpO2 samples", lambda: sync_spo2_samples(con)),
        ("hourly steps", lambda: sync_hourly_steps(con)),
        ("5-minute movement", lambda: sync_5m_steps(con)),
        ("workouts", lambda: sync_exercise(con, start)),
        ("device battery", lambda: sync_paired_devices(con)),
    ]
    PROGRESS.update(since=time.time(), job="", detail="")
    for name, fn in jobs:
        PROGRESS.update(job=name, detail="")
        t0 = time.perf_counter()
        try:
            fn()
            con.commit()
        except Exception as ex:
            con.rollback()
            errors[name] = str(ex)[:300]
        timings[name] = round(time.perf_counter() - t0, 2)
        line = f"  {name}: {timings[name]:.2f}s"
        if name in errors:
            line += f"  [ERROR] {errors[name][:160]}"
        print(line, flush=True)

    errors.update(WARNINGS)
    WARNINGS.clear()

    try:
        rebuild_zone_time(con, days=30)
    except Exception as ex:
        errors["derive zones"] = str(ex)[:200]

    if pending and not any(k in errors for k in ("sleep", "daily vitals", "workouts")):
        set_meta(con, "full_resync_pending", "0")

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    ok_jobs = [name for name, _ in jobs if name not in errors]
    if ok_jobs:
        set_meta(con, "last_sync", now_iso)
        for name in ok_jobs:
            set_meta(con, f"last_ok_{name}", now_iso)
    set_meta(con, "last_sync_seconds", round(sum(timings.values()), 2))
    set_meta(con, "last_sync_timings", timings)
    set_meta(con, "errors", errors)
    con.commit()
    con.close()
    PROGRESS.update(job="", detail="", since=None)
    return errors


def _invalidate_device_health_cache():
    with _device_health_cache_lock:
        _device_health_cache.clear()


def device_health_data(con, days=90):
    """Return a short-lived cached local snapshot; this function never syncs."""
    days = max(7, min(365, int(days)))
    key = (os.path.abspath(DB_PATH), days)
    now_mono = time.monotonic()
    with _device_health_cache_lock:
        cached = _device_health_cache.get(key)
        if cached and now_mono - cached[0] < DEVICE_HEALTH_CACHE_TTL:
            return cached[1]
    result = _device_health_data_uncached(con, days)
    with _device_health_cache_lock:
        _device_health_cache[key] = (time.monotonic(), result)
    return result


def _device_health_data_uncached(con, days=90):
    """Return local Fitbit battery history and conservative HR coverage estimates."""
    days = max(7, min(365, int(days)))
    now = int(time.time())
    start = now - days * 86400
    battery_rows = con.execute(
        "SELECT paired_device,observed_at,device_version,device_type,battery_level,battery_status,last_sync_time "
        "FROM device_battery_samples WHERE observed_at>=? ORDER BY paired_device,observed_at", (start,)).fetchall()
    grouped = {}
    for row in battery_rows:
        name = str(row["paired_device"])
        grouped.setdefault(name, []).append({
            "time": int(row["observed_at"]), "level": row["battery_level"],
            "status": row["battery_status"], "last_sync": row["last_sync_time"] or None,
            "version": row["device_version"] or "Fitbit device", "type": row["device_type"] or "TRACKER"})
    devices = []
    for name, samples in grouped.items():
        latest = next((sample for sample in reversed(samples) if sample["level"] is not None), samples[-1])
        devices.append({"name": name, "version": latest["version"], "type": latest["type"],
                        "battery_level": latest["level"], "battery_status": latest["status"],
                        "last_sync": latest["last_sync"], "samples": samples})
    first_day, last_day = dt.datetime.fromtimestamp(start).date(), dt.datetime.fromtimestamp(now).date()
    first_key, last_key = first_day.isoformat(), last_day.isoformat()
    coverage_rows = con.execute(
        "SELECT day,worn_seconds,quarters FROM hr_coverage_day WHERE day>=? AND day<=? ORDER BY day",
        (first_key, last_key)).fetchall()
    coverage_by_day = {str(row["day"]): row for row in coverage_rows}
    wear, coverage_grid = [], []
    d = first_day
    while d <= last_day:
        key = d.isoformat()
        day_start = int(dt.datetime.combine(d, dt.time.min).astimezone().timestamp())
        next_start = int(dt.datetime.combine(d + dt.timedelta(days=1), dt.time.min).astimezone().timestamp())
        day_end = min(next_start, now)
        day_minutes = max(0, min(1440, (day_end - day_start) // 60))
        coverage = coverage_by_day.get(key)
        worn_seconds = int(coverage["worn_seconds"]) if coverage else 0
        worn_minutes = min(day_minutes, round(worn_seconds / 60))
        wear.append({"day": key, "worn_minutes": worn_minutes, "no_hr_minutes": day_minutes - worn_minutes,
                     "day_minutes": day_minutes})
        elapsed_seconds = max(0, day_end - day_start)
        elapsed_cells = min(96, max(0, (elapsed_seconds + 899) // 900))
        quarter_bits = str(coverage["quarters"] or "") if coverage else ""
        quarter_bits = (quarter_bits + "0" * 96)[:96]
        cells = quarter_bits[:elapsed_cells] + "." * (96 - elapsed_cells)
        coverage_grid.append({"day": key, "cells": cells, "elapsed_fraction": min(1.0, elapsed_seconds / 86400)})
        d += dt.timedelta(days=1)
    since_day = dt.datetime.fromtimestamp(now - 31 * 86400).date().isoformat()
    sleep_rows = con.execute("SELECT id,day,start,end,main,nap FROM sleep WHERE end>=? ORDER BY start",
                             (dt.datetime.fromtimestamp(now - 31 * 86400).isoformat(),)).fetchall()
    sleep_starts, sleep_ends = [], []
    for row in sleep_rows:
        if not row["main"] or row["nap"]:
            continue
        try:
            a = dt.datetime.fromisoformat(str(row["start"]).replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
            b = dt.datetime.fromisoformat(str(row["end"]).replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
            if 120 <= (b - a).total_seconds() / 60 <= 900:
                sleep_starts.append((a.hour * 60 + a.minute - 1080) % 1440)
                sleep_ends.append((b.hour * 60 + b.minute - 1080) % 1440)
        except (TypeError, ValueError, OverflowError):
            continue
    sleep_window = None
    if len(sleep_starts) >= 5:
        sleep_starts.sort(); sleep_ends.sort(); n = len(sleep_starts) // 2
        s = sleep_starts[n] if len(sleep_starts) % 2 else round((sleep_starts[n - 1] + sleep_starts[n]) / 2)
        e = sleep_ends[n] if len(sleep_ends) % 2 else round((sleep_ends[n - 1] + sleep_ends[n]) / 2)
        median_start, median_end = (s + 1080) % 1440, (e + 1080) % 1440
        if median_end <= median_start:
            median_end += 1440
        sleep_window = {"start_minute": median_start, "end_minute": median_end, "nights": len(sleep_starts)}
    sleep_sessions = [{"id": r["id"], "day": r["day"], "start": r["start"], "end": r["end"],
                       "nap": bool(r["nap"]), "main": bool(r["main"])} for r in sleep_rows]
    exercise_rows = con.execute("SELECT id,day,start,end,type,name,duration_s FROM exercise WHERE day>=? ORDER BY start",
                                (since_day,)).fetchall()
    exercise_sessions = [{"id": r["id"], "day": r["day"], "start": r["start"], "end": r["end"],
                          "type": r["type"], "name": r["name"], "duration_s": r["duration_s"]} for r in exercise_rows]
    try:
        sync_errors = json.loads(get_meta(con, "errors", "{}") or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        sync_errors = {}
    return {"devices": devices, "wear": wear, "coverage_grid": coverage_grid, "sleep_window": sleep_window,
            "sleep_sessions": sleep_sessions, "exercise_sessions": exercise_sessions, "days": days,
            "generated_at": now, "sync_error": str(sync_errors.get("device battery", ""))[:240] or None}


def _open_readonly_db(path):
    """Open an existing database read-only; never create a missing file."""
    uri = "file:" + urllib.parse.quote(os.path.abspath(path).replace("\\", "/"), safe="/:") + "?mode=ro"
    # Spaces need not be escaped in SQLite file URIs; quote keeps # and ? safe.
    return sqlite3.connect(uri, uri=True, timeout=15)


def _legacy_hr_report(con):
    """Return safety stats for the legacy hr table without modifying the DB."""
    if not _has_table(con, "hr") or not _has_table(con, "hr_raw"):
        return None
    total = con.execute("SELECT COUNT(*) FROM hr").fetchone()[0]
    invalid = con.execute(
        "SELECT COUNT(*) FROM hr WHERE ts IS NULL OR bpm IS NULL "
        "OR CAST(bpm AS INTEGER)<=0 OR strftime('%s', ts) IS NULL").fetchone()[0]
    missing = con.execute(
        "SELECT COUNT(*) FROM hr h LEFT JOIN hr_raw r "
        "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) "
        "WHERE h.ts IS NOT NULL AND h.bpm IS NOT NULL AND CAST(h.bpm AS INTEGER)>0 "
        "AND strftime('%s',h.ts) IS NOT NULL AND r.ts IS NULL").fetchone()[0]
    conflicts = con.execute(
        "SELECT COUNT(*) FROM hr h JOIN hr_raw r "
        "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) "
        "WHERE CAST(h.bpm AS INTEGER) != r.bpm "
        "AND strftime('%s',h.ts) IS NOT NULL").fetchone()[0]
    return {"total": total, "invalid": invalid, "missing": missing, "conflicts": conflicts,
            "safe_to_drop": invalid == 0 and conflicts == 0}


def _object_sizes(con):
    try:
        return {r[0]: int(r[1] or 0) for r in con.execute(
            "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name")}
    except sqlite3.DatabaseError:
        return {}


def compact(apply=False, emit=print):
    """Safely preview or apply storage cleanup. Returns a JSON-safe result dict.

    When applying, a verified online SQLite backup is created before any changes.
    The legacy sleep_hr table is deliberately retained because it may contain
    unique sleep-specific samples used by the dashboard as a fallback.
    """
    path = DB_PATH
    if not os.path.exists(path):
        raise RuntimeError(f"Database not found: {os.path.abspath(path)}")

    con = _open_readonly_db(path)
    try:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Refusing cleanup: integrity_check returned {integrity!r}")
        sizes = _object_sizes(con)
        idx_exists = con.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name='hr_raw_ts'").fetchone() is not None
        legacy = _legacy_hr_report(con)
        before_size = os.path.getsize(path)
        reclaim = sizes.get("hr_raw_ts", 0)
        if legacy and legacy["safe_to_drop"]:
            reclaim += sizes.get("hr", 0) + sizes.get("sqlite_autoindex_hr_1", 0)
        result = {
            "ok": False, "applied": bool(apply), "database_path": os.path.abspath(path),
            "before_bytes": before_size, "after_bytes": before_size,
            "estimated_reclaim_bytes": int(reclaim), "integrity_before": integrity,
            "integrity_after": None, "backup_path": None,
            "redundant_index_removed": False, "legacy_hr_dropped": False,
            "legacy_rows_merged": 0, "legacy_hr_retained_reason": None,
            "sleep_hr_retained": True,
        }
        emit("DATABASE CLEANUP PLAN (apply requested)" if apply else "DATABASE CLEANUP PLAN (preview; no changes made)")
        emit(f"Database: {os.path.abspath(path)}")
        emit(f"File size: {before_size:,} bytes ({before_size / (1024*1024):.2f} MiB)")
        emit(f"Integrity: {integrity}")
        if idx_exists:
            if "hr_raw_ts" in sizes:
                emit(f"Redundant index hr_raw_ts: present ({sizes['hr_raw_ts']/(1024*1024):.2f} MiB estimated)")
            else:
                emit("Redundant index hr_raw_ts: present (per-index size unavailable in this SQLite build)")
        else:
            emit("Redundant index hr_raw_ts: absent")
        if legacy:
            emit(f"Legacy hr rows: {legacy['total']:,}; missing from hr_raw: {legacy['missing']:,}; conflicting BPM rows: {legacy['conflicts']:,}; invalid legacy rows: {legacy['invalid']:,}")
            if legacy["safe_to_drop"]:
                emit("Legacy hr table: eligible for removal after merging missing valid rows.")
            else:
                reason = "conflicting BPM values or invalid rows prevent safe removal"
                result["legacy_hr_retained_reason"] = reason
                emit("Legacy hr table: RETAINED because some values cannot be proven equivalent to hr_raw.")
        else:
            emit("Legacy hr table: absent (or hr_raw is absent).")
        if _has_table(con, "sleep_hr"):
            n = con.execute("SELECT COUNT(*) FROM sleep_hr").fetchone()[0]
            emit(f"sleep_hr: retain {n:,} rows; this table is still used as a per-sleep fallback.")
        if sizes:
            emit(f"Estimated reclaimable object storage: {reclaim/(1024*1024):.2f} MiB (before VACUUM overhead).")
        else:
            emit("Per-object storage estimates are unavailable in this SQLite build; VACUUM will still compact the database.")
        if not apply:
            emit("Preview only. Use Optimize database in the dashboard or run: python gh.py compact --apply")
            result["ok"] = True
            return result
    finally:
        con.close()

    # SQLite's backup API includes committed WAL data and avoids a file-copy race.
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup_path = f"{path}.backup-{stamp}"
    src = sqlite3.connect(path, timeout=30)
    dst = sqlite3.connect(backup_path)
    try:
        src.backup(dst)
        check = dst.execute("PRAGMA integrity_check").fetchone()[0]
        if check != "ok":
            raise RuntimeError(f"Backup integrity check failed: {check}")
    except Exception:
        try:
            dst.close()
        finally:
            src.close()
        try:
            if os.path.exists(backup_path):
                os.remove(backup_path)
        except OSError:
            pass
        raise
    else:
        dst.close()
        src.close()
    result["backup_path"] = os.path.abspath(backup_path)
    emit(f"Verified backup created: {os.path.abspath(backup_path)}")

    con = sqlite3.connect(path, timeout=60)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout=60000")
    con.execute("PRAGMA synchronous=NORMAL")
    added_legacy_rows = 0
    try:
        if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Database integrity changed after backup; aborting cleanup.")
        con.execute("BEGIN IMMEDIATE")
        con.execute("DROP INDEX IF EXISTS hr_raw_ts")
        current_legacy = _legacy_hr_report(con)
        if current_legacy and current_legacy["safe_to_drop"]:
            cur = con.execute(
                "INSERT OR IGNORE INTO hr_raw(ts,bpm) "
                "SELECT CAST(strftime('%s',ts) AS INTEGER), CAST(bpm AS INTEGER) FROM hr "
                "WHERE ts IS NOT NULL AND bpm IS NOT NULL AND CAST(bpm AS INTEGER)>0 "
                "AND strftime('%s',ts) IS NOT NULL")
            added_legacy_rows = max(0, cur.rowcount or 0)
            after = _legacy_hr_report(con)
            if after and after["missing"] == 0 and after["conflicts"] == 0 and after["invalid"] == 0:
                n = after["total"]
                con.execute("DROP TABLE hr")
                result["legacy_hr_dropped"] = True
                result["legacy_rows_merged"] = added_legacy_rows
                emit(f"Dropped legacy hr after preserving all {n:,} valid rows in hr_raw.")
            else:
                result["legacy_hr_retained_reason"] = "post-merge verification did not prove all rows safe"
                emit("Legacy hr retained: re-check did not prove all rows safe to remove.")
        elif current_legacy:
            result["legacy_hr_retained_reason"] = "conflicting BPM values or invalid rows prevent safe removal"
            emit("Legacy hr retained: conflict/validity checks did not pass.")
        con.commit()
        result["redundant_index_removed"] = bool(idx_exists)

        # If missing legacy samples were merged, rebuild every derived HR summary.
        # These tables are derived from hr_raw; rebuilding keeps the dashboard consistent.
        if added_legacy_rows:
            rebuild_hr_min(con)
            rebuild_hr_days(con)
            try:
                rebuild_zone_time(con)
            except Exception as ex:
                emit(f"Warning: HR rows were merged but zone summaries could not be rebuilt: {ex}")
            con.commit()

        # Release pending WAL pages before compaction. With the server's maintenance
        # lock, no scheduled sync can write while this operation is running.
        try:
            con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.DatabaseError as ex:
            emit(f"WAL checkpoint note: {ex}")
        con.execute("VACUUM")
        con.execute("PRAGMA optimize")
        integrity_after = con.execute("PRAGMA integrity_check").fetchone()[0]
        result["integrity_after"] = integrity_after
        if integrity_after != "ok":
            raise RuntimeError(f"Post-cleanup integrity check failed: {integrity_after}")
        con.commit()
        new_size = os.path.getsize(path)
        result["after_bytes"] = new_size
        result["bytes_saved"] = max(0, before_size - new_size)
        result["integrity_after"] = integrity_after
        result["ok"] = True
        emit(f"Cleanup complete. File size: {new_size:,} bytes ({new_size/(1024*1024):.2f} MiB).")
        emit(f"Net file-size reduction: {(before_size-new_size)/(1024*1024):.2f} MiB.")
        emit("Post-cleanup integrity: ok. sleep_hr was retained.")
        return result
    except Exception:
        try:
            con.rollback()
        except sqlite3.DatabaseError:
            pass
        raise
    finally:
        con.close()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "auth":
        auth()
    elif cmd == "sync":
        t0 = time.perf_counter()
        errs = sync_all(int(sys.argv[2]) if len(sys.argv) > 2 else None)
        print(f"Sync elapsed: {time.perf_counter() - t0:.1f} s")
        print("Sync finished." if not errs else "Sync finished with problems:\n" + json.dumps(errs, indent=2))
    elif cmd == "backfill-hr":
        c = db()
        print("Added", backfill_hr_older(c, int(sys.argv[2]) if len(sys.argv) > 2 else 365), "older readings")
    elif cmd == "rebuild":
        c = db()
        rebuild_hr_min(c)
        rebuild_hr_days(c)
        rebuild_zone_time(c)
        c.commit()
        print("rebuilt")
    elif cmd == "inspect":
        c = db()
        for r in c.execute("SELECT type, json FROM samples ORDER BY type"):
            print("==", r["type"], "\n", r["json"][:1500], "\n")
    elif cmd in ("diagnostics", "diagnose", "db-diagnostics"):
        from db_diagnostics import main as diagnostics_main
        diagnostics_main(DB_PATH)
    elif cmd == "compact":
        compact(apply="--apply" in sys.argv[2:])
    else:
        print(__doc__)

