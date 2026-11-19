"""Local dashboard server.  python3 server.py  ->  http://localhost:8080"""
import bisect
import datetime as dt
import gzip
import hashlib
import html
import json
import math
import statistics
import urllib.parse
import os
import shutil
import socket
import sqlite3
import sys
import threading
import time
import secrets
import webbrowser
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class ExclusiveThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
        if exclusive is not None:
            self.socket.setsockopt(socket.SOL_SOCKET, exclusive, 1)
        super().server_bind()

FROZEN_APP = bool(getattr(sys, "frozen", False))
BUNDLE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
if FROZEN_APP:
    APP_DATA_DIR = os.environ.get("HEALTHLAB_PACKAGE_DATA_DIR") or os.path.join(
        os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "FitbitDashboard")
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    os.environ["HEALTH_DATA_DIR"] = APP_DATA_DIR
    os.environ["HEALTH_DB"] = os.path.join(APP_DATA_DIR, "health.db")
    os.environ["HEALTH_CLIENT_SECRET"] = os.path.join(APP_DATA_DIR, "client_secret.json")
    os.environ["HEALTH_TOKEN"] = os.path.join(APP_DATA_DIR, "token.json")

DEMO = "--demo" in sys.argv
if DEMO:
    if FROZEN_APP:
        demo_source = os.path.join(BUNDLE_DIR, "demo.db")
        demo_path = os.path.join(os.environ["HEALTH_DATA_DIR"], "demo.db")
        if not os.path.exists(demo_path):
            shutil.copy2(demo_source, demo_path)
        os.environ["HEALTH_DB"] = demo_path
    else:
        os.environ["HEALTH_DB"] = os.path.join(BUNDLE_DIR, "demo.db")
import gh  # noqa: E402

PORT = int(os.environ.get("PORT", 8080))
SYNC_EVERY = 15 * 60
DB_MAINTENANCE_EVERY = 24 * 60 * 60
DB_AUTO_COMPACT_MIN_BYTES = 128 * 1024 * 1024
DB_AUTO_COMPACT_FREE_RATIO = 0.20
DB_MAINTENANCE_START_DELAY = 10 * 60
sync_lock = threading.Lock()
db_read_lock = threading.RLock()
sync_state = {"running": False, "started_at": None, "started_mono": None,
              "last_elapsed_seconds": None}
optimize_guard = threading.Lock()
optimize_state_guard = threading.Lock()
optimize_state = {"running": False, "stage": "idle", "started_at": None,
                  "finished_at": None, "result": None, "error": None, "log": []}
SERVER_STARTED = time.perf_counter()
FIRST_PAGE_SERVED = False
oauth_states = {}
oauth_state_lock = threading.Lock()
OAUTH_STATE_TTL = 600

SETTING_KEYS = ("age", "sex", "sleep_goal", "height_cm", "weight_kg")
CACHE_DIR = os.path.join(gh.DATA_DIR, "cache")


def run_sync():
    if DEMO or not gh.have_token() or not sync_lock.acquire(blocking=False):
        return
    started_mono = time.perf_counter()
    sync_state.update({"running": True, "started_at": time.time(), "started_mono": started_mono})
    try:
        gh.sync_all()
        _record_database_growth_snapshot()
        _trend_invalidate()  # a sync can back-fill older days: re-verify them on the next page load
        _payload_invalidate()
    except Exception as ex:
        con = gh.db()
        gh.set_meta(con, "errors", {"sync": str(ex)[:300]})
        con.commit()
        con.close()
    finally:
        elapsed = round(max(0.0, time.perf_counter() - started_mono), 1)
        sync_state.update({"last_elapsed_seconds": elapsed, "running": False,
                           "started_at": None, "started_mono": None})
        timer_con = None
        try:
            timer_con = gh.db()
            history = json.loads(gh.get_meta(timer_con, "sync_elapsed_history", "[]") or "[]")
            if not isinstance(history, list):
                history = []
            history.append({"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                            "seconds": elapsed})
            gh.set_meta(timer_con, "last_sync_elapsed_seconds", str(elapsed))
            gh.set_meta(timer_con, "sync_elapsed_history", json.dumps(history[-20:], separators=(",", ":")))
            timer_con.commit()
        except Exception as ex:
            print(f"[sync timer] Could not persist elapsed time: {str(ex)[:160]}", file=sys.stderr)
        finally:
            if timer_con is not None:
                timer_con.close()
        sync_lock.release()


def _record_database_growth_snapshot():
    """Store one compact end-of-sync database size/row-count sample per local day."""
    con = None
    try:
        con = gh.db()
        today = dt.datetime.now().astimezone().date().isoformat()
        history = json.loads(gh.get_meta(con, "db_growth_daily", "[]"))
        if history and history[-1].get("day") == today:
            return
        table_names = [row[0] for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "AND name NOT IN ('meta','samples','exercise_exclusions')")]
        row_count = 0
        for table in table_names:
            # Table names come directly from sqlite_master and are quoted defensively.
            row_count += int(con.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0])
        page_size = int(con.execute('PRAGMA page_size').fetchone()[0] or 0)
        page_count = int(con.execute('PRAGMA page_count').fetchone()[0] or 0)
        footprint = page_size * page_count
        history.append({"day": today, "rows": row_count, "bytes": footprint})
        history = history[-32:]
        gh.set_meta(con, "db_growth_daily", history)
        con.commit()
    except Exception as ex:
        print(f"[database growth snapshot] skipped safely: {str(ex)[:200]}", file=sys.stderr)
    finally:
        if con is not None:
            con.close()


def loop():
    while True:
        run_sync()
        time.sleep(SYNC_EVERY)


def _database_maintenance_once():
    """Low-impact daily SQLite maintenance; full compaction is threshold-gated and backed up."""
    if DEMO or not os.path.exists(gh.DB_PATH):
        return
    con = None
    try:
        con = sqlite3.connect(gh.DB_PATH, timeout=8)
        con.execute("PRAGMA busy_timeout=8000")
        # Optimizer statistics and passive checkpoint are safe while the dashboard is in use.
        con.execute("PRAGMA optimize")
        try:
            con.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone()
        except sqlite3.DatabaseError:
            pass
        page_size = int(con.execute("PRAGMA page_size").fetchone()[0] or 4096)
        pages = int(con.execute("PRAGMA page_count").fetchone()[0] or 0)
        free_pages = int(con.execute("PRAGMA freelist_count").fetchone()[0] or 0)
        con.close()
        con = None
        db_bytes = os.path.getsize(gh.DB_PATH)
        free_ratio = free_pages / max(1, pages)
        if db_bytes >= DB_AUTO_COMPACT_MIN_BYTES and free_ratio >= DB_AUTO_COMPACT_FREE_RATIO:
            # Do not contend with a sync or user-requested optimization. gh.compact
            # creates and verifies a SQLite backup before making any structural changes.
            if sync_lock.acquire(blocking=False):
                try:
                    with optimize_state_guard:
                        already_running = bool(optimize_state.get("running"))
                    if not already_running:
                        _optimize_log(f"Automatic maintenance: fragmentation {free_ratio:.0%}; starting verified backup + compaction.")
                        with db_read_lock:
                            result = gh.compact(apply=True, emit=_optimize_log)
                        _optimize_log(f"Automatic maintenance complete; saved {result.get('bytes_saved', 0):,} bytes; integrity {result.get('integrity_after')}.")
                finally:
                    sync_lock.release()
    except Exception as ex:
        print(f"[database maintenance] skipped safely: {str(ex)[:300]}", file=sys.stderr)
    finally:
        if con is not None:
            con.close()


def database_maintenance_loop():
    # Delay startup maintenance so first page load and initial sync take priority.
    time.sleep(DB_MAINTENANCE_START_DELAY)
    while True:
        _database_maintenance_once()
        time.sleep(DB_MAINTENANCE_EVERY)


def _weighted_median(values, q=0.5):
    """Weighted median (or quantile q) of (value, weight) pairs.

    Uses the interpolated (Hazen-style) definition: each point sits at the middle of
    its own weight interval and the median is interpolated between the two points that
    straddle 50 %.  Unlike the textbook step-function version this is smooth, has no
    tie bias (two equal-weight points give their mean, not the lower one) and is stable
    when only a handful of days exist.  With many points it converges to the ordinary
    weighted median.
    """
    pairs = sorted((float(v), float(w)) for v, w in values if v is not None and w > 0)
    if not pairs:
        return None
    return _wmed_sorted([p[0] for p in pairs], [p[1] for p in pairs], q)


def _wmed_sorted(vs, ws, q=0.5):
    """Same as _weighted_median but for parallel lists already sorted by value."""
    n = len(vs)
    if n == 0:
        return None
    if n == 1:
        return vs[0]
    if not _INTERP_MEDIAN:  # legacy step-function median (kept for A/B testing only)
        half = sum(ws) / 2
        acc = 0.0
        for v, w in zip(vs, ws):
            acc += w
            if acc >= half:
                return v
        return vs[-1]
    target = sum(ws) * q
    acc = 0.0
    prev_mid = 0.0
    for i in range(n):
        w = ws[i]
        mid = acc + w / 2.0
        if mid >= target:
            if i == 0:
                return vs[0]
            span = mid - prev_mid
            t = (target - prev_mid) / span if span > 0 else 0.0
            return vs[i - 1] + t * (vs[i] - vs[i - 1])
        prev_mid = mid
        acc += w
    return vs[-1]


def _effective_n(weights):
    total = sum(weights)
    squares = sum(w * w for w in weights)
    return total * total / squares if squares else 0.0


# ---------------------------------------------------------------------------------
# Weekday heart-rate baseline ("what is normal for this time on this weekday?")
#
# Design
#   * Only COMPLETE past days feed the baseline.  Today is partial, so including it made
#     today's curve partly compare against itself.  Because of that, the baseline only
#     changes when a day completes (or an old day is back-filled), not on every sync.
#   * Every complete day is reduced once to 288 five-minute medians (workouts and the
#     15 minutes after them removed) and cached on disk with a small signature.  A sync
#     re-reads only days whose signature changed, instead of re-scanning a year of raw
#     samples.  Old days are re-verified once per calendar day; the newest two always.
#   * Estimation is hierarchical: weekday pool -> weekday/weekend pool -> all days, with
#     shrinkage k=3, 8-week half-life recency weights, coverage weights and robust
#     down-weighting of unusual days.  The estimate is lightly smoothed across
#     neighbouring slots only while data is thin (effective n < 8), so early curves are
#     not jagged and long histories are left untouched.
#   * Spread (sigma) is the day-to-day MAD around the expected curve, pooled for the
#     weekday and for all days (shrunk the same way) with a small-sample correction.
#   * "loo" curves: for each of the last 7 completed days, the expected curve for that
#     weekday computed WITHOUT that day, so a finished day can be compared fairly.
# ---------------------------------------------------------------------------------
TREND_METHOD = "robust_5m_v3"
TREND_BIN = 300
TREND_SLOTS = 288
TREND_WINDOW_DAYS = 364
TREND_HALF_LIFE_WEEKS = 8.0
TREND_SHRINK_K = 3.0
TREND_MIN_COVERAGE = 0.5
TREND_MASK_AFTER = 900
TREND_MIN_BPM, TREND_MAX_BPM = 20, 240
TREND_LOO_DAYS = 7
SIGMA_Q = 0.6827  # share of |residuals| inside 1 sigma; unlike 1.4826*MAD it stays honest for skewed/heavy-tailed data
_INTERP_MEDIAN = True
_SMOOTH = True
_trend_lock = threading.Lock()
_trend_mem = {}


