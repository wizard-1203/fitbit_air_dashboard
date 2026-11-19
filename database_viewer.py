"""Read-only SQLite database viewer with a Tkinter GUI.

Usage:
    python db_viewer.py
    python db_viewer.py path/to/file.db
"""

import csv
import os
import sqlite3
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from urllib.parse import quote

PAGE_SIZE = 500
MAX_CELL_CHARS = 200
QUERY_ROW_LIMIT = 5000


def qident(name):
    return '"' + name.replace('"', '""') + '"'


def open_readonly(path):
    uri = "file:" + quote(os.path.abspath(path).replace("\\", "/"), safe="/:") + "?mode=ro"
    con = sqlite3.connect(uri, uri=True, timeout=10)
    con.row_factory = sqlite3.Row
    return con


class DBViewer:
    def __init__(self, root, path=None):
        self.root = root
        self.con = None
        self.db_path = None
        self.current_obj = None
        self.current_kind = None
        self.page = 0
        self.total_rows = 0
        self.sort_col = None
        self.sort_desc = False
        self.columns = []
        self.filter_text = ""
        self.page_size = PAGE_SIZE

        root.title("SQLite DB Viewer")
        root.geometry("1150x720")

        self._build_menu()
        self._build_ui()

        if path:
            self.open_db(path)
        else:
            root.after(100, self._pick_file)

    # ---------------- menu / layout ----------------

    def _build_menu(self):
        m = tk.Menu(self.root)
        f = tk.Menu(m, tearoff=0)
        f.add_command(label="Open...", command=self._pick_file, accelerator="Ctrl+O")
        f.add_command(label="Refresh", command=self.refresh, accelerator="F5")
        f.add_command(label="Export current view to CSV...", command=self._export_csv)
        f.add_separator()
        f.add_command(label="Quit", command=self.root.quit)
        m.add_cascade(label="File", menu=f)
        self.root.config(menu=m)
        self.root.bind("<Control-o>", lambda e: self._pick_file())
        self.root.bind("<F5>", lambda e: self.refresh())
        self.root.bind("<Control-r>", lambda e: self.refresh())

    def _build_ui(self):
        toolbar = ttk.Frame(self.root, padding=4)
        toolbar.pack(side=tk.TOP, fill=tk.X)
        ttk.Button(toolbar, text="Open...", command=self._pick_file).pack(side=tk.LEFT)
        self.path_label = ttk.Label(toolbar, text="(no database)")
        self.path_label.pack(side=tk.LEFT, padx=8)
        ttk.Button(toolbar, text="Export CSV", command=self._export_csv).pack(side=tk.RIGHT, padx=4)
        ttk.Button(toolbar, text="Refresh", command=self.refresh).pack(side=tk.RIGHT)

        main = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        main.pack(fill=tk.BOTH, expand=True)

        left = ttk.Frame(main, width=240)
        left.pack_propagate(False)
        ttk.Label(left, text="Tables & views").pack(anchor=tk.W, padx=4, pady=2)
        self.tree = ttk.Treeview(left, show="tree", selectmode="browse")
        self.tree.pack(fill=tk.BOTH, expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_select)
        main.add(left, weight=0)

        self.nb = ttk.Notebook(main)
        main.add(self.nb, weight=1)

        # ---- Data tab ----
        data_tab = ttk.Frame(self.nb)
        self.nb.add(data_tab, text="Data")

        nav = ttk.Frame(data_tab, padding=4)
        nav.pack(fill=tk.X)
        ttk.Button(nav, text="|<", width=3, command=self._first_page).pack(side=tk.LEFT)
        ttk.Button(nav, text="<", width=3, command=self._prev_page).pack(side=tk.LEFT)
        self.page_label = ttk.Label(nav, text="page 1 / 1  (0 rows)")
        self.page_label.pack(side=tk.LEFT, padx=6)
        ttk.Button(nav, text=">", width=3, command=self._next_page).pack(side=tk.LEFT)
        ttk.Button(nav, text=">|", width=3, command=self._last_page).pack(side=tk.LEFT)

        ttk.Label(nav, text="  Filter:").pack(side=tk.LEFT, padx=(12, 2))
        self.filter_var = tk.StringVar()
        filter_entry = ttk.Entry(nav, textvariable=self.filter_var, width=28)
        filter_entry.pack(side=tk.LEFT)
        filter_entry.bind("<Return>", lambda e: self._apply_filter())
        ttk.Button(nav, text="Apply", command=self._apply_filter).pack(side=tk.LEFT, padx=2)
        ttk.Button(nav, text="Clear", command=self._clear_filter).pack(side=tk.LEFT)

        ttk.Label(nav, text="  Page size:").pack(side=tk.LEFT, padx=(12, 2))
        self.page_size_var = tk.StringVar(value=str(self.page_size))
        ps = ttk.Combobox(nav, textvariable=self.page_size_var,
                          values=("100", "500", "1000", "5000"), width=6, state="readonly")
        ps.pack(side=tk.LEFT)
        ps.bind("<<ComboboxSelected>>", lambda e: self._change_page_size())

        grid_frame = ttk.Frame(data_tab)
        self.grid = ttk.Treeview(grid_frame, show="headings")
        self.grid.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb = ttk.Scrollbar(grid_frame, orient="vertical", command=self.grid.yview)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.grid.configure(yscrollcommand=vsb.set)
        self.grid.bind("<Double-1>", self._show_cell)

        hsb = ttk.Scrollbar(data_tab, orient="horizontal", command=self.grid.xview)
        hsb.pack(side=tk.BOTTOM, fill=tk.X)
        self.grid.configure(xscrollcommand=hsb.set)

        grid_frame.pack(fill=tk.BOTH, expand=True)

        # ---- Schema tab ----
        schema_tab = ttk.Frame(self.nb)
        self.nb.add(schema_tab, text="Schema")
        self.schema_text = tk.Text(schema_tab, wrap="none", font=("Consolas", 10))
        self.schema_text.pack(fill=tk.BOTH, expand=True)
        sxs = ttk.Scrollbar(schema_tab, orient="horizontal", command=self.schema_text.xview)
        sxs.pack(side=tk.BOTTOM, fill=tk.X)
        self.schema_text.configure(xscrollcommand=sxs.set)

        # ---- Info tab ----
        info_tab = ttk.Frame(self.nb)
        self.nb.add(info_tab, text="Info")
        self.info_text = tk.Text(info_tab, wrap="word", font=("Consolas", 10))
        self.info_text.pack(fill=tk.BOTH, expand=True)

        # ---- Query tab ----
        q_tab = ttk.Frame(self.nb)
        self.nb.add(q_tab, text="SQL Query")
        self.query_text = tk.Text(q_tab, height=8, font=("Consolas", 10))
        self.query_text.pack(fill=tk.X)
        self.query_text.insert("1.0", "-- SELECT * FROM some_table LIMIT 100;")
        self.query_text.bind("<Control-Return>", lambda e: self._run_query())
        qbtns = ttk.Frame(q_tab, padding=4)
        qbtns.pack(fill=tk.X)
        ttk.Button(qbtns, text="Run (Ctrl+Enter)", command=self._run_query).pack(side=tk.LEFT)
        self.query_status = ttk.Label(qbtns, text="")
        self.query_status.pack(side=tk.LEFT, padx=8)

        qres_frame = ttk.Frame(q_tab)
        qres_frame.pack(fill=tk.BOTH, expand=True)
        self.query_grid = ttk.Treeview(qres_frame, show="headings")
        self.query_grid.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        qvs = ttk.Scrollbar(qres_frame, orient="vertical", command=self.query_grid.yview)
        qvs.pack(side=tk.RIGHT, fill=tk.Y)
        self.query_grid.configure(yscrollcommand=qvs.set)

        self.status = ttk.Label(self.root, text="Ready", relief=tk.SUNKEN, anchor=tk.W)
        self.status.pack(side=tk.BOTTOM, fill=tk.X)

    # ---------------- file handling ----------------

    def _pick_file(self):
        path = filedialog.askopenfilename(
            title="Open SQLite database",
            filetypes=[("SQLite database", "*.db *.sqlite *.sqlite3 *.db3"),
                       ("All files", "*.*")],
        )
        if path:
            self.open_db(path)

    def open_db(self, path):
        if not os.path.exists(path):
            messagebox.showerror("Not found", f"File not found:\n{path}")
            return
        try:
            con = open_readonly(path)
            con.execute("SELECT 1").fetchone()
        except sqlite3.DatabaseError as e:
            messagebox.showerror("Cannot open", f"Not a readable SQLite database:\n{e}")
            return
        if self.con:
            self.con.close()
        self.con = con
        self.db_path = os.path.abspath(path)
        self.path_label.config(text=self.db_path)
        self.root.title(f"SQLite DB Viewer - {os.path.basename(path)}")
        self._populate_tree()
        self._fill_info()
        self.status.config(text=f"Opened {self.db_path}")

    def _populate_tree(self):
        self.tree.delete(*self.tree.get_children())
        rows = self.con.execute(
            "SELECT type, name FROM sqlite_master "
            "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY type, name"
        ).fetchall()
        groups = {}
        for typ, name in rows:
            label = "Tables" if typ == "table" else "Views"
            if label not in groups:
                groups[label] = self.tree.insert("", "end", text=label, open=True)
            self.tree.insert(groups[label], "end", text=name, values=(typ, name))
        self.current_obj = None
        self.current_kind = None

    def _on_tree_select(self, _event):
        sel = self.tree.selection()
        if not sel:
            return
        vals = self.tree.item(sel[0], "values")
        if not vals or len(vals) < 2:
            return
        self.current_kind, self.current_obj = vals[0], vals[1]
        self.page = 0
        self.sort_col = None
        self.sort_desc = False
        self.filter_var.set("")
        self.filter_text = ""
        self._load_schema()
        self.refresh()

    # ---------------- schema / info ----------------

    def _load_schema(self):
        self.schema_text.delete("1.0", tk.END)
        row = self.con.execute(
            "SELECT sql FROM sqlite_master WHERE type=? AND name=?",
            (self.current_kind, self.current_obj),
        ).fetchone()
        if row and row[0]:
            self.schema_text.insert(tk.END, row[0] + "\n\n")
        info = self.con.execute(f"PRAGMA table_info({qident(self.current_obj)})").fetchall()
        self.schema_text.insert(tk.END, "Columns:\n")
        for r in info:
            self.schema_text.insert(
                tk.END,
                f"  {r['name']:<24} {r['type'] or '':<12} notnull={r['notnull']} pk={r['pk']}\n",
            )
        idx = self.con.execute(f"PRAGMA index_list({qident(self.current_obj)})").fetchall()
        if idx:
            self.schema_text.insert(tk.END, "\nIndexes:\n")
            for r in idx:
                self.schema_text.insert(tk.END, f"  {r['name']}  unique={r['unique']}\n")

    def _fill_info(self):
        t = self.info_text
        t.delete("1.0", tk.END)
        try:
            size = os.path.getsize(self.db_path)
        except OSError:
            size = 0
        integ = self.con.execute("PRAGMA integrity_check").fetchone()[0]
        jm = self.con.execute("PRAGMA journal_mode").fetchone()[0]
        ps = self.con.execute("PRAGMA page_size").fetchone()[0]
        pc = self.con.execute("PRAGMA page_count").fetchone()[0]
        fl = self.con.execute("PRAGMA freelist_count").fetchone()[0]
        t.insert(tk.END, f"Path:           {self.db_path}\n")
        t.insert(tk.END, f"File size:      {size:,} bytes ({size / 1024:.1f} KiB)\n")
        t.insert(tk.END, f"SQLite version: {sqlite3.sqlite_version}\n")
        t.insert(tk.END, f"Integrity:      {integ}\n")
        t.insert(tk.END, f"Journal mode:   {jm}\n")
        t.insert(tk.END, f"Page size:      {ps}\n")
        t.insert(tk.END, f"Page count:     {pc}\n")
        t.insert(tk.END, f"Free pages:     {fl}  (unused ~{ps * fl:,} bytes)\n")
        t.insert(tk.END, "\nObjects:\n")
        for r in self.con.execute(
            "SELECT type, name FROM sqlite_master WHERE type IN "
            "('table','view','index','trigger') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY type, name"
        ):
            t.insert(tk.END, f"  [{r[0]}] {r[1]}\n")
        try:
            t.insert(tk.END, "\nStorage (dbstat):\n")
            for r in self.con.execute(
                "SELECT name, SUM(pgsize) b FROM dbstat GROUP BY name ORDER BY b DESC"
            ):
                t.insert(tk.END, f"  {r[0]:<32} {r[1] / 1024:>10.1f} KiB\n")
        except sqlite3.DatabaseError:
            t.insert(tk.END, "\n(dbstat not available in this SQLite build)\n")

    # ---------------- data grid ----------------

    def _object_columns(self):
        return self.con.execute(f"PRAGMA table_info({qident(self.current_obj)})").fetchall()

    def refresh(self):
        if not self.current_obj or not self.con:
            return
        cols = self._object_columns()
        self.columns = [(c["name"], c["type"] or "") for c in cols]
        self.grid.delete(*self.grid.get_children())
        self.grid["columns"] = [c for c, _ in self.columns]
        for name, _ in self.columns:
            self.grid.heading(name, text=name, command=lambda n=name: self._sort_by(n))
            self.grid.column(name, width=max(80, min(260, 12 * len(name) + 40)),
                             stretch=True, anchor=tk.W)

        where, params = self._build_filter()
        try:
            self.total_rows = int(self.con.execute(
                f"SELECT COUNT(*) FROM {qident(self.current_obj)} {where}", params
            ).fetchone()[0])
        except sqlite3.DatabaseError as e:
            self.status.config(text=f"Error: {e}")
            self.total_rows = 0

        order = ""
        if self.sort_col:
            order = f" ORDER BY {qident(self.sort_col)} " + ("DESC" if self.sort_desc else "ASC")
        offset = self.page * self.page_size
        sql = (f"SELECT * FROM {qident(self.current_obj)} {where}{order} "
               f"LIMIT ? OFFSET ?")
        try:
            rows = self.con.execute(sql, params + [self.page_size, offset]).fetchall()
        except sqlite3.DatabaseError as e:
            self.status.config(text=f"Error: {e}")
            return

        for r in rows:
            self.grid.insert("", "end", values=[self._cell_str(r[c]) for c, _ in self.columns])

        pages = max(1, (self.total_rows + self.page_size - 1) // self.page_size)
        self.page_label.config(
            text=f"page {self.page + 1} / {pages}  ({self.total_rows:,} rows)")
        self._update_sort_indicators()

    def _cell_str(self, val):
        if val is None:
            return "NULL"
        if isinstance(val, (bytes, bytearray, memoryview)):
            b = bytes(val)
            head = b[:32].hex()
            return f"<BLOB {len(b)} bytes: {head}{'…' if len(b) > 32 else ''}>"
        s = str(val)
        if len(s) > MAX_CELL_CHARS:
            s = s[:MAX_CELL_CHARS] + "…"
        return s

    def _build_filter(self):
        if not self.filter_text:
            return "", []
        text_cols = [n for n, t in self.columns
                     if t.upper() in ("TEXT", "VARCHAR", "CHAR", "") or t == ""]
        if not text_cols:
            text_cols = [n for n, _ in self.columns]
        clauses = [f"CAST({qident(c)} AS TEXT) LIKE ?" for c in text_cols]
        pattern = f"%{self.filter_text}%"
        return " WHERE " + " OR ".join(clauses), [pattern] * len(text_cols)

    def _sort_by(self, col):
        if self.sort_col == col:
            self.sort_desc = not self.sort_desc
        else:
            self.sort_col = col
            self.sort_desc = False
        self.refresh()

    def _update_sort_indicators(self):
        for name, _ in self.columns:
            text = name
            if self.sort_col == name:
                text += " \u25bc" if self.sort_desc else " \u25b2"
            self.grid.heading(name, text=text)

    def _apply_filter(self):
        self.filter_text = self.filter_var.get().strip()
        self.page = 0
        self.refresh()

    def _clear_filter(self):
        self.filter_var.set("")
        self.filter_text = ""
        self.page = 0
        self.refresh()

    def _change_page_size(self):
        try:
            self.page_size = max(10, int(self.page_size_var.get()))
        except ValueError:
            return
        self.page = 0
        self.refresh()

    def _first_page(self):
        self.page = 0
        self.refresh()

    def _prev_page(self):
        if self.page > 0:
            self.page -= 1
            self.refresh()

    def _next_page(self):
        if (self.page + 1) * self.page_size < self.total_rows:
            self.page += 1
            self.refresh()

    def _last_page(self):
        pages = max(1, (self.total_rows + self.page_size - 1) // self.page_size)
        self.page = pages - 1
        self.refresh()

    def _show_cell(self, event):
        if self.grid.identify("region", event.x, event.y) != "cell":
            return
        row_id = self.grid.identify_row(event.y)
        col_id = self.grid.identify_column(event.x)
        if not row_id or not col_id:
            return
        idx = int(col_id.lstrip("#")) - 1
        values = self.grid.item(row_id, "values")
        if idx < 0 or idx >= len(values):
            return
        win = tk.Toplevel(self.root)
        win.title(f"{self.columns[idx][0]} - {self.current_obj}")
        win.geometry("700x400")
        txt = tk.Text(win, wrap="word", font=("Consolas", 10))
        txt.pack(fill=tk.BOTH, expand=True)
        txt.insert("1.0", values[idx])
        txt.configure(state="disabled")

    # ---------------- query tab ----------------

    def _run_query(self):
        if not self.con:
            return
        sql = self.query_text.get("1.0", tk.END).strip()
        if not sql:
            return
        head = sql.lstrip().upper()
        if not any(head.startswith(k) for k in
                   ("SELECT", "PRAGMA", "WITH", "EXPLAIN", "VALUES")):
            messagebox.showwarning(
                "Read-only",
                "Only read-only statements (SELECT / PRAGMA / WITH / EXPLAIN) are allowed.")
            return
        try:
            cur = self.con.execute(sql)
            rows = cur.fetchmany(QUERY_ROW_LIMIT)
            cols = [d[0] for d in cur.description] if cur.description else []
        except sqlite3.DatabaseError as e:
            self.query_status.config(text=f"Error: {e}")
            return

        self.query_grid.delete(*self.query_grid.get_children())
        self.query_grid["columns"] = cols
        for c in cols:
            self.query_grid.heading(c, text=c)
            self.query_grid.column(c, width=max(80, 12 * len(c) + 20), anchor=tk.W)
        for r in rows:
            self.query_grid.insert("", "end", values=[self._cell_str(v) for v in r])
        self.query_status.config(
            text=f"{len(rows)} row(s)"
                 + (" (truncated)" if len(rows) == QUERY_ROW_LIMIT else ""))

    # ---------------- export ----------------

    def _export_csv(self):
        if not self.con or not self.current_obj:
            messagebox.showinfo("Export", "Select a table or view first.")
            return
        path = filedialog.asksaveasfilename(
            title="Save CSV", defaultextension=".csv",
            filetypes=[("CSV", "*.csv"), ("All files", "*.*")],
            initialfile=f"{self.current_obj}.csv")
        if not path:
            return
        where, params = self._build_filter()
        order = ""
        if self.sort_col:
            order = f" ORDER BY {qident(self.sort_col)} " + ("DESC" if self.sort_desc else "ASC")
        sql = f"SELECT * FROM {qident(self.current_obj)} {where}{order}"
        try:
            cur = self.con.execute(sql, params)
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow([c for c, _ in self.columns])
                for r in cur:
                    row = []
                    for v in r:
                        if v is None:
                            row.append("")
                        elif isinstance(v, (bytes, bytearray, memoryview)):
                            row.append(bytes(v).hex())
                        else:
                            row.append(v)
                    w.writerow(row)
        except (OSError, sqlite3.DatabaseError) as e:
            messagebox.showerror("Export failed", str(e))
            return
        self.status.config(text=f"Exported to {path}")


def main():
    root = tk.Tk()
    DBViewer(root, sys.argv[1] if len(sys.argv) > 1 else None)
    root.mainloop()


if __name__ == "__main__":
    main()