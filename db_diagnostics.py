"""Read-only SQLite health-dashboard diagnostics.

Usage:
    python db_diagnostics.py
    set HEALTH_DB=C:\\path\\to\\health.db  (Windows CMD, before running)

This tool does not create, update, migrate, or compact the database.
"""
import os
import json
import sqlite3
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("HEALTH_DATA_DIR") or HERE
DB_PATH = os.environ.get("HEALTH_DB") or os.path.join(DATA_DIR, "health.db")


def qident(name):
    return '"' + name.replace('"', '""') + '"'


def open_readonly(path):
    uri = "file:" + quote(os.path.abspath(path).replace("\\", "/"), safe="/:") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def exists(con, typ, name):
    return con.execute("SELECT 1 FROM sqlite_master WHERE type=? AND name=?", (typ, name)).fetchone() is not None


def summary(db_path=None):
    """Return a compact read-only JSON-safe storage report for the local UI/API."""
    path = db_path or DB_PATH
    if not os.path.exists(path):
        raise FileNotFoundError(f"Database not found: {os.path.abspath(path)}")
    con = open_readonly(path)
    try:
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        page_size = int(con.execute("PRAGMA page_size").fetchone()[0])
        page_count = int(con.execute("PRAGMA page_count").fetchone()[0])
        free_pages = int(con.execute("PRAGMA freelist_count").fetchone()[0])
        tables = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        try:
            object_sizes = {r[0]: int(r[1] or 0) for r in con.execute(
                "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name")}
            size_available = True
        except sqlite3.DatabaseError:
            object_sizes, size_available = {}, False
        # Include table-owned indexes, including internal primary-key indexes, in the table total.
        objects = list(con.execute("SELECT type,name,tbl_name FROM sqlite_master WHERE type IN ('table','index')"))
        owner = {r['name']: r['tbl_name'] if r['type'] == 'index' else r['name'] for r in objects}
        size_by_table = {t: object_sizes.get(t, 0) for t in tables}
        for obj, bytes_used in object_sizes.items():
            table = owner.get(obj)
            if table in size_by_table and obj != table:
                size_by_table[table] += bytes_used
        table_rows = []
        for table in tables:
            try:
                count = int(con.execute(f"SELECT COUNT(*) FROM {qident(table)}").fetchone()[0])
            except sqlite3.DatabaseError:
                count = -1
            table_rows.append({"name": table, "rows": count, "size_bytes": size_by_table.get(table, 0)})
        indexes = []
        for r in con.execute("SELECT name,tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name,name"):
            indexes.append({"name": r['name'], "table": r['tbl_name'], "size_bytes": object_sizes.get(r['name'], 0),
                            "redundant": r['name'] == 'hr_raw_ts' and exists(con, 'table', 'hr_raw')})

        legacy = None
        if exists(con, 'table', 'hr') and exists(con, 'table', 'hr_raw'):
            total = int(con.execute("SELECT COUNT(*) FROM hr").fetchone()[0])
            invalid = int(con.execute(
                "SELECT COUNT(*) FROM hr WHERE ts IS NULL OR bpm IS NULL OR CAST(bpm AS INTEGER)<=0 "
                "OR strftime('%s',ts) IS NULL").fetchone()[0])
            missing = int(con.execute(
                "SELECT COUNT(*) FROM hr h LEFT JOIN hr_raw r "
                "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) "
                "WHERE h.ts IS NOT NULL AND h.bpm IS NOT NULL AND CAST(h.bpm AS INTEGER)>0 "
                "AND strftime('%s',h.ts) IS NOT NULL AND r.ts IS NULL").fetchone()[0])
            conflicts = int(con.execute(
                "SELECT COUNT(*) FROM hr h JOIN hr_raw r "
                "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) "
                "WHERE CAST(h.bpm AS INTEGER)!=r.bpm AND strftime('%s',h.ts) IS NOT NULL").fetchone()[0])
            legacy = {"rows": total, "invalid": invalid, "missing": missing, "conflicts": conflicts,
                      "safe_to_drop": invalid == 0 and conflicts == 0}
        sleep_hr_rows = int(con.execute("SELECT COUNT(*) FROM sleep_hr").fetchone()[0]) if exists(con, 'table', 'sleep_hr') else 0
        hr_raw_rows = int(con.execute("SELECT COUNT(*) FROM hr_raw").fetchone()[0]) if exists(con, 'table', 'hr_raw') else 0
        growth = {"available": False, "snapshots": 0}
        if exists(con, 'table', 'meta'):
            row = con.execute("SELECT v FROM meta WHERE k='db_growth_daily'").fetchone()
            if row:
                try:
                    samples = json.loads(row[0])
                    if len(samples) >= 2:
                        first, last = samples[0], samples[-1]
                        from datetime import date
                        span_days = max(1, (date.fromisoformat(last['day']) - date.fromisoformat(first['day'])).days)
                        growth = {
                            "available": True,
                            "snapshots": len(samples),
                            "tracking_days": span_days,
                            "avg_records_per_day": round((int(last['rows']) - int(first['rows'])) / span_days, 1),
                            "avg_bytes_per_day": round((int(last['bytes']) - int(first['bytes'])) / span_days),
                            "last_snapshot_day": last['day'],
                        }
                    elif samples:
                        growth = {"available": False, "snapshots": len(samples), "last_snapshot_day": samples[-1].get('day')}
                except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                    growth = {"available": False, "snapshots": 0}
        return {
            "path": os.path.abspath(path),
            "file_size_bytes": int(os.path.getsize(path)),
            "sqlite_version": sqlite3.sqlite_version,
            "integrity": integrity,
            "journal_mode": con.execute("PRAGMA journal_mode").fetchone()[0],
            "page_size": page_size, "page_count": page_count, "free_pages": free_pages,
            "unused_bytes_estimate": page_size * free_pages,
            "table_size_available": size_available,
            "daily_growth": growth,
            "tables": table_rows, "indexes": indexes,
            "hr_raw_rows": hr_raw_rows, "sleep_hr_rows": sleep_hr_rows,
            "legacy_hr": legacy,
            "redundant_hr_raw_index": any(x['name'] == 'hr_raw_ts' for x in indexes),
        }
    finally:
        con.close()