def _trend_invalidate():
    with _trend_lock:
        cache = _trend_mem.get("cache")
        if cache is not None:
            cache["verified"] = None


def _to_epoch(value):
    if isinstance(value, (int, float)):
        return int(value)
    parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.astimezone()
    return int(parsed.timestamp())


def _local_midnight(day, _cache={}):
    v = _cache.get(day)
    if v is None:
        v = int(dt.datetime.combine(day, dt.time.min).astimezone().timestamp())
        if len(_cache) > 2000:
            _cache.clear()
        _cache[day] = v
    return v


def _tuples(con, sql, args=()):
    """Run a query returning plain tuples (much faster than sqlite3.Row for big scans)."""
    cur = con.cursor()
    cur.row_factory = None
    cur.execute(sql, args)
    return cur


def _merged_workout_masks(con, since_ts):
    spans = []
    try:
        for start, end in _tuples(con, "SELECT e.start,e.end FROM exercise e LEFT JOIN exercise_exclusions x ON x.id=e.id WHERE x.id IS NULL AND e.start IS NOT NULL AND e.end IS NOT NULL"):
            try:
                a = _to_epoch(start)
                b = _to_epoch(end) + TREND_MASK_AFTER
            except (TypeError, ValueError):
                continue
            if b >= since_ts and b >= a:
                spans.append((a, b))
    except Exception:
        pass
    spans.sort()
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            if b > merged[-1][1]:
                merged[-1][1] = b
        else:
            merged.append([a, b])
    return merged


def _day_profile(rows, lo, regular, masks):
    """Reduce one day of (ts,bpm) rows to {slot: median} for slots with usable data."""
    n = len(rows)
    tss = [r[0] for r in rows]
    keep = [(0, n)]
    if masks:
        keep = []
        pos = 0
        for a, b in masks:
            i0 = bisect.bisect_left(tss, a, pos)
            i1 = bisect.bisect_right(tss, b, i0)
            if i0 > pos:
                keep.append((pos, i0))
            pos = max(pos, i1)
        if pos < n:
            keep.append((pos, n))
    acc = {}  # slot -> [values, first_minute, last_minute]

    def flush(slot, buf, m0, m1):
        cur = acc.get(slot)
        if cur is None:
            acc[slot] = [buf, m0, m1]
        else:
            cur[0].extend(buf)
            if m0 < cur[1]:
                cur[1] = m0
            if m1 > cur[2]:
                cur[2] = m1

    lt = time.localtime
    for i0, i1 in keep:
        cur_slot, buf, m0, m1 = -1, [], 0, 0
        for i in range(i0, i1):
            ts, bpm = rows[i]
            if bpm is None or bpm < TREND_MIN_BPM or bpm > TREND_MAX_BPM:
                continue
            if regular:
                m = (ts - lo) // 60
            else:  # DST-change day: use the wall clock so slots match the displayed hours
                tm = lt(ts)
                m = tm.tm_hour * 60 + tm.tm_min
            s = m // 5
            if s != cur_slot:
                if buf:
                    flush(cur_slot, buf, m0, m1)
                cur_slot, buf, m0 = s, [bpm], m
            else:
                buf.append(bpm)
            m1 = m
        if buf:
            flush(cur_slot, buf, m0, m1)

    slots, meds = [], []
    for slot in sorted(acc):
        vals, m0, m1 = acc[slot]
        k = len(vals)
        if k < 3 or m0 == m1 or not (0 <= slot < TREND_SLOTS):
            continue
        vals.sort()
        med = vals[k // 2] if k % 2 else (vals[k // 2 - 1] + vals[k // 2]) / 2
        slots.append(slot)
        meds.append(round(float(med), 2))
    return slots, meds


def _trend_cache_path():
    # One cache per database file, so demo data and real data never share entries.
    tag = hashlib.md5(os.path.abspath(gh.DB_PATH).encode()).hexdigest()[:8]
    return os.path.join(CACHE_DIR, f"trend_cache_v3_{tag}.json")


def _load_trend_cache():
    with _trend_lock:
        cache = _trend_mem.get("cache")
        if cache is not None:
            return cache
    cache = None
    try:
        with open(_trend_cache_path(), "r", encoding="utf-8") as f:
            cache = json.load(f)
        if cache.get("method") != TREND_METHOD or not isinstance(cache.get("days"), dict):
            cache = None
    except Exception:
        cache = None
    if cache is None:
        cache = {"method": TREND_METHOD, "verified": None, "days": {}, "result_key": None, "result": None}
    with _trend_lock:
        _trend_mem["cache"] = cache
    return cache


def _save_trend_cache(cache):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = _trend_cache_path() + f".{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cache, f, separators=(",", ":"))
        os.replace(tmp, _trend_cache_path())
    except Exception as ex:
        print(f"[weekday_avg cache] {ex}", file=sys.stderr)


def _collect_trend_days(con, today, cache):
    """Return the list of usable complete days, refreshing only what changed."""
    window_start = today - dt.timedelta(days=TREND_WINDOW_DAYS)
    since_ts = _local_midnight(window_start)
    masks_all = _merged_workout_masks(con, since_ts)
    mask_starts = [m[0] for m in masks_all]
    mask_ends = [m[1] for m in masks_all]
    today_str = today.isoformat()
    full_check = cache.get("verified") != today_str
    recent_cut = today - dt.timedelta(days=2)
    days_cache = cache["days"]
    changed = False
    wanted = set()
    full_signatures = {}
    if full_check:
        end_ts = _local_midnight(today)
        signature_rows = _tuples(con, """SELECT date(ts,'unixepoch','localtime'), COUNT(*), COALESCE(MAX(ts),0)
            FROM hr_raw WHERE ts>=? AND ts<? GROUP BY date(ts,'unixepoch','localtime')""",
            (since_ts, end_ts)).fetchall()
        full_signatures = {str(day): (int(n), int(mx)) for day, n, mx in signature_rows}

    for k in range(1, TREND_WINDOW_DAYS + 1):
        day = today - dt.timedelta(days=k)
        key = day.isoformat()
        wanted.add(key)
        lo, hi = _local_midnight(day), _local_midnight(day + dt.timedelta(days=1))
        # workout masks overlapping this day (part of the signature)
        i = bisect.bisect_left(mask_ends, lo)
        day_masks = []
        while i < len(masks_all) and mask_starts[i] < hi:
            day_masks.append([masks_all[i][0], masks_all[i][1]])
            i += 1
        ent = days_cache.get(key)
        rows = None
        if ent is not None and ent["sig"][2] != day_masks:  # a workout was added/changed here (no DB query needed)
            ent = None
        if ent is not None and (full_check or day >= recent_cut):
            if full_check:
                n, mx = full_signatures.get(key, (0, 0))
            else:
                n, mx = _tuples(con, "SELECT COUNT(*), COALESCE(MAX(ts),0) FROM hr_raw WHERE ts>=? AND ts<?", (lo, hi)).fetchone()
            if ent["sig"] != [n, mx, day_masks]:
                ent = None
        if ent is None:
            rows = _tuples(con, "SELECT ts,bpm FROM hr_raw WHERE ts>=? AND ts<? ORDER BY ts", (lo, hi)).fetchall()
            sig = [len(rows), rows[-1][0] if rows else 0, day_masks]
            slots, meds = ([], []) if len(rows) < 3 else _day_profile(
                rows, lo, (hi - lo) == 86400, [(a, b) for a, b in day_masks])
            days_cache[key] = {"sig": sig, "s": slots, "m": meds}
            changed = True
    for key in [k for k in days_cache if k not in wanted]:
        del days_cache[key]
        changed = True
    if cache.get("verified") != today_str:
        cache["verified"] = today_str
        changed = True
    return changed


def _prepare_days(cache, today):
    days = []
    for key, ent in cache["days"].items():
        meds = ent["m"]
        if not meds:
            continue
        coverage = len(meds) / TREND_SLOTS
        if coverage < TREND_MIN_COVERAGE:
            continue
        s = sorted(meds)
        n = len(s)
        level = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
        day = dt.date.fromisoformat(key)
        days.append({"date": key, "wd": day.weekday(), "cov": coverage, "level": level,
                     "slots": ent["s"], "meds": meds, "age_w": (today - day).days / 7.0})
    days.sort(key=lambda d: d["date"])
    levels = [d["level"] for d in days]
    typical = statistics.median(levels) if levels else None
    mad = statistics.median(abs(v - typical) for v in levels) if levels else 0
    scale = max(1.0, 1.4826 * mad)
    for d in days:
        recency = 0.5 ** (d["age_w"] / TREND_HALF_LIFE_WEEKS)
        dist = abs(d["level"] - typical) if typical is not None else 0
        robust = min(1.0, 3 * scale / dist) if dist > 3 * scale else 1.0
        d["w"] = recency * d["cov"] * robust
    return days


def _blend(value, n, prior):
    if value is None:
        return prior
    if prior is None:
        return value
    return (n / (n + TREND_SHRINK_K)) * value + (TREND_SHRINK_K / (n + TREND_SHRINK_K)) * prior


def _small_sample_factor(n):
    """Turn in-sample spread into predictive spread for a NEW day.

    In-sample residuals understate spread by about sqrt((n-1)/n), and the expected curve
    itself carries estimation error of about sigma/sqrt(n).  Together a new day deviates by
    roughly sigma * sqrt((n+1)/(n-1)); capped so one or two days cannot blow the band up.
    """
    if n <= 1.5:
        return 2.0
    return min(2.0, ((n + 1.0) / (n - 1.0)) ** 0.5)


def _slot_pools(entries, skip=-1):
    allv, allw = [], []
    typ = [([], []), ([], [])]
    dow = [([], []) for _ in range(7)]
    for v, w, wd, di in entries:  # entries are sorted by value, so every pool stays sorted
        if di == skip:
            continue
        allv.append(v)
        allw.append(w)
        t = typ[1 if wd >= 5 else 0]
        t[0].append(v)
        t[1].append(w)
        d = dow[wd]
        d[0].append(v)
        d[1].append(w)
    return (allv, allw), typ, dow


def _estimate_slot(entries, skip=-1, only_dow=None):
    """Expected value per weekday for one 5-minute slot. Returns (exp[7], neff[7], sigma[7])."""
    (allv, allw), typ, dow = _slot_pools(entries, skip)
    va = _wmed_sorted(allv, allw)
    na = _effective_n(allw)
    lower = []
    for t in range(2):
        vt = _wmed_sorted(*typ[t])
        nt = _effective_n(typ[t][1])
        lower.append(_blend(vt, nt, va) if (vt is not None and va is not None) else (vt if vt is not None else va))
    exp, neff = [None] * 7, [0.0] * 7
    for d in range(7):
        if only_dow is not None and d != only_dow:
            continue
        vwd = _wmed_sorted(*dow[d])
        nwd = _effective_n(dow[d][1])
        exp[d] = _blend(vwd, nwd, lower[1 if d >= 5 else 0])
        neff[d] = nwd
    if only_dow is not None:
        return exp, neff, None
    # spread: residuals of every day around the expected curve of ITS weekday
    all_res, dow_res = [], [[] for _ in range(7)]
    for v, w, wd, di in entries:
        e = exp[wd]
        if e is None:
            continue
        r = (abs(v - e), w)
        all_res.append(r)
        dow_res[wd].append(r)
    sig = [3.0] * 7
    if all_res:
        rm_all = _weighted_median(all_res, SIGMA_Q)
        s_all = rm_all * _small_sample_factor(na) if rm_all is not None else None
        for d in range(7):
            if exp[d] is None:
                continue
            rm = _weighted_median(dow_res[d], SIGMA_Q) if dow_res[d] else None
            s_d = rm * _small_sample_factor(neff[d]) if rm is not None else None
            s = _blend(s_d, neff[d], s_all)
            sig[d] = max(3.0, s) if s is not None else 3.0
    return exp, neff, sig


def _smooth_curve(vals, neffs):
    if not _SMOOTH:
        return vals
    out = list(vals)
    for s in range(TREND_SLOTS):
        if vals[s] is None:
            continue
        n = neffs[s]
        h = 2 if n < 3 else (1 if n < 8 else 0)
        if h == 0:
            continue
        num = den = 0.0
        for j in range(-h, h + 1):
            t = s + j
            if 0 <= t < TREND_SLOTS and vals[t] is not None:
                wj = h + 1 - abs(j)
                num += wj * vals[t]
                den += wj
        out[s] = num / den
    return out


def _slot_entries(days):
    per_slot = [[] for _ in range(TREND_SLOTS)]
    for di, d in enumerate(days):
        w, wd = d["w"], d["wd"]
        if w <= 0:
            continue
        for s, m in zip(d["slots"], d["meds"]):
            per_slot[s].append((m, w, wd, di))
    for lst in per_slot:
        lst.sort()
    return per_slot


def _aggregate(days, today):
    per_slot = _slot_entries(days)
    exp = [[None] * TREND_SLOTS for _ in range(7)]
    neff = [[0.0] * TREND_SLOTS for _ in range(7)]
    sig = [[3.0] * TREND_SLOTS for _ in range(7)]
    for s in range(TREND_SLOTS):
        if not per_slot[s]:
            continue
        e, n, g = _estimate_slot(per_slot[s])
        for d in range(7):
            exp[d][s], neff[d][s], sig[d][s] = e[d], n[d], g[d]
    out = {"date": today.isoformat(), "method": TREND_METHOD, "bin_minutes": 5,
           "by_weekday": {}, "sigma_by_weekday": {}, "neff_by_weekday": {}, "loo": {}}
    for d in range(7):
        curve = _smooth_curve(exp[d], neff[d])
        out["by_weekday"][str(d)] = {str(s): round(curve[s], 1) for s in range(TREND_SLOTS) if curve[s] is not None}
        out["sigma_by_weekday"][str(d)] = {str(s): round(sig[d][s], 1) for s in range(TREND_SLOTS) if curve[s] is not None}
        out["neff_by_weekday"][str(d)] = {str(s): round(neff[d][s], 2) for s in range(TREND_SLOTS) if curve[s] is not None}
    # leave-one-out curves for the most recent completed days
    index_by_date = {d["date"]: i for i, d in enumerate(days)}
    for k in range(1, TREND_LOO_DAYS + 1):
        day = today - dt.timedelta(days=k)
        di = index_by_date.get(day.isoformat())
        if di is None:
            continue
        wd = days[di]["wd"]
        vals, ns = [None] * TREND_SLOTS, [0.0] * TREND_SLOTS
        for s in range(TREND_SLOTS):
            if not per_slot[s]:
                continue
            e, n, _ = _estimate_slot(per_slot[s], skip=di, only_dow=wd)
            vals[s], ns[s] = e[wd], n[wd]
        curve = _smooth_curve(vals, ns)
        out["loo"][day.isoformat()] = {str(s): round(curve[s], 1) for s in range(TREND_SLOTS) if curve[s] is not None}
    out["history_days"] = len(days)
    return out


def _weekday_avg(con, today):
    """Robust 5-minute HR baseline per weekday (see the design notes above)."""
    cache = _load_trend_cache()
    with _trend_lock:
        lock_cache = cache
    changed = _collect_trend_days(con, today, lock_cache)
    days = _prepare_days(lock_cache, today)
    key_src = json.dumps([TREND_METHOD, today.isoformat(), _INTERP_MEDIAN, _SMOOTH,
                          [[d["date"], len(d["meds"]), round(sum(d["meds"]), 1)] for d in days]], separators=(",", ":"))
    key = hashlib.md5(key_src.encode()).hexdigest()
    if lock_cache.get("result_key") == key and lock_cache.get("result"):
        result = lock_cache["result"]
    else:
        result = _aggregate(days, today)
        lock_cache["result_key"], lock_cache["result"] = key, result
        changed = True
    if changed:
        _save_trend_cache(lock_cache)
    out = dict(result)
    out["by_weekday"] = result["by_weekday"]
    out["current"] = result["by_weekday"].get(str(today.weekday()), {})
    out["prev"] = result["by_weekday"].get(str((today.weekday() - 1) % 7), {})
    out["settings"] = {"half_life_weeks": TREND_HALF_LIFE_WEEKS, "shrinkage_k": TREND_SHRINK_K,
                       "bin_minutes": 5, "minimum_day_coverage": TREND_MIN_COVERAGE,
                       "workout_mask_minutes_after": TREND_MASK_AFTER // 60,
                       "baseline_uses_complete_days_only": True, "smoothing_when_thin": _SMOOTH}
    return out


def _dur_seconds(value):
    """Seconds from a number or a protobuf-style duration string such as '1080s' (Google's format)."""
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text.endswith("s"):
        text = text[:-1]
    try:
        return float(text)
    except ValueError:
        return 0.0


def _bucket_5m_ms(rows):
    """[(ts_s, bpm)] sorted by time -> [[bucket_start_ms, mean(1dp), min, max]] per 5 minutes (one pass)."""
    out = []
    key = None
    total = n = lo = hi = 0
    for ts, bpm in rows:
        if bpm is None:
            continue
        k = ts // 300
        if k != key:
            if n:
                out.append([key * 300000, round(total / n, 1), lo, hi])
            key, total, n, lo, hi = k, bpm, 1, bpm, bpm
        else:
            total += bpm
            n += 1
            if bpm < lo:
                lo = bpm
            elif bpm > hi:
                hi = bpm
    if n:
        out.append([key * 300000, round(total / n, 1), lo, hi])
    return out


def _read_settings(con):
    out = {}
    for k in SETTING_KEYS:
        raw = gh.get_meta(con, f"setting_{k}")
        try:
            out[k] = json.loads(raw) if raw is not None else None
        except Exception:
            out[k] = raw
    return out


def _dedupe_sleep_sessions(sleep):
    """For near-identical sleep windows, retain the session with most asleep time."""
    def epoch(value):
        try:
            parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.timestamp()
        except (TypeError, ValueError, OverflowError):
            return None

    ordered = []
    for session in sleep:
        start, end = epoch(session.get("start")), epoch(session.get("end"))
        if start is None or end is None or end <= start:
            ordered.append((None, None, session))
        else:
            ordered.append((start, end, session))
    valid = sorted((x for x in ordered if x[0] is not None), key=lambda x: (x[0], x[1]))
    kept = [x for x in ordered if x[0] is None]
    group = []
    group_end = None

    def flush(items):
        if not items:
            return
        winner = max(items, key=lambda x: (float(x[2].get("asleep") or 0), -(x[1] - x[0])))
        kept.append(winner)

    for item in valid:
        start, end, _ = item
        if group:
            overlap = max(0, min(group_end, end) - max(group[0][0], start))
            union = max(group_end, end) - min(group[0][0], start)
            if union <= 0 or overlap / union < 0.90:
                flush(group)
                group = []
        group.append(item)
        group_end = max(group_end or end, end)
    flush(group)
    return [x[2] for x in sorted(kept, key=lambda x: (x[0] is None, x[0] or 0))]


def _load_sleep_stages(con, sleep):
    """Stages for every session in ONE query per 500 sessions (was one query per session, twice)."""
    by_id = {sl["id"]: [] for sl in sleep}
    ids = list(by_id)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        marks = ",".join("?" * len(chunk))
        try:
            for sid, st, en, ty in _tuples(
                    con, f"SELECT sleep_id,start,end,type FROM sleep_stages WHERE sleep_id IN ({marks}) "
                         "ORDER BY sleep_id,start", chunk):
                by_id[sid].append((int(st), int(en), ty))
        except Exception:
            pass
    return by_id


def _attach_sleep_quality(sleep, stages_by_id):
    for sl in sleep:
        stages = stages_by_id.get(sl["id"]) or []
        if stages:
            try:
                session_start = int(dt.datetime.fromisoformat(
                    sl["start"].replace("Z", "+00:00")).timestamp())
            except Exception:
                session_start = None
            first_sound = None
            for st, _en, ty in stages:
                if ty in ("DEEP", "LIGHT", "REM"):
                    first_sound = st
                    break
            awake_segs = [(st, en) for st, en, ty in stages if ty == "AWAKE"]
            deep_segs = [(st, en) for st, en, ty in stages if ty == "DEEP"]
            sl["latency_min"] = (int((first_sound - session_start) / 60)
                                 if (first_sound is not None and session_start is not None)
                                 else None)
            sl["sound_sleep_min"] = int(sum(e - s for s, e in deep_segs) / 60) or None
            sl["restless_min"] = int(sum(e - s for s, e in awake_segs) / 60)
            sl["interruptions"] = len(awake_segs)
        else:
            sl["latency_min"] = None
            sl["sound_sleep_min"] = int(sl.get("deep") or 0) or None
            sl["restless_min"] = int(sl.get("awake") or 0) or None
            sl["interruptions"] = None


def _workout_strain(con, day):
    since = (dt.date.fromisoformat(day) - dt.timedelta(days=1)).isoformat()
    workouts = con.execute(
        "SELECT e.duration_s, e.avg_hr FROM exercise e LEFT JOIN exercise_exclusions x ON x.id=e.id WHERE x.id IS NULL AND e.day >= ? AND e.day <= ?",
        (since, day)).fetchall()
    if not workouts:
        return 0
    strain = 0
    for w in workouts:
        dur_min = (w["duration_s"] or 0) / 60
        hr = w["avg_hr"]
        if dur_min > 0 and hr:
            strain += dur_min * (hr / 190.0)
    return round(strain, 1)


def payload(days):
    con = gh.db()
    today = dt.date.today()
    since_day = (today - dt.timedelta(days=days)).isoformat()

    first_hr_ts = con.execute("SELECT MIN(ts) FROM hr_raw").fetchone()[0]
    first_hr_day = dt.datetime.fromtimestamp(first_hr_ts).date().isoformat() if first_hr_ts else None
    limits = {"steps": (0, 150000), "distance_m": (0, 150.0), "active_minutes": (0, 1440),
              "sedentary_seconds": (0, 86400), "calories": (0, 20000),
              "azm_fatburn": (0, 1440), "azm_cardio": (0, 1440), "azm_peak": (0, 1440),
              "weight": (20, 400), "systolic_bp": (50, 300), "diastolic_bp": (20, 200)}
    daily = {}
    # Keep compact daily series for long-range selectors available even when
    # the rest of the dashboard is set to a short period.
    long_range_day = (today - dt.timedelta(days=400)).isoformat()
    for day, metric, value in _tuples(
            con, "SELECT day, metric, value FROM daily WHERE day >= ? OR "
                 "(metric IN ('steps','calories','weight','systolic_bp','diastolic_bp') AND day >= ?) ORDER BY day",
            (since_day, long_range_day)):
        if value is None:
            continue
        lim = limits.get(metric)
        if lim is not None and not (lim[0] <= float(value) <= lim[1]):
            continue
        daily.setdefault(metric, []).append([day, value])

    recovery_daily = {}
    recovery_since = (today - dt.timedelta(days=90)).isoformat()
    for metric, day, value in con.execute(
        "SELECT metric,day,value FROM daily WHERE metric IN ('hrv_deep','resting_hr','resp_rate','body_temp') AND day>=? ORDER BY day",
        (recovery_since,)):
        recovery_daily.setdefault(metric, []).append([day, value])
    sleep = [dict(r) for r in con.execute(
        "SELECT id, day, start, end, asleep, awake, deep, light, rem, in_bed, main, nap, has_stages "
        "FROM sleep WHERE day >= ? ORDER BY start", (since_day,))]
    sleep = _dedupe_sleep_sessions(sleep)
    history_since_day = (today - dt.timedelta(days=90)).isoformat()
    sleep_score_history = [dict(r) for r in con.execute(
        "SELECT id, day, start, end, asleep, awake, deep, light, rem, in_bed, main, nap, has_stages "
        "FROM sleep WHERE day >= ? ORDER BY start", (history_since_day,))]
    sleep_score_history = _dedupe_sleep_sessions(sleep_score_history)
    history_stages = _load_sleep_stages(con, sleep_score_history)
    _attach_sleep_quality(sleep_score_history, history_stages)
    stage_rows = _load_sleep_stages(con, sleep)
    _attach_sleep_quality(sleep, stage_rows)
    sleep_ids = [str(sl["id"]) for sl in sleep_score_history]
    sleep_score_snapshots = {}
    if sleep_ids:
        for offset in range(0, len(sleep_ids), 500):
            batch = sleep_ids[offset:offset + 500]
            marks = ",".join("?" for _ in batch)
            try:
                for row in con.execute(f"SELECT sleep_id,score,coverage,detail,scored_at,algorithm FROM sleep_score_snapshots WHERE sleep_id IN ({marks})", batch):
                    try:
                        snap = json.loads(row["detail"])
                        snap.update({"score": row["score"], "coverage": row["coverage"], "frozen": True, "scored_at": row["scored_at"]})
                        sleep_score_snapshots[row["sleep_id"]] = snap
                    except Exception:
                        continue
            except Exception:
                break
    sleep_stages_by_id = {
        sid: [{"start": st * 1000, "end": en * 1000, "type": ty} for st, en, ty in rows]
        for sid, rows in history_stages.items() if rows}
    # session boundaries parsed once (epoch seconds); None when a timestamp is unreadable
    sleep_span = {}
    for sl in sleep:
        try:
            sleep_span[sl["id"]] = (int(dt.datetime.fromisoformat(sl["start"].replace("Z", "+00:00")).timestamp()),
                                    int(dt.datetime.fromisoformat(sl["end"].replace("Z", "+00:00")).timestamp()))
        except Exception:
            sleep_span[sl["id"]] = None

    cutoff_epoch = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)).timestamp())
    hist_since = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=min(days, 365))).timestamp())
    hr_rows, daily_hr_rows = [], []
    try:
        # Only fetch high-frequency samples needed for the last-24-hour chart.
        # Historical plots use hr_day rollups; do not serialize hundreds of thousands
        # of raw readings on every dashboard refresh.
        hr_rows = _tuples(con, "SELECT ts, bpm FROM hr_raw WHERE ts >= ? ORDER BY ts", (cutoff_epoch,)).fetchall()
        daily_hr_rows = con.execute(
            "SELECT day, n, lo, q1, med, mean, q3, hi FROM hr_day WHERE day >= ? ORDER BY day",
            (since_day,)).fetchall()
    except Exception as ex:
        print(f"[payload] HR rollup read failed: {ex}", file=sys.stderr)

    # Legacy fallback is used only if raw HR has not yet been migrated.
    try:
        # Only "fewer than 10 rows?" matters, so stop counting at 10 instead of scanning the table.
        raw_count = con.execute("SELECT COUNT(*) FROM (SELECT 1 FROM hr_raw LIMIT 10)").fetchone()[0]
    except Exception:
        raw_count = 0
    if raw_count < 10 and gh._has_table(con, "hr"):
        try:
            def to_epoch(v):
                return int(dt.datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp())
            if not hr_rows:
                hr_rows = [(to_epoch(r['ts']), int(r['bpm'])) for r in con.execute(
                    "SELECT ts,bpm FROM hr WHERE ts >= ? ORDER BY ts",
                    ((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'),))]
        except Exception as ex:
            print(f"[payload] legacy HR fallback failed: {ex}", file=sys.stderr)

    hr = _bucket_5m_ms(hr_rows)

    # Normally hr_day is kept current at sync time. Build a slower fallback only if
    # the rollup table is empty for the requested period; this path is exceptional.
    if daily_hr_rows:
        hr_daily = [[r['day'], r['lo'], r['q1'], r['med'], r['mean'], r['q3'], r['hi'], r['n']]
                    for r in daily_hr_rows]
    else:
        history_rows = []
        try:
            history_rows = [(int(r['ts']), int(r['bpm'])) for r in con.execute(
                "SELECT ts,bpm FROM hr_raw WHERE ts >= ? ORDER BY ts", (hist_since,))]
        except Exception as ex:
            print(f"[payload] HR rollup fallback failed: {ex}", file=sys.stderr)
        if len(history_rows) < 10 and gh._has_table(con, "hr"):
            try:
                def to_epoch(v):
                    return int(dt.datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp())
                history_rows = [(to_epoch(r['ts']), int(r['bpm'])) for r in con.execute(
                    "SELECT ts,bpm FROM hr WHERE ts >= ? ORDER BY ts",
                    ((today - dt.timedelta(days=min(days, 365))).isoformat() + 'T00:00:00Z',))]
            except Exception as ex:
                print(f"[payload] legacy HR history fallback failed: {ex}", file=sys.stderr)
        day_vals = {}
        for ts, bpm in history_rows:
            d = dt.datetime.fromtimestamp(ts).date().isoformat()
            day_vals.setdefault(d, []).append(bpm)

        def quantile(v, q):
            v = sorted(v); pos = (len(v) - 1) * q; i = int(pos); j = min(i + 1, len(v) - 1); f = pos - i
            return round(v[i] * (1 - f) + v[j] * f, 1)
        hr_daily = [[d, min(v), quantile(v, .25), quantile(v, .5), round(sum(v) / len(v), 1),
                     quantile(v, .75), max(v), len(v)] for d, v in sorted(day_vals.items())]

    sleep_hr, sleep_hr_stats = {}, {}
    for sl in sleep:
        span = sleep_span.get(sl['id'])
        if span is None:
            continue
        try:
            a, b = span
            rows = _tuples(con, "SELECT ts,bpm FROM hr_raw WHERE ts>=? AND ts<=? ORDER BY ts", (a, b)).fetchall()
            vals = [[ts * 1000, bpm] for ts, bpm in rows]
            if not vals:
                vals = [[ts * 1000, bpm] for ts, bpm in _tuples(
                    con, "SELECT ts,bpm FROM sleep_hr WHERE sleep_id=? ORDER BY ts", (sl['id'],))]
            if vals:
                # Keep full-precision statistics but bound JSON sent for each sleep.
                # The chart draws at most 700 raw dots anyway, so 1,200 evenly sampled
                # points per session are enough for rendering and user interaction.
                count = len(vals)
                bpm_vals = [p[1] for p in vals]
                sleep_hr_stats[sl['id']] = {
                    "count": count, "mean": round(sum(bpm_vals) / count, 2),
                    "lo": min(bpm_vals), "hi": max(bpm_vals)}
                limit = 1200
                stride = max(1, (count + limit - 1) // limit)
                sampled = vals[::stride]
                if sampled[-1] != vals[-1]:
                    sampled.append(vals[-1])
                sleep_hr[sl['id']] = sampled
        except Exception as ex:
            print(f"[sleep_hr] {ex}", file=sys.stderr)

    window_start_ts = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=min(days, 365))).timestamp())
    hrv_samples = []
    try:
        hrv_samples = [[ts * 1000, rmssd, sd, hf, lf] for ts, rmssd, sd, hf, lf in _tuples(
            con, "SELECT ts,rmssd,sd,hf_power,lf_power FROM hrv_samples WHERE ts >= ? ORDER BY ts", (window_start_ts,))]
    except Exception as ex:
        print(f"[hrv_samples] {ex}", file=sys.stderr)

    try:
        existing_hrv_days = {str(row[0]) for row in daily.get("hrv", [])}
        by_local_day = {}
        for ts_ms, rmssd, _sd, *_power in hrv_samples:
            if rmssd is None:
                continue
            day = dt.datetime.fromtimestamp(ts_ms / 1000).date().isoformat()
            by_local_day.setdefault(day, []).append(float(rmssd))
        for day, values in sorted(by_local_day.items()):
            if day not in existing_hrv_days:
                daily.setdefault("hrv", []).append([day, round(statistics.median(values), 1)])
        if "hrv" in daily:
            daily["hrv"].sort(key=lambda row: row[0])
    except Exception as ex:
        print(f"[daily HRV sample fallback] {ex}", file=sys.stderr)

    # Samples are time-ordered, so each session is a slice found by binary search
    # (was a full scan of every sample for every session).
    hrv_ts = [r[0] for r in hrv_samples]
    sleep_hrv = {}
    for sl in sleep:
        span = sleep_span.get(sl['id'])
        if span is None:
            continue
        i0 = bisect.bisect_left(hrv_ts, span[0] * 1000)
        i1 = bisect.bisect_right(hrv_ts, span[1] * 1000)
        if i1 > i0:
            sleep_hrv[sl['id']] = hrv_samples[i0:i1]

    spo2_samples = []
    try:
        spo2_samples = [[ts * 1000, pct] for ts, pct in _tuples(
            con, "SELECT ts,pct FROM spo2_samples WHERE ts >= ? ORDER BY ts", (window_start_ts,))]
    except Exception as ex:
        print(f"[spo2_samples] {ex}", file=sys.stderr)

    try:
        # Use every timestamped reading, including short sleeps and naps, for
        # daily SpO2. A provider daily summary is retained only when the day
        # has no raw samples; otherwise the raw-sample mean is more complete.
        sample_days = {}
        for ts_ms, pct in spo2_samples:
            if pct is None:
                continue
            day = dt.datetime.fromtimestamp(ts_ms / 1000).date().isoformat()
            sample_days.setdefault(day, []).append(float(pct))
        daily_spo2 = {str(row[0]): row[1] for row in daily.get("spo2", [])}
        for day, values in sample_days.items():
            if values:
                daily_spo2[day] = round(statistics.mean(values), 1)
        daily["spo2"] = [[day, daily_spo2[day]] for day in sorted(daily_spo2)]
    except Exception as ex:
        print(f"[daily SpO2 raw sample aggregation] {ex}", file=sys.stderr)

    zone_time = {}

    hourly = [[r['hour'], r['steps']] for r in con.execute(
        "SELECT hour,steps FROM steps_hourly ORDER BY hour DESC LIMIT 48")][::-1]
    hourly = [r for r in hourly if r[1] is not None and 0 <= int(r[1]) <= 20000]
    stress_since = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=60)).timestamp())
    # hr_min.m is an INTEGER PRIMARY KEY in epoch minutes. Keep the indexed
    # column bare in the predicate so SQLite can seek directly to the cutoff.
    stress_since_minute = (stress_since + 59) // 60
    stress_hr_minutes = [[int(r[0]) * 60000, round(float(r[1]), 1), int(r[2])]
                         for r in con.execute("SELECT m,q25,n FROM hr_min WHERE m >= ? ORDER BY m",
                                              (stress_since_minute,)) if r[1] is not None]
    steps_5m = []
    try:
        # Only send five-minute movement samples in the selected dashboard window.
        # `time` is the table's TEXT primary key and provider timestamps are ISO-8601,
        # so this range query can use the existing primary-key index. The live-stress
        # baseline also needs 30 days even when a shorter dashboard range is selected.
        steps_since_day = min(since_day, (today - dt.timedelta(days=30)).isoformat())
        steps_5m = [[int(dt.datetime.fromisoformat(str(r[0]).replace('Z', '+00:00')).timestamp() * 1000), int(r[1])]
                    for r in con.execute("SELECT time,steps FROM steps_5m WHERE time >= ? ORDER BY time",
                                         (steps_since_day,)) if r[1] is not None]
    except Exception as ex:
        print(f"[payload] 5-minute steps unavailable: {ex}", file=sys.stderr)
    exercise = []
    for r in con.execute(
            "SELECT e.id,e.day,e.start,e.end,e.type,e.distance_m,e.duration_s,e.vo2max,e.avg_hr,e.kcal,e.raw,CASE WHEN x.id IS NULL THEN 0 ELSE 1 END AS excluded FROM exercise e LEFT JOIN exercise_exclusions x ON x.id=e.id ORDER BY e.start DESC"):
        duration_s = r['duration_s']
        distance_km = r['distance_m']
        if duration_s is not None and not (0 < float(duration_s) <= 24*3600):
            duration_s = None
        if distance_km is not None and not (0 <= float(distance_km) <= 150):
            distance_km = None
        try:
            workout_start = int(dt.datetime.fromisoformat(str(r['start']).replace('Z', '+00:00')).timestamp())
            workout_end = int(dt.datetime.fromisoformat(str(r['end']).replace('Z', '+00:00')).timestamp())
            peak_row = con.execute("SELECT MAX(bpm) FROM hr_raw WHERE ts >= ? AND ts <= ?", (workout_start, workout_end)).fetchone()
            peak_hr = peak_row[0] if peak_row else None
        except (TypeError, ValueError, OverflowError):
            peak_hr = None
        exercise.append({"id": r['id'], "day": r['day'], "start": r['start'], "end": r['end'], "type": r['type'],
                         "distance_m": distance_km, "duration_s": duration_s, "vo2max": r['vo2max'],
                         "avg_hr": r['avg_hr'], "peak_hr": peak_hr, "kcal": r['kcal'], "calories_kcal": r['kcal'], "raw": r['raw'], "excluded": bool(r['excluded'])})

    # Workout time-in-zone. Provider values (Google Health heartRateZoneDurations) are
    # authoritative when present; otherwise zones are derived from raw HR with Karvonen
    # edges. Each workout's raw JSON is parsed once and feeds both the per-workout zones
    # and the per-day zone_time map (previously parsed twice).
    try:
        age_raw = gh.get_meta(con, "setting_age")
        age = int(json.loads(age_raw)) if age_raw else None
    except (TypeError, ValueError, json.JSONDecodeError):
        age = None
    try:
        rhr_row = con.execute(
            "SELECT AVG(value) FROM daily WHERE metric='resting_hr' AND day >= ? AND day <= ?",
            ((today - dt.timedelta(days=30)).isoformat(), today.isoformat())).fetchone()
        zone_rhr = float(rhr_row[0]) if rhr_row and rhr_row[0] is not None else 60.0
    except Exception:
        zone_rhr = 60.0
    zone_max_hr = gh.estimate_zone_max_hr(age, zone_rhr, [w for w in exercise if not w.get("excluded")])
    zone_hrr = max(1.0, zone_max_hr - zone_rhr)

    # Raw-HR strain: integrate sampled heart-rate reserve intensity over time.
    # Each sample contributes at most five minutes; missing periods contribute no load.
    strain_since = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=90)).timestamp())
    raw_strain = []
    try:
        readings = _tuples(con, "SELECT (ts/10)*10 AS ts,AVG(bpm) AS bpm,COUNT(*) AS n FROM hr_raw WHERE ts>=? GROUP BY ts/10 ORDER BY ts/10", (strain_since,)).fetchall()
        rhr_by_day = {str(d): float(v) for d, v in con.execute(
            "SELECT day,value FROM daily WHERE metric='resting_hr' AND day>=?",
            ((today - dt.timedelta(days=100)).isoformat(),)) if v is not None and float(v) > 0}
        daily_dose, daily_samples = {}, {}
        sex = str(_read_settings(con).get("sex") or "m").lower()
        b = 1.67 if sex in ("f", "female") else 1.92
        for idx, (ts, bpm, raw_count) in enumerate(readings):
            ts, bpm = int(ts), float(bpm)
            day = dt.datetime.fromtimestamp(ts).date().isoformat()
            rest = rhr_by_day.get(day, zone_rhr)
            reserve = max(1.0, zone_max_hr - rest)
            next_ts = int(readings[idx + 1][0]) if idx + 1 < len(readings) else ts + 60
            minutes = min(5.0, max(0.0, (next_ts - ts) / 60.0))
            fraction = max(0.0, min(1.0, (bpm - rest) / reserve))
            # Ignore resting/light background HR so ordinary daily samples do not
            # accumulate into a persistently high strain score without effort.
            if minutes and fraction >= 0.30:
                daily_samples[day] = daily_samples.get(day, 0) + int(raw_count)
                daily_dose[day] = daily_dose.get(day, 0.0) + fraction * math.exp(b * fraction) * 1.15 * minutes
        for offset in range(89, -1, -1):
            day = (today - dt.timedelta(days=offset)).isoformat()
            # This is a daily 0–21 strain score; long-term training load is
            # represented separately by the 7-/28-day averages in the dashboard.
            dose = daily_dose.get(day, 0.0)
            score = 21.0 * (1.0 - math.exp(-dose / (120.0 / math.log(2))))
            raw_strain.append([day, round(score, 2), round(dose, 2), daily_samples.get(day, 0)])
    except Exception as ex:
        print(f"[raw HR strain] {ex}", file=sys.stderr)
    zone_limits = [zone_rhr + zone_hrr * p for p in (.50, .60, .70, .80, .90, 1.00)]
    zone_edges = [zone_rhr + zone_hrr * p for p in (.50, .60, .70, .80, .90)]
    upper_edges = zone_edges[1:5]  # bisect_right(...) == index of the first edge above bpm == zone index
    zone_keys = ("lightTime", "moderateTime", "vigorousTime", "peakTime")
    for w in exercise:
        w["zone_seconds"] = 0
        w["zone_durations"] = {"lightTime": 0, "moderateTime": 0, "vigorousTime": 0, "peakTime": 0}
        if w.get("excluded"):
            continue
        provider = None
        try:
            raw = json.loads(w.get("raw") or "{}")
            provider = ((raw.get("metricsSummary") or {}).get("heartRateZoneDurations") or {})
            if not isinstance(provider, dict):
                provider = None
        except (TypeError, ValueError, AttributeError):
            provider = None
        try:
            if provider is not None and any(_dur_seconds(provider.get(k)) > 0 for k in zone_keys):
                w["zone_durations"] = {k: max(0.0, _dur_seconds(provider.get(k))) for k in zone_keys}
                w["zone_seconds"] = sum(w["zone_durations"].values())
            elif w.get("start") and w.get("end"):
                start_ts, end_ts = _to_epoch(w["start"]), _to_epoch(w["end"])
                if end_ts > start_ts:
                    samples = _tuples(con, "SELECT ts,bpm FROM hr_raw WHERE ts >= ? AND ts <= ? ORDER BY ts",
                                      (start_ts, end_ts)).fetchall()
                    zone_sec = [0, 0, 0, 0, 0]
                    last = len(samples) - 1
                    for i, (ts, bpm) in enumerate(samples):
                        next_ts = samples[i + 1][0] if i < last else ts + 1
                        seconds = max(0, min(5, next_ts - ts, end_ts - ts))
                        if seconds > 0 and bpm is not None:
                            zone_sec[bisect.bisect_right(upper_edges, bpm)] += seconds
                    # UI exposes four named bands: Karvonen Z1->Light, Z2->Moderate, Z3->Vigorous, Z4+Z5->Peak.
                    w["zone_durations"] = {"lightTime": zone_sec[0], "moderateTime": zone_sec[1],
                                           "vigorousTime": zone_sec[2], "peakTime": zone_sec[3] + zone_sec[4]}
                    w["zone_seconds"] = sum(zone_sec)
        except Exception as ex:
            print(f"[workout zones] {w.get('id')}: {ex}", file=sys.stderr)
        # The overview uses the all-day derived HR timeline, populated below.
        # Provider durations remain available on each workout, but using them as
        # the daily total drops all non-workout HR samples from the zone average.

    # Overview zone minutes come from raw HR samples across each day. Provider
    # workout summaries are only a fallback for days without a derived daily row.
    try:
        rows = con.execute("""SELECT day, z1_sec, z2_sec, z3_sec, z4_sec, z5_sec
                              FROM hr_zone_time WHERE day >= ? ORDER BY day""", (since_day,)).fetchall()
        excluded_days = {w.get("day") for w in exercise if w.get("excluded")}
        for r in rows:
            day = r['day']
            if day in excluded_days:
                continue
            zone_time[day] = {"z1": r['z1_sec'] or 0, "z2": r['z2_sec'] or 0,
                              "z3": r['z3_sec'] or 0, "z4": r['z4_sec'] or 0,
                              "z5": r['z5_sec'] or 0}
    except Exception:
        # Older databases may not have the derived zone table yet.
        pass

    # Fall back to summed provider totals only when a day's raw HR summary is absent.
    raw_summary_days = set(zone_time)
    for w in exercise:
        if w.get("excluded") or not w.get("day") or w["day"] in raw_summary_days:
            continue
        try:
            raw = json.loads(w.get("raw") or "{}")
            provider = ((raw.get("metricsSummary") or {}).get("heartRateZoneDurations") or {})
            if not isinstance(provider, dict) or not any(provider.get(k) is not None for k in zone_keys):
                continue
            row = zone_time.setdefault(w["day"], {"z1": 0, "z2": 0, "z3": 0, "z4": 0, "z5": 0})
            values = [max(0.0, _dur_seconds(provider.get(k))) for k in zone_keys]
            for key, value in zip(("z1", "z2", "z3", "z4"), values):
                row[key] += value
        except (TypeError, ValueError, AttributeError):
            continue

    timings = {}
    try:
        timings = json.loads(gh.get_meta(con, 'last_sync_timings', '{}') or '{}')
    except Exception:
        pass
    try:
        sync_elapsed_history = json.loads(gh.get_meta(con, 'sync_elapsed_history', '[]') or '[]')
        if not isinstance(sync_elapsed_history, list):
            sync_elapsed_history = []
    except Exception:
        sync_elapsed_history = []

    weekday_name = today.strftime("%A")
    weekday_avg = _weekday_avg(con, today)
    strain = _workout_strain(con, today.isoformat())

    freshness = {}
    for m in ("resting_hr", "hrv", "spo2", "resp_rate", "body_temp", "active_minutes", "steps"):
        rows = daily.get(m) or []
        latest = rows[-1][0] if rows else None
        freshness[m] = latest

    # The database/WAL file stamp is already the payload-cache invalidation key.
    # Reuse it here instead of scanning every row in large tables (notably hr_raw)
    # to calculate COUNT(*) and MAX() on every payload rebuild.
    data_version = hashlib.md5(repr(_db_stamp()).encode("utf-8")).hexdigest()

    out = {"version": data_version, "today": today.isoformat(), "weekday_name": weekday_name, "demo": DEMO,
           "signed_in": DEMO or gh.have_token(),
           "syncing": sync_state['running'], "last_sync": gh.get_meta(con, 'last_sync'),
           "sync_seconds": gh.get_meta(con, 'last_sync_seconds'), "sync_timings": timings,
           "last_sync_elapsed_seconds": gh.get_meta(con, 'last_sync_elapsed_seconds'),
           "sync_elapsed_history": sync_elapsed_history,
           "errors": json.loads(gh.get_meta(con, 'errors', '{}') or '{}'),
           "settings": _read_settings(con),
           "daily": daily, "recovery_daily": recovery_daily, "sleep": sleep, "sleep_hr": sleep_hr, "sleep_hr_stats": sleep_hr_stats,
           "sleep_stages_by_id": sleep_stages_by_id,
           "sleep_score_snapshots": sleep_score_snapshots, "sleep_score_history": sleep_score_history, "hr_strain": raw_strain,
           "hr": hr, "hr_daily": hr_daily,
           "hrv_samples": hrv_samples, "sleep_hrv": sleep_hrv, "spo2_samples": spo2_samples,
           "zone_time": zone_time, "zone_limits": {"rhr": zone_rhr, "max_hr": zone_max_hr, "edges": zone_limits},
           "workout_strain": strain,
           "data_coverage_start": first_hr_day,
           "freshness": freshness,
           "hourly_steps": hourly, "steps_5m": steps_5m, "stress_hr_minutes": stress_hr_minutes, "exercise": exercise,
           "weekday_avg": weekday_avg}
    con.close()
    return out