def main(db_path=None):
    path = db_path or DB_PATH
    if not os.path.exists(path):
        raise SystemExit(f"Database not found: {os.path.abspath(path)}")
    con = open_readonly(path)
    try:
        print("HEALTH DASHBOARD DATABASE REPORT (READ ONLY)")
        print("=" * 56)
        print("Path:", os.path.abspath(path))
        size = os.path.getsize(path)
        print(f"File size: {size:,} bytes ({size / (1024 * 1024):.2f} MiB)")
        print("SQLite version:", sqlite3.sqlite_version)
        print("Integrity check:", con.execute("PRAGMA integrity_check").fetchone()[0])
        print("Journal mode:", con.execute("PRAGMA journal_mode").fetchone()[0])
        print("Page size:", con.execute("PRAGMA page_size").fetchone()[0])
        print("Page count:", con.execute("PRAGMA page_count").fetchone()[0])
        print("Free pages:", con.execute("PRAGMA freelist_count").fetchone()[0])

        tables = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        print("\nTABLE ROW COUNTS")
        print("-" * 56)
        for table in tables:
            count = con.execute(f"SELECT COUNT(*) FROM {qident(table)}").fetchone()[0]
            print(f"{table:<20} {count:>12,}")

        print("\nSCHEMA (tables and indexes)")
        print("-" * 56)
        for r in con.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master "
            "WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, tbl_name,name"):
            print(f"[{r['type']}] {r['name']} (table={r['tbl_name']})")
            if r['sql']:
                print("  " + r['sql'].replace("\n", " "))

        print("\nSYNC METADATA")
        print("-" * 56)
        if exists(con, "table", "meta"):
            wanted = ("schema_v", "last_sync", "last_sync_seconds", "last_sync_timings",
                      "full_resync_pending", "errors")
            for key in wanted:
                row = con.execute("SELECT v FROM meta WHERE k=?", (key,)).fetchone()
                if row:
                    value = row[0]
                    if key == "last_sync_timings" and len(value) > 300:
                        value = value[:300] + "..."
                    print(f"{key}: {value}")

        print("\nLEGACY / DUPLICATE CHECKS")
        print("-" * 56)
        if exists(con, "table", "hr") and exists(con, "table", "hr_raw"):
            total = con.execute("SELECT COUNT(*) FROM hr").fetchone()[0]
            invalid = con.execute(
                "SELECT COUNT(*) FROM hr WHERE ts IS NULL OR bpm IS NULL OR CAST(bpm AS INTEGER)<=0 "
                "OR strftime('%s',ts) IS NULL").fetchone()[0]
            if invalid == 0:
                same = con.execute(
                    "SELECT COUNT(*) FROM hr h JOIN hr_raw r "
                    "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) WHERE h.bpm IS NOT NULL "
                    "AND CAST(h.bpm AS INTEGER)>0 AND r.bpm=CAST(h.bpm AS INTEGER) "
                    "AND strftime('%s',h.ts) IS NOT NULL").fetchone()[0]
                missing = con.execute(
                    "SELECT COUNT(*) FROM hr h LEFT JOIN hr_raw r "
                    "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) WHERE r.ts IS NULL").fetchone()[0]
                conflicts = con.execute(
                    "SELECT COUNT(*) FROM hr h JOIN hr_raw r "
                    "ON r.ts=CAST(strftime('%s',h.ts) AS INTEGER) WHERE h.bpm IS NOT NULL "
                    "AND CAST(h.bpm AS INTEGER)>0 AND r.bpm!=CAST(h.bpm AS INTEGER) "
                    "AND strftime('%s',h.ts) IS NOT NULL").fetchone()[0]
                print(f"Legacy hr rows: {total:,}")
                print(f"Exact matches in hr_raw: {same:,}")
                print(f"Missing timestamps in hr_raw: {missing:,}")
                print(f"Conflicting BPM values: {conflicts:,}")
            else:
                print(f"Legacy hr rows: {total:,}; invalid rows that need review: {invalid:,}")
        else:
            print("Legacy hr table is absent, or hr_raw is absent.")

        if exists(con, "table", "sleep_hr") and exists(con, "table", "hr_raw"):
            total = con.execute("SELECT COUNT(*) FROM sleep_hr").fetchone()[0]
            not_same = con.execute(
                "SELECT COUNT(*) FROM sleep_hr s LEFT JOIN hr_raw r "
                "ON r.ts=s.ts AND r.bpm=s.bpm WHERE r.ts IS NULL").fetchone()[0]
            print(f"sleep_hr rows not exact timestamp+BPM matches in hr_raw: {not_same:,} / {total:,}")
            print("Keep sleep_hr unless a separate verified migration preserves its differing values.")

        if exists(con, "index", "hr_raw_ts"):
            print("Redundant index present: hr_raw_ts on hr_raw(ts)")
        else:
            print("Redundant index hr_raw_ts: absent")

        try:
            # dbstat is a read-only SQLite virtual table on standard SQLite builds.
            print("\nESTIMATED STORAGE BY TABLE / INDEX")
            print("-" * 56)
            for r in con.execute(
                "SELECT name, SUM(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC"):
                print(f"{r['name']:<24} {r['bytes'] / (1024 * 1024):>8.2f} MiB")
        except sqlite3.DatabaseError:
            print("Per-object size unavailable (SQLite dbstat support is not enabled).")

        print("\nNo changes made.")
    finally:
        con.close()


if __name__ == "__main__":
    main()