def _optimize_log(line):
    """Keep a short bounded progress log for the UI."""
    with optimize_state_guard:
        optimize_state["log"].append(str(line)[:500])
        optimize_state["log"] = optimize_state["log"][-20:]
        low = str(line).lower()
        if "backup created" in low:
            optimize_state["stage"] = "backup verified"
        elif "vacuum" in low or "compacting" in low:
            optimize_state["stage"] = "compacting database"


def _run_database_optimization():
    started = time.time()
    try:
        with optimize_state_guard:
            optimize_state["stage"] = "checking database and creating backup"
        from db_diagnostics import summary as diagnostics_summary
        with db_read_lock:
            before_report = diagnostics_summary(gh.DB_PATH)
            if before_report.get("integrity") != "ok":
                raise RuntimeError("SQLite integrity check is not OK. No cleanup was performed.")
            result = gh.compact(apply=True, emit=_optimize_log)
            after_report = diagnostics_summary(gh.DB_PATH)
        result["before_bytes"] = int(result.get("before_bytes") or before_report.get("file_size_bytes") or 0)
        result["after_bytes"] = int(after_report.get("file_size_bytes") or os.path.getsize(gh.DB_PATH))
        result["bytes_saved"] = max(0, result["before_bytes"] - result["after_bytes"])
        result["integrity_after"] = after_report.get("integrity")
        result["elapsed_seconds"] = round(time.time() - started, 1)
        result["diagnostics"] = after_report
        with optimize_state_guard:
            optimize_state.update({"running": False, "stage": "complete", "finished_at": time.time(),
                                   "result": result, "error": None})
            optimize_state["log"] = (optimize_state["log"] + ["Optimization finished; post-cleanup integrity: " + str(result["integrity_after"])])[-20:]
    except Exception as ex:
        with optimize_state_guard:
            optimize_state.update({"running": False, "stage": "failed", "finished_at": time.time(),
                                   "result": None, "error": str(ex)[:800]})
            optimize_state["log"] = (optimize_state["log"] + ["ERROR: " + str(ex)[:450]])[-20:]
    finally:
        sync_lock.release()


def _local_same_origin_request(handler):
    """Block cross-origin browser requests from triggering a destructive local action."""
    host_header = handler.headers.get("Host", "")
    parsed_host = urlparse("//" + host_header)
    if parsed_host.hostname not in ("localhost", "127.0.0.1"):
        return False
    if handler.headers.get("X-Requested-With") != "HealthDashboard":
        return False
    origin = handler.headers.get("Origin")
    if origin:
        parsed_origin = urlparse(origin)
        if parsed_origin.hostname not in ("localhost", "127.0.0.1"):
            return False
        if parsed_origin.netloc.lower() != host_header.lower():
            return False
    return True


_payload_lock = threading.Lock()
_payload_cache = {}          # days -> {"key": ..., "at": monotonic seconds, "body": bytes, "etag": str}
PAYLOAD_MAX_AGE = 120        # seconds; the rolling 24-hour windows still slide when nothing was written


def _payload_invalidate():
    """Drop cached dashboard payloads after an explicit local data mutation."""
    with _payload_lock:
        _payload_cache.clear()


def _db_stamp():
    """Cheap fingerprint of the database files: changes whenever anything is committed."""
    parts = []
    for suffix in ("", "-wal"):
        try:
            st = os.stat(gh.DB_PATH + suffix)
            parts.append((st.st_mtime_ns, st.st_size))
        except OSError:
            parts.append(None)
    return tuple(parts)


def payload_bytes(days):
    """Serve cached data through an in-progress sync and rebuild once it completes."""
    now = time.monotonic()
    syncing = bool(sync_state.get("running"))
    ent = _payload_cache.get(days)
    # WAL timestamps change for every batch commit; keep the last committed view while syncing.
    if ent and syncing:
        return ent
    key = (_db_stamp(), dt.date.today().isoformat(), syncing, DEMO)
    if ent and ent["key"] == key and now - ent["at"] < PAYLOAD_MAX_AGE:
        return ent
    with _payload_lock:
        now = time.monotonic()
        syncing = bool(sync_state.get("running"))
        ent = _payload_cache.get(days)
        if ent and syncing:
            return ent
        key = (_db_stamp(), dt.date.today().isoformat(), syncing, DEMO)
        if ent and ent["key"] == key and now - ent["at"] < PAYLOAD_MAX_AGE:
            return ent
        body = json.dumps(payload(days), separators=(",", ":")).encode()
        ent = {"key": key, "at": time.monotonic(), "body": body,
               "etag": '"' + hashlib.md5(body).hexdigest() + '"'}
        _payload_cache[days] = ent
        if len(_payload_cache) > 8:
            for k in sorted(_payload_cache, key=lambda d: _payload_cache[d]["at"])[:-8]:
                _payload_cache.pop(k, None)
        return ent


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json", extra_headers=None):
        b = body if isinstance(body, bytes) else json.dumps(body, separators=(",", ":")).encode()
        headers = {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
        }
        headers.update(extra_headers or {})
        if len(b) > 1024:
            headers["Vary"] = "Accept-Encoding"
            gzip_quality = 0.0
            for encoding in self.headers.get("Accept-Encoding", "").lower().split(","):
                parts = [part.strip() for part in encoding.split(";")]
                if parts[0] == "gzip":
                    try:
                        gzip_quality = float(next((part[2:] for part in parts[1:] if part.startswith("q=")), "1"))
                    except ValueError:
                        gzip_quality = 0.0
                    break
            if gzip_quality > 0:
                compressed = gzip.compress(b, compresslevel=5)
                if len(compressed) < len(b):
                    b = compressed
                    headers["Content-Encoding"] = "gzip"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(b)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # Browsers may close a request during refresh/navigation; this is not
            # a server failure and should not print a traceback.
            return
    def do_GET(self):
        path = urlparse(self.path).path
        db_paths = {"/api/data", "/api/workout-hr", "/api/hr-day", "/api/diagnostics", "/api/device-health"}
        if path not in db_paths:
            return self._do_GET_impl()
        with optimize_state_guard:
            optimizing = bool(optimize_state.get("running"))
        if optimizing:
            self.send(503, {"error": "Database maintenance is running; retry shortly."},
                      extra_headers={"Retry-After": "3"})
            return
        with db_read_lock:
            with optimize_state_guard:
                optimizing = bool(optimize_state.get("running"))
            if optimizing:
                self.send(503, {"error": "Database maintenance is running; retry shortly."},
                          extra_headers={"Retry-After": "3"})
                return
            return self._do_GET_impl()

    def _do_GET_impl(self):
        u = urlparse(self.path)
        if u.path in ("/oauth/start", "/oauth/callback"):
            host = urlparse("//" + self.headers.get("Host", ""))
            remote = self.client_address[0]
            if host.hostname not in ("localhost", "127.0.0.1") or host.port != PORT or remote not in ("127.0.0.1", "::1"):
                self.send(403, {"error": "OAuth callbacks are available only through this computer's local dashboard."})
                return
            redirect = f"http://localhost:{PORT}/oauth/callback"
            if u.path == "/oauth/start":
                if DEMO:
                    self.send(400, {"error": "Google sign-in is disabled in demo mode."})
                    return
                state = secrets.token_urlsafe(32)
                now = time.time()
                with oauth_state_lock:
                    for key in [k for k, value in oauth_states.items() if now - value > OAUTH_STATE_TTL]:
                        oauth_states.pop(key, None)
                    oauth_states[state] = now
                try:
                    target = gh.oauth_authorize_url(redirect, state)
                except Exception as ex:
                    with oauth_state_lock:
                        oauth_states.pop(state, None)
                    msg = html.escape(str(ex))
                    body = f"<!doctype html><meta charset='utf-8'><title>Google connection setup</title><style>body{{font:16px system-ui;background:#0b1118;color:#e7edf5;margin:12vh auto;max-width:650px;padding:24px}}code{{color:#5eead4;overflow-wrap:anywhere}}a{{color:#67e8f9}}</style><h1>One-time Google OAuth setup</h1><p>{msg}</p><p>After the dashboard owner adds this redirect URI in Google Cloud and supplies the same private client file to this local install, select Connect Google again.</p><p><a href='/'>Return to dashboard</a></p>".encode()
                    self.send(400, body, "text/html; charset=utf-8")
                    return
                self.send(302, b"", extra_headers={"Location": target})
                return

            query = parse_qs(u.query)
            state = query.get("state", [""])[0]
            with oauth_state_lock:
                issued = oauth_states.pop(state, None) if state else None
            if issued is None or time.time() - issued > OAUTH_STATE_TTL:
                self.send(400, b"<!doctype html><meta charset='utf-8'><h2>Sign-in expired</h2><p>Return to your dashboard and try Connect Google again.</p>", "text/html; charset=utf-8")
                return
            if query.get("error"):
                self.send(400, b"<!doctype html><meta charset='utf-8'><h2>Google sign-in was cancelled</h2><p>Return to your dashboard to try again.</p><p><a href='/'>Dashboard</a></p>", "text/html; charset=utf-8")
                return
            code = query.get("code", [""])[0]
            if not code:
                self.send(400, b"<!doctype html><meta charset='utf-8'><h2>Google did not return an authorization code</h2><p><a href='/'>Return to dashboard</a></p>", "text/html; charset=utf-8")
                return
            try:
                gh.finish_oauth(code, redirect)
                self.send(200, b"<!doctype html><meta charset='utf-8'><meta http-equiv='refresh' content='2;url=/'><title>Google connected</title><style>body{font:16px system-ui;background:#0b1118;color:#e7edf5;margin:12vh auto;max-width:560px;padding:24px}.ok{color:#5eead4}</style><h1 class='ok'>Google Health connected</h1><p>This account's OAuth token is saved on this computer. The dashboard is returning to sync its data.</p><p><a href='/'>Continue to dashboard</a></p>", "text/html; charset=utf-8")
                threading.Thread(target=run_sync, daemon=True, name="oauth-initial-sync").start()
            except Exception as ex:
                safe = html.escape(str(ex)[:500])
                body = f"<!doctype html><meta charset='utf-8'><title>Google sign-in failed</title><style>body{{font:16px system-ui;background:#0b1118;color:#e7edf5;margin:12vh auto;max-width:650px;padding:24px}}a{{color:#67e8f9}}</style><h1>Could not finish Google sign-in</h1><p>{safe}</p><p><a href='/'>Return to dashboard</a></p>".encode()
                self.send(400, body, "text/html; charset=utf-8")
            return
        if u.path == "/api/device-health":
            try:
                days = max(7, min(365, int(parse_qs(u.query).get("days", ["90"])[0])))
            except ValueError:
                self.send(400, {"error": "days must be an integer"})
                return
            con = gh.db()
            try:
                self.send(200, gh.device_health_data(con, days))
            except Exception as ex:
                self.send(500, {"error": f"Device health data failed: {str(ex)[:220]}"})
            finally:
                con.close()
        elif u.path.startswith(("/css/", "/js/")):
            # Static assets split out of index.html (css/*.css, js/*.js).
            ext = os.path.splitext(u.path)[1].lower()
            ctype = {".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8"}.get(ext)
            root = os.path.realpath(BUNDLE_DIR)
            full = os.path.realpath(os.path.join(root, u.path.lstrip("/")))
            if not ctype or not full.startswith(os.path.join(root, "")) or not os.path.isfile(full):
                self.send(404, {"error": "Not found"})
                return
            with open(full, "rb") as f:
                self.send(200, f.read(), ctype)
        elif u.path == "/":
            global FIRST_PAGE_SERVED
            started = time.perf_counter()
            with open(os.path.join(BUNDLE_DIR, "index.html"), "rb") as f:
                content = f.read()
            if FROZEN_APP:
                content = content.replace(
                    b"<head>",
                    b"<head><script>window.__HEALTH_DASHBOARD_STANDALONE__=true;</script>", 1)
            self.send(200, content, "text/html; charset=utf-8")
            if not FIRST_PAGE_SERVED:
                FIRST_PAGE_SERVED = True
                print(f"First page served in {time.perf_counter() - started:.3f}s.", flush=True)
        elif u.path == "/api/workout-hr":
            workout_id = parse_qs(u.query).get("id", [""])[0]
            if not workout_id:
                self.send(400, {"error": "workout id is required"})
                return
            con = gh.db()
            try:
                row = con.execute("SELECT start, end FROM exercise WHERE id=?", (workout_id,)).fetchone()
                if row is None:
                    self.send(404, {"error": "workout not found"})
                    return
                start_dt = dt.datetime.fromisoformat(str(row["start"]).replace("Z", "+00:00"))
                end_dt = dt.datetime.fromisoformat(str(row["end"]).replace("Z", "+00:00"))
                start_ts = int(start_dt.timestamp())
                end_ts = int(end_dt.timestamp()) + 10 * 60
                samples = [[ts * 1000, float(bpm)] for ts, bpm in _tuples(
                    con, "SELECT ts,bpm FROM hr_raw WHERE ts >= ? AND ts <= ? ORDER BY ts LIMIT 100000",
                    (start_ts, end_ts)) if ts is not None and bpm is not None]
                self.send(200, {
                    "id": workout_id,
                    "samples": samples,
                    "count": len(samples),
                    "start_ms": start_ts * 1000,
                    "end_ms": (end_ts - 10 * 60) * 1000,
                    "window_end_ms": end_ts * 1000,
                })
            except Exception as ex:
                self.send(500, {"error": f"workout HR query failed: {str(ex)[:200]}"})
            finally:
                con.close()
        elif u.path == "/api/workout-route":
            workout_id = parse_qs(u.query).get("id", [""])[0]
            if not workout_id:
                self.send(400, {"error": "workout id is required"})
                return
            con = gh.db()
            try:
                row = con.execute("SELECT raw FROM exercise WHERE id=?", (workout_id,)).fetchone()
                if row is None:
                    self.send(404, {"error": "workout not found"})
                    return
                exercise = json.loads(row["raw"] or "{}")
                metadata = exercise.get("exerciseMetadata") or {}
                if not metadata.get("hasGps"):
                    self.send(404, {"error": "This workout has no GPS route."})
                    return
                tcx = gh.export_exercise_tcx(workout_id)
                root = ET.fromstring(tcx)
                points = []
                for node in root.iter():
                    if node.tag.rsplit("}", 1)[-1] != "Trackpoint":
                        continue
                    values = {child.tag.rsplit("}", 1)[-1]: (child.text or "").strip()
                              for child in node.iter() if child is not node}
                    try:
                        position = next(child for child in node.iter()
                                        if child.tag.rsplit("}", 1)[-1] == "Position")
                        coords = {child.tag.rsplit("}", 1)[-1]: (child.text or "").strip()
                                  for child in position}
                        lat, lon = float(coords["LatitudeDegrees"]), float(coords["LongitudeDegrees"])
                        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                            continue
                        points.append({"lat": lat, "lon": lon,
                                       "altitude": float(values["AltitudeMeters"]) if values.get("AltitudeMeters") else None,
                                       "time": values.get("Time")})
                    except (KeyError, StopIteration, ValueError):
                        continue
                if not points:
                    self.send(404, {"error": "The exported route contained no usable GPS points."})
                    return
                self.send(200, {"points": points, "count": len(points)})
            except Exception as ex:
                self.send(502, {"error": f"Could not load GPS route: {str(ex)[:240]}"})
            finally:
                con.close()
        elif u.path == "/api/hr-day":
            date_text = parse_qs(u.query).get("date", [""])[0]
            try:
                day = dt.date.fromisoformat(date_text)
                start_local = dt.datetime.combine(day, dt.time.min).astimezone().timestamp()
                end_local = dt.datetime.combine(day + dt.timedelta(days=1), dt.time.min).astimezone().timestamp()
                con = gh.db()
                try:
                    samples = _tuples(con, "SELECT ts,bpm FROM hr_raw WHERE ts>=? AND ts<? ORDER BY ts LIMIT 100000",
                                      (int(start_local), int(end_local))).fetchall()
                    if len(samples) < 10 and gh._has_table(con, "hr"):
                        legacy = _tuples(con, "SELECT ts,bpm FROM hr WHERE ts>=? AND ts<? ORDER BY ts LIMIT 100000",
                                         (day.isoformat() + "T00:00:00", (day + dt.timedelta(days=1)).isoformat() + "T00:00:00")).fetchall()
                        if legacy:
                            samples = sorted((int(dt.datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()), int(bpm))
                                             for ts, bpm in legacy)
                    result = _bucket_5m_ms(samples)
                    self.send(200, {"date": date_text, "samples": result, "count": len(result)})
                finally:
                    con.close()
            except ValueError:
                self.send(400, {"error": "date must be YYYY-MM-DD"})
            except Exception as ex:
                self.send(500, {"error": f"heart-rate day query failed: {str(ex)[:200]}"})
        elif u.path == "/api/data":
            try:
                days = max(7, min(3650, int(parse_qs(u.query).get("days", ["30"])[0])))
            except ValueError:
                self.send(400, {"error": "days must be an integer"})
                return
            try:
                ent = payload_bytes(days)
            except Exception as ex:
                print(f"[payload request] {type(ex).__name__}: {ex}", file=sys.stderr, flush=True)
                self.send(500, {"error": f"Dashboard data failed to load: {type(ex).__name__}: {str(ex)[:250]}"})
                return
            if self.headers.get("If-None-Match") == ent["etag"]:
                self.send_response(304)
                self.send_header("ETag", ent["etag"])
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                return
            self.send(200, ent["body"], extra_headers={"ETag": ent["etag"], "Cache-Control": "no-cache"})
        elif u.path == "/api/diagnostics":
            try:
                from db_diagnostics import summary as diagnostics_summary
                self.send(200, diagnostics_summary(gh.DB_PATH))
            except FileNotFoundError as ex:
                self.send(404, {"error": str(ex)})
            except Exception as ex:
                self.send(500, {"error": f"Database diagnostics failed: {str(ex)[:250]}"})
        elif u.path == "/api/database/optimize/status":
            with optimize_state_guard:
                state = dict(optimize_state)
            # Avoid sending the complete diagnostics object on every progress poll.
            if state.get("result") and isinstance(state["result"], dict):
                state["result"] = {k: v for k, v in state["result"].items() if k != "diagnostics"}
            self.send(200, state)
        elif u.path == "/api/status":
            started = sync_state.get("started_mono")
            elapsed = max(0.0, time.perf_counter() - started) if started is not None else None
            self.send(200, {"syncing": bool(sync_state.get("running")), "signed_in": bool(gh.have_token()),
                            "elapsed_seconds": round(elapsed, 1) if elapsed is not None else None,
                            "last_elapsed_seconds": sync_state.get("last_elapsed_seconds")})
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/sync":
            if not _local_same_origin_request(self):
                self.send(403, {"error": "Cross-origin request rejected."})
                return
            threading.Thread(target=run_sync, daemon=True).start()
            self.send(202, {"started": True})
        elif path == "/api/sleep-score-snapshot":
            if not _local_same_origin_request(self):
                self.send(403, {"error": "Sleep score snapshot rejected: use the local dashboard."})
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length < 1 or length > 12000:
                self.send(400, {"error": "A valid sleep score snapshot is required."})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                sleep_id = str(body.get("id", "")).strip()
                snap = body.get("snapshot")
                score = float(snap.get("score"))
                coverage = int(snap.get("coverage"))
                if not sleep_id or len(sleep_id) > 512 or not isinstance(snap, dict) or not (0 <= score <= 100) or not (1 <= coverage <= 5):
                    raise ValueError("Invalid score snapshot fields.")
            except Exception as ex:
                self.send(400, {"error": str(ex)[:200]})
                return
            con = gh.db()
            try:
                exists = con.execute("SELECT 1 FROM sleep WHERE id=? AND main=1 AND COALESCE(nap,0)=0", (sleep_id,)).fetchone()
                if not exists:
                    self.send(404, {"error": "Main sleep session not found."})
                    return
                scored_at = dt.datetime.now().astimezone().isoformat(timespec="seconds")
                con.execute("INSERT OR IGNORE INTO sleep_score_snapshots(sleep_id,score,coverage,detail,scored_at,algorithm) VALUES(?,?,?,?,?,?)",
                            (sleep_id, score, coverage, json.dumps(snap, separators=(",", ":")), scored_at, "dashboard-sleep-v2"))
                con.commit()
                _payload_invalidate()
                self.send(200, {"saved": True, "id": sleep_id})
            except Exception as ex:
                self.send(500, {"error": f"Could not freeze sleep score: {str(ex)[:200]}"})
            finally:
                con.close()
        elif path == "/api/sleep-score-snapshots":
            if not _local_same_origin_request(self):
                self.send(403, {"error": "Sleep score snapshots rejected: use the local dashboard."})
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length < 1 or length > 512000:
                self.send(400, {"error": "A valid batch of sleep score snapshots is required."})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                snapshots = body.get("snapshots")
                if not isinstance(snapshots, list) or not snapshots or len(snapshots) > 40:
                    raise ValueError("Provide between 1 and 40 sleep score snapshots.")
                rows = []
                seen = set()
                scored_at = dt.datetime.now().astimezone().isoformat(timespec="seconds")
                for item in snapshots:
                    sleep_id = str(item.get("id", "")).strip()
                    snap = item.get("snapshot")
                    score = float(snap.get("score"))
                    coverage = int(snap.get("coverage"))
                    if (not sleep_id or len(sleep_id) > 512 or sleep_id in seen or not isinstance(snap, dict)
                            or not (0 <= score <= 100) or not (1 <= coverage <= 5)):
                        raise ValueError("Invalid score snapshot fields.")
                    seen.add(sleep_id)
                    rows.append((sleep_id, score, coverage, json.dumps(snap, separators=(",", ":")),
                                 scored_at, "dashboard-sleep-v2"))
            except Exception as ex:
                self.send(400, {"error": str(ex)[:200]})
                return
            con = gh.db()
            try:
                placeholders = ",".join("?" for _ in seen)
                existing = {row[0] for row in con.execute(
                    f"SELECT id FROM sleep WHERE main=1 AND COALESCE(nap,0)=0 AND id IN ({placeholders})",
                    tuple(seen))}
                accepted = [row for row in rows if row[0] in existing]
                con.executemany(
                    "INSERT OR IGNORE INTO sleep_score_snapshots(sleep_id,score,coverage,detail,scored_at,algorithm) VALUES(?,?,?,?,?,?)",
                    accepted)
                con.commit()
                _payload_invalidate()
                self.send(200, {"saved": True, "count": len(accepted), "ids": [row[0] for row in accepted]})
            except Exception as ex:
                con.rollback()
                self.send(500, {"error": f"Could not freeze sleep scores: {str(ex)[:200]}"})
            finally:
                con.close()
        elif path == "/api/workout-exclusion":
            if not _local_same_origin_request(self):
                self.send(403, {"error": "Workout update rejected: use the local dashboard."})
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length < 1 or length > 4096:
                self.send(400, {"error": "A small JSON workout update is required."})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                workout_id = str(body.get("id", "")).strip()
                excluded = body.get("excluded")
                if not workout_id or len(workout_id) > 512 or not isinstance(excluded, bool):
                    raise ValueError("A workout id and excluded true/false value are required.")
            except Exception as ex:
                self.send(400, {"error": str(ex)[:200]})
                return
            con = gh.db()
            try:
                exists = con.execute("SELECT 1 FROM exercise WHERE id=?", (workout_id,)).fetchone()
                if not exists:
                    self.send(404, {"error": "Workout not found."})
                    return
                if excluded:
                    con.execute("INSERT OR REPLACE INTO exercise_exclusions(id,excluded_at) VALUES(?,?)",
                                (workout_id, dt.datetime.now().astimezone().isoformat(timespec="seconds")))
                else:
                    con.execute("DELETE FROM exercise_exclusions WHERE id=?", (workout_id,))
                con.commit()
                _payload_invalidate()
                _trend_invalidate()
                self.send(200, {"saved": True, "id": workout_id, "excluded": excluded})
            except Exception as ex:
                self.send(500, {"error": f"Could not update workout: {str(ex)[:200]}"})
            finally:
                con.close()
        elif path == "/api/database/optimize":
            if DEMO:
                self.send(403, {"error": "Database optimization is disabled in demo mode."})
                return
            if not _local_same_origin_request(self):
                self.send(403, {"error": "Optimization request rejected: use the Data quality button on this local dashboard."})
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            if length < 1 or length > 4096:
                self.send(400, {"error": "A small JSON confirmation body is required."})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception:
                self.send(400, {"error": "Invalid JSON request."})
                return
            if not isinstance(body, dict) or body.get("confirmed") is not True:
                self.send(400, {"error": "Explicit confirmation is required."})
                return
            with optimize_state_guard:
                if optimize_state.get("running"):
                    self.send(409, {"error": "Database optimization is already running."})
                    return
                if not sync_lock.acquire(blocking=False):
                    self.send(409, {"error": "A sync is running. Wait for it to finish, then optimize."})
                    return
                optimize_state.update({"running": True, "stage": "starting", "started_at": time.time(),
                                       "finished_at": None, "result": None, "error": None, "log": []})
            try:
                threading.Thread(target=_run_database_optimization, daemon=True).start()
            except Exception as ex:
                sync_lock.release()
                with optimize_state_guard:
                    optimize_state.update({"running": False, "stage": "failed", "error": str(ex)[:500]})
                self.send(500, {"error": "Could not start database optimization."})
                return
            self.send(202, {"started": True, "message": "Database optimization queued."})
        elif path == "/api/settings":
            if not _local_same_origin_request(self):
                self.send(403, {"error": "Cross-origin request rejected."})
                return
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n).decode() if n else "{}"
            try:
                settings = json.loads(body)
            except Exception as ex:
                self.send(400, {"error": f"bad JSON: {ex}"})
                return
            con = gh.db()
            age_changed = "age" in settings and settings.get("age") is not None
            for k, v in settings.items():
                if k not in SETTING_KEYS:
                    continue
                gh.set_meta(con, f"setting_{k}", json.dumps(v))
            con.commit()
            # Rebuild locally derived Karvonen zones when age changes, if the
            # installed gh.py exposes the documented rebuild function.
            zone_rebuilt = False
            zone_rebuild_error = None
            if age_changed and callable(getattr(gh, "rebuild_zone_time", None)):
                try:
                    gh.rebuild_zone_time(con)
                    con.commit()
                    zone_rebuilt = True
                except Exception as ex:
                    zone_rebuild_error = str(ex)[:250]
            con.close()
            _payload_invalidate()
            _trend_invalidate()
            response = {"saved": True, "keys": list(settings.keys()), "zone_rebuilt": zone_rebuilt}
            if zone_rebuild_error:
                response["zone_rebuild_warning"] = zone_rebuild_error
            self.send(200, response)
        else:
            self.send(404, {"error": "not found"})


if __name__ == "__main__":
    preferred_port = PORT
    candidates = [preferred_port]
    if FROZEN_APP:
        candidates.extend(port for port in (8082, 8083) if port not in candidates)
    srv = None
    last_bind_error = None
    for candidate_port in candidates:
        try:
            server_class = ExclusiveThreadingHTTPServer if FROZEN_APP else ThreadingHTTPServer
            srv = server_class(("127.0.0.1", candidate_port), Handler)
            PORT = candidate_port
            break
        except OSError as ex:
            address_in_use = getattr(ex, "winerror", None) == 10048 or ex.errno == 10048
            if not FROZEN_APP or not address_in_use:
                raise
            last_bind_error = ex
    if srv is None:
        raise last_bind_error
    if PORT != preferred_port:
        print(f"Port {preferred_port} is already in use; using port {PORT} instead.", flush=True)
    if not DEMO:
        threading.Thread(target=loop, daemon=True, name="health-sync").start()
        threading.Thread(target=database_maintenance_loop, daemon=True, name="health-db-maintenance").start()
    print(f"Dashboard{' (demo data)' if DEMO else ''}: http://localhost:{PORT}", flush=True)
    if FROZEN_APP and os.environ.get("HEALTH_NO_BROWSER") != "1":
        browser_timer = threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{PORT}"))
        browser_timer.daemon = True
        browser_timer.start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
