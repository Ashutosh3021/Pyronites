/* PyroCore RLT — endpoint reference harness.
 *
 * One suite definition, two runners:
 *   browser  -> test(rlt)/public/index.html
 *   node     -> test(rlt)/run_all.js
 *
 * Plain JS, no dependencies. Every backend route from methords.md is covered,
 * including negative cases (401/403/404/409/422) and informational security
 * probes (CORS reflection, XFF rate-limit key, cross-tenant table visibility).
 */
(function () {
  "use strict";

  var IS_BROWSER = typeof document !== "undefined";

  // ───────────────────────────── config ─────────────────────────────
  var cfg = { base: "", apiKey: "" };
  var jar = null; // node-only session cookie

  // ───────────────────────────── HTTP ─────────────────────────────
  async function call(t) {
    var headers = Object.assign({}, t.headers || {});
    if (t.bearer) headers["Authorization"] = "Bearer " + t.bearer;
    else if (cfg.apiKey) headers["Authorization"] = "Bearer " + cfg.apiKey;
    if (!IS_BROWSER && jar && !t.omitCreds) headers["Cookie"] = jar;

    var body;
    if (t.form) {
      body = t.form;
    } else if (t.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(t.json);
    }

    var opts = { method: t.method, headers: headers };
    if (body !== undefined) opts.body = body;
    if (IS_BROWSER && !t.omitCreds) opts.credentials = "include";

    var t0 = Date.now();
    var res;
    try {
      res = await fetch(cfg.base + t.path, opts);
    } catch (e) {
      return { status: 0, ms: Date.now() - t0, data: null, headers: null, error: String(e) };
    }

    if (!IS_BROWSER) {
      var setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (var i = 0; i < setCookies.length; i++) updateJar(setCookies[i]);
    }

    var data = null;
    var ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") !== -1) {
      data = await res.json().catch(function () { return null; });
    } else {
      data = await res.text().catch(function () { return ""; });
      if (data.length > 400) data = data.slice(0, 400) + "…";
    }
    return { status: res.status, ms: Date.now() - t0, data: data, headers: res.headers, error: null };
  }

  function updateJar(setCookie) {
    var first = setCookie.split(";")[0];
    var eq = first.indexOf("=");
    var name = first.slice(0, eq);
    var val = first.slice(eq + 1);
    var cleared = /max-age=0/i.test(setCookie) || val === "";
    var pairs = jar ? jar.split("; ").filter(Boolean) : [];
    pairs = pairs.filter(function (p) { return p.split("=")[0] !== name; });
    if (!cleared) pairs.push(name + "=" + val);
    jar = pairs.length ? pairs.join("; ") : null;
  }

  // ───────────────────────────── helpers ─────────────────────────────
  function freshCtx() {
    var ts = Date.now().toString(36);
    return {
      email: "rlt_" + ts + "@rltharness.dev",
      password: "RLT-passw0rd!42",
      user2Email: "rlt2_" + ts + "@rltharness.dev",
      fileContent: "PyroCore RLT reference upload " + ts + "\n",
      fileName: "rlt-upload.txt",
      userId: null,
      rowId: null,
      scopedRowId: null,
      adminKey: null,
      adminKeyId: null,
      roKey: null,
      roKeyId: null,
      fileId: null,
      scopedFileId: null,
      scopedKey: null,
      scopedKeyId: null,
      projectId: null,
      projectSlug: null,
      projectName: "RLT Project",
      backupPath: null,
      user2Id: null,
      mySessionId: null
    };
  }

  function dataOf(res) { return res && res.data; }
  function names(list) { return (list || []).map(function (t) { return t.name || t; }); }

  // ───────────────────────────── suite ─────────────────────────────
  function buildSuite(ctx) {
    var SP = function () { return "/api/projects/" + (ctx.projectId || "MISSING"); };

    var groups = [];

    // ── 0. unauthenticated ──────────────────────────────────────────
    groups.push({
      title: "0 · unauthenticated probes (no cookie, no key)",
      tests: [
        { id: "unauth.tables", name: "GET /tables", method: "GET", path: "/tables", omitCreds: true, expect: [401] },
        { id: "unauth.create", name: "POST /tables", method: "POST", path: "/tables", omitCreds: true,
          json: { table: "probe_tbl", columns: [{ name: "a", type: "TEXT" }] }, expect: [401] }
      ]
    });

    // ── 1. health ───────────────────────────────────────────────────
    groups.push({
      title: "1 · health",
      tests: [
        { id: "health", name: "GET /health", method: "GET", path: "/health", expect: [200],
          verify: function (c, r) { return dataOf(r) && dataOf(r).database === true ? true : "database flag not true"; } }
      ]
    });

    // ── 2. auth ─────────────────────────────────────────────────────
    groups.push({
      title: "2 · auth (/auth)",
      tests: [
        { id: "auth.signup", name: "POST /auth/signup", method: "POST", path: "/auth/signup",
          json: function () { return { email: ctx.email, password: ctx.password }; }, expect: [200] },
        { id: "auth.me", name: "GET /auth/me", method: "GET", path: "/auth/me", expect: [200],
          capture: function (c, r) { c.userId = dataOf(r).id; } },
        { id: "auth.logout", name: "POST /auth/logout", method: "POST", path: "/auth/logout", json: {}, expect: [200] },
        { id: "auth.me.unauth", name: "GET /auth/me after logout", method: "GET", path: "/auth/me", expect: [401] },
        { id: "auth.login", name: "POST /auth/login", method: "POST", path: "/auth/login",
          json: function () { return { email: ctx.email, password: ctx.password }; }, expect: [200] },
        { id: "auth.forgot", name: "POST /auth/forgot-password", method: "POST", path: "/auth/forgot-password",
          json: function () { return { email: ctx.email }; }, expect: [200, 429],
          note: "429 = per-IP+email limiter (5/hr) engaged" },
        { id: "auth.reset.bad", name: "POST /auth/reset-password (bad token)", method: "POST", path: "/auth/reset-password",
          json: { token: "invalid-token-0000000000000000", password: "NewPassw0rd!1" }, expect: [400],
          note: "invalid_token" }
      ]
    });

    // ── 3. api keys ─────────────────────────────────────────────────
    groups.push({
      title: "3 · API keys (unscoped /api/keys)",
      tests: [
        { id: "keys.list", name: "GET /api/keys", method: "GET", path: "/api/keys", expect: [200],
          verify: function (c, r) { return Array.isArray(dataOf(r)) ? true : "expected array"; } },
        { id: "keys.create.admin", name: "POST /api/keys (admin scopes)", method: "POST", path: "/api/keys",
          json: { name: "rlt-admin-key", scopes: ["read", "write", "admin"] }, expect: [200],
          capture: function (c, r) { c.adminKey = dataOf(r).key; c.adminKeyId = dataOf(r).id; } },
        { id: "keys.bearer.tables", name: "GET /tables (Bearer admin key)", method: "GET", path: "/tables",
          bearer: function (c) { return c.adminKey; }, expect: [200] },
        { id: "keys.create.readonly", name: "POST /api/keys (read-only)", method: "POST", path: "/api/keys",
          json: { name: "rlt-read-key", scopes: ["read"] }, expect: [200],
          capture: function (c, r) { c.roKey = dataOf(r).key; c.roKeyId = dataOf(r).id; } },
        { id: "keys.ro.get", name: "GET /tables (Bearer read-only)", method: "GET", path: "/tables",
          bearer: function (c) { return c.roKey; }, expect: [200] },
        { id: "keys.ro.create.denied", name: "POST /tables (Bearer read-only → 403)", method: "POST", path: "/tables",
          json: { table: "rlt_should_not_exist", columns: [{ name: "a", type: "TEXT" }] },
          bearer: function (c) { return c.roKey; }, expect: [403] },
        { id: "keys.ro.revoke", name: "DELETE /api/keys/{roKey} (session)", method: "DELETE",
          path: function (c) { return "/api/keys/" + c.roKeyId; }, expect: [200] },
        { id: "keys.ro.revoked.bearer", name: "GET /tables (revoked key → 401)", method: "GET", path: "/tables",
          bearer: function (c) { return c.roKey; }, omitCreds: true, expect: [401],
          note: "no session cookie: proves revoked Bearer itself is rejected" }
      ]
    });

    // ── 4. tables (unscoped) ────────────────────────────────────────
    groups.push({
      title: "4 · tables — unscoped /tables (meta / Default)",
      tests: [
        { id: "tbl.create", name: "POST /tables (create rlt_notes)", method: "POST", path: "/tables",
          json: { table: "rlt_notes",
                  columns: [{ name: "id", type: "TEXT" }, { name: "title", type: "TEXT" }, { name: "body", type: "TEXT" }] },
          expect: [200] },
        { id: "tbl.list", name: "GET /tables", method: "GET", path: "/tables", expect: [200],
          verify: function (c, r) { return names(dataOf(r)).indexOf("rlt_notes") !== -1 ? true : "rlt_notes missing"; } },
        { id: "tbl.insert", name: "POST /tables/rlt_notes (insert)", method: "POST", path: "/tables/rlt_notes",
          json: { title: "RLT first", body: "hello" }, expect: [200],
          capture: function (c, r) { c.rowId = dataOf(r).id; },
          verify: function (c, r) { return c.rowId ? true : "no id in insert response"; } },
        { id: "tbl.list.rows", name: "GET /tables/rlt_notes?limit=10", method: "GET",
          path: "/tables/rlt_notes?limit=10", expect: [200] },
        { id: "tbl.list.filter", name: "GET /tables/rlt_notes (filter title)", method: "GET",
          path: "/tables/rlt_notes?limit=10&filter_column=title&filter_value=RLT%20first", expect: [200],
          verify: function (c, r) { return (dataOf(r) || []).length >= 1 ? true : "filter returned 0 rows"; } },
        { id: "tbl.get", name: "GET /tables/rlt_notes/{id}", method: "GET",
          path: function (c) { return "/tables/rlt_notes/" + c.rowId; }, expect: [200] },
        { id: "tbl.schema", name: "GET /tables/rlt_notes/schema", method: "GET", path: "/tables/rlt_notes/schema",
          expect: [200],
          verify: function (c, r) {
            var got = names(dataOf(r));
            return ["id", "title", "body"].every(function (n) { return got.indexOf(n) !== -1; }) ? true : "columns: " + got.join(",");
          } },
        { id: "tbl.patch", name: "PATCH /tables/rlt_notes/{id}", method: "PATCH",
          path: function (c) { return "/tables/rlt_notes/" + c.rowId; },
          json: { title: "RLT updated" }, expect: [200] },
        { id: "tbl.get.after.patch", name: "GET row after patch", method: "GET",
          path: function (c) { return "/tables/rlt_notes/" + c.rowId; }, expect: [200],
          verify: function (c, r) { return dataOf(r).title === "RLT updated" ? true : "title not updated"; } },
        { id: "tbl.delete.row", name: "DELETE /tables/rlt_notes/{id}", method: "DELETE",
          path: function (c) { return "/tables/rlt_notes/" + c.rowId; }, expect: [200] },
        { id: "tbl.get.deleted", name: "GET deleted row → 404", method: "GET",
          path: function (c) { return "/tables/rlt_notes/" + c.rowId; }, expect: [404] },
        { id: "tbl.create.badpk", name: "POST /tables (bad primary_key → 400)", method: "POST", path: "/tables",
          json: { table: "rlt_bad", columns: [{ name: "title", type: "TEXT" }], primary_key: "nope" },
          expect: [400] },
        { id: "tbl.create.reserved", name: "POST /tables (reserved name → 422)", method: "POST", path: "/tables",
          json: { table: "users", columns: [{ name: "a", type: "TEXT" }] }, expect: [422] },
        { id: "tbl.get.missing", name: "GET /tables/nope_table → 404", method: "GET", path: "/tables/nope_table",
          expect: [404] },
        { id: "tbl.insert.badcol", name: "POST /tables/rlt_notes (unknown column → 404)", method: "POST",
          path: "/tables/rlt_notes", json: { bogus_column: "x" }, expect: [404] }
      ]
    });

    // ── 5. cross-tenant probe ───────────────────────────────────────
    groups.push({
      title: "5 · cross-tenant visibility probe (second account reads /tables)",
      tests: [
        { id: "tenant.signup2", name: "POST /auth/signup (user2)", method: "POST", path: "/auth/signup",
          json: function () { return { email: ctx.user2Email, password: ctx.password }; }, expect: [200] },
        { id: "tenant.tables", name: "GET /tables (as user2) — PROBE", method: "GET", path: "/tables",
          probe: true, expect: [200],
          note: "shared meta: is rlt_notes (user1's table) visible to user2?",
          verify: function (c, r) {
            var visible = names(dataOf(r)).indexOf("rlt_notes") !== -1;
            return "rlt_notes visible to user2: " + visible + " — tables: [" + names(dataOf(r)).join(", ") + "]";
          } },
        { id: "tenant.relogin", name: "POST /auth/login (back to user1)", method: "POST", path: "/auth/login",
          json: function () { return { email: ctx.email, password: ctx.password }; }, expect: [200] }
      ]
    });

    // ── 6. SQL (unscoped) ───────────────────────────────────────────
    groups.push({
      title: "6 · SQL — unscoped /sql/execute",
      tests: [
        { id: "sql.read", name: "POST /sql/execute (SELECT 1)", method: "POST", path: "/sql/execute",
          json: { sql: "SELECT 1 AS one" }, expect: [200],
          verify: function (c, r) {
            var d = dataOf(r);
            return d && Array.isArray(d.results) ? true : "expected {results: [...]}";
          } },
        { id: "sql.write", name: "POST /sql/execute (CREATE+INSERT, auto-backup)", method: "POST", path: "/sql/execute",
          json: { sql: "CREATE TABLE IF NOT EXISTS rlt_sql (id TEXT, v TEXT); INSERT INTO rlt_sql (id, v) VALUES ('s1','ok');" },
          expect: [200], note: "write → full-file backup of meta first" },
        { id: "sql.read.back", name: "POST /sql/execute (SELECT from rlt_sql)", method: "POST", path: "/sql/execute",
          json: { sql: "SELECT * FROM rlt_sql" }, expect: [200],
          verify: function (c, r) {
            var d = dataOf(r);
            var rows = d && d.results && d.results[0] && d.results[0].rows;
            return (rows || []).length >= 1 ? true : "no rows in " + JSON.stringify(d && d.results);
          } },
        { id: "sql.drop", name: "POST /sql/execute (DROP rlt_sql)", method: "POST", path: "/sql/execute",
          json: { sql: "DROP TABLE rlt_sql" }, expect: [200] },
        { id: "sql.bad", name: "POST /sql/execute (syntax error → 400)", method: "POST", path: "/sql/execute",
          json: { sql: "SELEC broken" }, expect: [400] }
      ]
    });

    // ── 7. storage (unscoped) ───────────────────────────────────────
    groups.push({
      title: "7 · storage — unscoped /storage",
      tests: [
        { id: "sto.upload", name: "POST /storage/upload", method: "POST", path: "/storage/upload",
          form: function (c) {
            var fd = new FormData();
            fd.append("file", new Blob([c.fileContent], { type: "text/plain" }), c.fileName);
            return fd;
          },
          expect: [200],
          capture: function (c, r) { c.fileId = dataOf(r).id; },
          verify: function (c, r) { return c.fileId ? true : "no file id"; } },
        { id: "sto.list", name: "GET /storage", method: "GET", path: "/storage", expect: [200],
          verify: function (c, r) {
            var ids = (dataOf(r) || []).map(function (f) { return f.id; });
            return ids.indexOf(c.fileId) !== -1 ? true : "uploaded file missing from list";
          } },
        { id: "sto.meta", name: "GET /storage/{id}", method: "GET",
          path: function (c) { return "/storage/" + c.fileId; }, expect: [200],
          verify: function (c, r) { return dataOf(r).original_filename === c.fileName ? true : "filename mismatch"; } },
        { id: "sto.download", name: "GET /storage/{id}/download", method: "GET",
          path: function (c) { return "/storage/" + c.fileId + "/download"; }, expect: [200],
          verify: function (c, r) { return dataOf(r) === c.fileContent ? true : "content mismatch: " + JSON.stringify(dataOf(r)); } },
        { id: "sto.delete", name: "DELETE /storage/{id}", method: "DELETE",
          path: function (c) { return "/storage/" + c.fileId; }, expect: [200] },
        { id: "sto.meta.deleted", name: "GET /storage/{id} after delete → 404", method: "GET",
          path: function (c) { return "/storage/" + c.fileId; }, expect: [404] }
      ]
    });

    // ── 8. projects + project-scoped plane ──────────────────────────
    groups.push({
      title: "8 · projects + project-scoped plane (/api/projects/…)",
      tests: [
        { id: "prj.list", name: "GET /api/projects", method: "GET", path: "/api/projects", expect: [200],
          verify: function (c, r) { return Array.isArray(dataOf(r).projects) ? true : "expected {projects:[]}"; } },
        { id: "prj.create", name: "POST /api/projects (create)", method: "POST", path: "/api/projects",
          json: { name: "RLT Project" }, expect: [200],
          capture: function (c, r) {
            c.projectId = dataOf(r).id;
            c.projectSlug = dataOf(r).slug || dataOf(r).project_id;
            c.projectName = dataOf(r).project_name || dataOf(r).name;
          },
          verify: function (c, r) { return c.projectId ? true : "no project id"; } },
        { id: "prj.get.uuid", name: "GET /api/projects/{uuid}", method: "GET",
          path: function (c) { return "/api/projects/" + c.projectId; }, expect: [200] },
        { id: "prj.get.slug", name: "GET /api/projects/{slug}", method: "GET",
          path: function (c) { return "/api/projects/" + c.projectSlug; }, expect: [200],
          note: "slug and UUID must both resolve" },
        { id: "prj.patch", name: "PATCH /api/projects/{id} (rename)", method: "PATCH",
          path: function (c) { return "/api/projects/" + c.projectId; },
          json: { name: "RLT Project Renamed" }, expect: [200],
          capture: function (c) { c.projectName = "RLT Project Renamed"; } },
        { id: "prj.select", name: "POST /api/projects/{id}/select", method: "POST",
          path: function (c) { return "/api/projects/" + c.projectId + "/select"; }, expect: [200] },

        { id: "scp.stats", name: "GET …/stats", method: "GET", path: function () { return SP() + "/stats"; }, expect: [200] },
        { id: "scp.tbl.create", name: "POST …/tables (create rlt_items)", method: "POST",
          path: function () { return SP() + "/tables"; },
          json: { table: "rlt_items",
                  columns: [{ name: "id", type: "TEXT" }, { name: "name", type: "TEXT" }, { name: "qty", type: "TEXT" }] },
          expect: [200] },
        { id: "scp.tbl.list", name: "GET …/tables", method: "GET", path: function () { return SP() + "/tables"; },
          expect: [200],
          verify: function (c, r) { return names(dataOf(r)).indexOf("rlt_items") !== -1 ? true : "rlt_items missing"; } },
        { id: "scp.tbl.insert", name: "POST …/tables/rlt_items (insert)", method: "POST",
          path: function () { return SP() + "/tables/rlt_items"; },
          json: { name: "scoped row", qty: "3" }, expect: [200],
          capture: function (c, r) { c.scopedRowId = dataOf(r).id; } },
        { id: "scp.tbl.rows", name: "GET …/tables/rlt_items?limit=10", method: "GET",
          path: function () { return SP() + "/tables/rlt_items?limit=10"; }, expect: [200] },
        { id: "scp.tbl.filter", name: "GET …/tables/rlt_items (filter)", method: "GET",
          path: function () { return SP() + "/tables/rlt_items?limit=10&filter_column=name&filter_value=scoped%20row"; },
          expect: [200],
          verify: function (c, r) { return (dataOf(r) || []).length >= 1 ? true : "filter returned 0 rows"; } },
        { id: "scp.tbl.schema", name: "GET …/tables/rlt_items/schema", method: "GET",
          path: function () { return SP() + "/tables/rlt_items/schema"; }, expect: [200] },
        { id: "scp.tbl.get", name: "GET …/tables/rlt_items/{id}", method: "GET",
          path: function (c) { return SP() + "/tables/rlt_items/" + c.scopedRowId; }, expect: [200] },
        { id: "scp.tbl.patch", name: "PATCH …/tables/rlt_items/{id}", method: "PATCH",
          path: function (c) { return SP() + "/tables/rlt_items/" + c.scopedRowId; },
          json: { name: "scoped row 2" }, expect: [200] },
        { id: "scp.tbl.get.patched", name: "GET row after patch", method: "GET",
          path: function (c) { return SP() + "/tables/rlt_items/" + c.scopedRowId; }, expect: [200],
          verify: function (c, r) { return dataOf(r).name === "scoped row 2" ? true : "name not updated"; } },
        { id: "scp.tbl.delete", name: "DELETE …/tables/rlt_items/{id}", method: "DELETE",
          path: function (c) { return SP() + "/tables/rlt_items/" + c.scopedRowId; }, expect: [200] },
        { id: "scp.tbl.get.deleted", name: "GET deleted row → 404", method: "GET",
          path: function (c) { return SP() + "/tables/rlt_items/" + c.scopedRowId; }, expect: [404] },

        { id: "scp.sql.read", name: "POST …/sql/execute (SELECT)", method: "POST",
          path: function () { return SP() + "/sql/execute"; }, json: { sql: "SELECT 1 AS scoped_ok" }, expect: [200] },
        { id: "scp.sql.write", name: "POST …/sql/execute (write, auto-backup)", method: "POST",
          path: function () { return SP() + "/sql/execute"; },
          json: { sql: "CREATE TABLE IF NOT EXISTS rlt_ssql (id TEXT); INSERT INTO rlt_ssql (id) VALUES ('a');" },
          expect: [200], note: "backup of the PROJECT file, not meta" },
        { id: "scp.sql.drop", name: "POST …/sql/execute (DROP rlt_ssql)", method: "POST",
          path: function () { return SP() + "/sql/execute"; }, json: { sql: "DROP TABLE rlt_ssql" }, expect: [200] },
        { id: "scp.sql.bad", name: "POST …/sql/execute (syntax error → 400)", method: "POST",
          path: function () { return SP() + "/sql/execute"; }, json: { sql: "SELEC broken" }, expect: [400] },

        { id: "scp.sto.upload", name: "POST …/storage/upload", method: "POST",
          path: function () { return SP() + "/storage/upload"; },
          form: function (c) {
            var fd = new FormData();
            fd.append("file", new Blob([c.fileContent], { type: "text/plain" }), c.fileName);
            return fd;
          }, expect: [200],
          capture: function (c, r) { c.scopedFileId = dataOf(r).id; } },
        { id: "scp.sto.list", name: "GET …/storage", method: "GET", path: function () { return SP() + "/storage"; },
          expect: [200],
          verify: function (c, r) {
            var ids = (dataOf(r) || []).map(function (f) { return f.id; });
            return ids.indexOf(c.scopedFileId) !== -1 ? true : "scoped upload missing";
          } },
        { id: "scp.sto.meta", name: "GET …/storage/{id}", method: "GET",
          path: function (c) { return SP() + "/storage/" + c.scopedFileId; }, expect: [200] },
        { id: "scp.sto.download", name: "GET …/storage/{id}/download", method: "GET",
          path: function (c) { return SP() + "/storage/" + c.scopedFileId + "/download"; }, expect: [200],
          verify: function (c, r) { return dataOf(r) === c.fileContent ? true : "content mismatch"; } },
        { id: "scp.sto.delete", name: "DELETE …/storage/{id}", method: "DELETE",
          path: function (c) { return SP() + "/storage/" + c.scopedFileId; }, expect: [200] },
        { id: "scp.sto.meta.deleted", name: "GET …/storage/{id} after delete → 404", method: "GET",
          path: function (c) { return SP() + "/storage/" + c.scopedFileId; }, expect: [404] },

        { id: "scp.key.create", name: "POST …/api/keys (scoped key)", method: "POST",
          path: function () { return SP() + "/api/keys"; },
          json: { name: "rlt-scoped-key", scopes: ["read", "write"] }, expect: [200],
          capture: function (c, r) { c.scopedKey = dataOf(r).key; c.scopedKeyId = dataOf(r).id; } },
        { id: "scp.key.list", name: "GET …/api/keys", method: "GET", path: function () { return SP() + "/api/keys"; },
          expect: [200],
          verify: function (c, r) {
            var ids = (dataOf(r) || []).map(function (k) { return k.id; });
            return ids.indexOf(c.scopedKeyId) !== -1 ? true : "scoped key not listed";
          } },
        { id: "scp.key.bearer", name: "GET …/tables (Bearer scoped key)", method: "GET",
          path: function () { return SP() + "/tables"; }, bearer: function (c) { return c.scopedKey; }, expect: [200] },
        { id: "scp.key.on.unscoped", name: "GET /tables (scoped key on unscoped plane) — PROBE", method: "GET",
          path: "/tables", bearer: function (c) { return c.scopedKey; }, probe: true, expect: [403],
          note: "scoped-plane keys must not reach the tenancy-blind legacy plane (H1: 403 = fixed)" },
        { id: "scp.wrong.project", name: "GET …/tables (default-project key on OTHER project → 403)", method: "GET",
          path: function () { return SP() + "/tables"; }, bearer: function (c) { return c.adminKey; }, expect: [403],
          note: "API key project binding (BUG-3 reference)" },
        { id: "scp.key.revoke", name: "DELETE …/api/keys/{scopedKey} (session)", method: "DELETE",
          path: function (c) { return SP() + "/api/keys/" + c.scopedKeyId; }, expect: [200] },
        { id: "scp.key.revoked.bearer", name: "GET …/tables (revoked scoped key → 401)", method: "GET",
          path: function () { return SP() + "/tables"; }, bearer: function (c) { return c.scopedKey; },
          omitCreds: true, expect: [401] },
        { id: "keys.admin.revoke", name: "DELETE /api/keys/{adminKey} (session)", method: "DELETE",
          path: function (c) { return "/api/keys/" + c.adminKeyId; }, expect: [200] },
        { id: "keys.admin.revoked.bearer", name: "GET /tables (revoked admin key → 401)", method: "GET",
          path: "/tables", bearer: function (c) { return c.adminKey; }, omitCreds: true, expect: [401] },

        { id: "scp.tbl.drop", name: "DELETE …/tables/rlt_items (drop)", method: "DELETE",
          path: function () { return SP() + "/tables/rlt_items"; },
          json: { confirm_name: "rlt_items" }, expect: [200] },
        { id: "scp.tbl.dropped", name: "GET …/tables (rlt_items gone)", method: "GET",
          path: function () { return SP() + "/tables"; }, expect: [200],
          verify: function (c, r) { return names(dataOf(r)).indexOf("rlt_items") === -1 ? true : "rlt_items still listed"; } },

        { id: "prj.archive", name: "POST /api/projects/{id}/archive", method: "POST",
          path: function (c) { return "/api/projects/" + c.projectId + "/archive"; }, expect: [200] },
        { id: "prj.archived.blocked", name: "GET …/tables (archived → 409)", method: "GET",
          path: function () { return SP() + "/tables"; }, expect: [409] },
        { id: "prj.restore", name: "POST /api/projects/{id}/restore", method: "POST",
          path: function (c) { return "/api/projects/" + c.projectId + "/restore"; }, expect: [200] },
        { id: "prj.restored.ok", name: "GET …/tables after restore", method: "GET",
          path: function () { return SP() + "/tables"; }, expect: [200] },
        { id: "prj.delete", name: "DELETE /api/projects/{id} (confirm name)", method: "DELETE",
          path: function (c) { return "/api/projects/" + c.projectId; },
          json: function (c) { return { confirm_name: c.projectName }; }, expect: [200] },
        { id: "prj.get.deleted", name: "GET /api/projects/{id} after delete → 404", method: "GET",
          path: function (c) { return "/api/projects/" + c.projectId; }, expect: [404] }
      ]
    });

    // ── 9. system / dashboard ───────────────────────────────────────
    groups.push({
      title: "9 · system / dashboard (/api)",
      tests: [
        { id: "sys.stats", name: "GET /api/stats", method: "GET", path: "/api/stats", expect: [200] },
        { id: "sys.logs", name: "GET /api/logs", method: "GET", path: "/api/logs", expect: [200],
          note: "in-memory ring — empty after every restart",
          verify: function (c, r) { return Array.isArray(dataOf(r)) ? true : "expected array"; } },
        { id: "sys.backups", name: "GET /api/backups", method: "GET", path: "/api/backups", expect: [200],
          verify: function (c, r) { return Array.isArray(dataOf(r)) ? true : "expected array"; } },
        { id: "sys.backup", name: "POST /api/backup", method: "POST", path: "/api/backup", json: {}, expect: [200],
          capture: function (c, r) { c.backupPath = dataOf(r).path; },
          verify: function (c, r) { return c.backupPath ? true : "no backup path"; } },
        { id: "sys.restore", name: "POST /api/backup/restore (own backup)", method: "POST", path: "/api/backup/restore",
          json: function (c) { return { path: c.backupPath }; }, expect: [200],
          note: "path is used verbatim — arbitrary-path acceptance = H4" },
        { id: "sys.users", name: "GET /api/users", method: "GET", path: "/api/users", expect: [200],
          capture: function (c, r) {
            var list = Array.isArray(dataOf(r)) ? dataOf(r) : [];
            var u2 = list.filter(function (u) { return u.email === c.user2Email; })[0];
            c.user2Id = u2 ? u2.id : null;
          },
          verify: function (c, r) { return c.user2Id ? true : "user2 not found in /api/users"; } },
        { id: "sys.user.disable", name: "PATCH /api/users/{user2} (disable)", method: "PATCH",
          path: function (c) { return "/api/users/" + c.user2Id; }, json: { is_active: false }, expect: [200] },
        { id: "sys.user.enable", name: "PATCH /api/users/{user2} (enable)", method: "PATCH",
          path: function (c) { return "/api/users/" + c.user2Id; }, json: { is_active: true }, expect: [200] },
        { id: "sys.user.delete", name: "DELETE /api/users/{user2}", method: "DELETE",
          path: function (c) { return "/api/users/" + c.user2Id; }, expect: [200] },
        { id: "sys.user.gone", name: "GET /api/users (user2 gone)", method: "GET", path: "/api/users", expect: [200],
          verify: function (c, r) {
            var list = dataOf(r) || [];
            var hit = list.some(function (u) { return u.email === c.user2Email; });
            if (!hit) return true;
            return "user2 still listed | c.user2Email=" + c.user2Email +
              " | first3=" + JSON.stringify(list.slice(0, 3).map(function (u) { return u.email; }));
          } },
        { id: "sys.sessions", name: "GET /api/sessions", method: "GET", path: "/api/sessions", expect: [200],
          capture: function (c, r) {
            var mine = (Array.isArray(dataOf(r)) ? dataOf(r) : [])
              .filter(function (s) { return s.user_email === c.email; });
            c.mySessionId = mine.length ? mine[0].id : null;
          },
          verify: function (c, r) { return c.mySessionId ? true : "no session for test user"; } },
        { id: "sys.session.revoke", name: "DELETE /api/sessions/{my session}", method: "DELETE",
          path: function (c) { return "/api/sessions/" + c.mySessionId; }, expect: [200] },
        { id: "sys.me.revoked", name: "GET /auth/me after session revoke → 401", method: "GET",
          path: "/auth/me", expect: [401] },
        { id: "sys.relogin", name: "POST /auth/login (re-login)", method: "POST", path: "/auth/login",
          json: function () { return { email: ctx.email, password: ctx.password }; }, expect: [200] }
      ]
    });

    // ── 10. security probes ─────────────────────────────────────────
    groups.push({
      title: "10 · security probes (informational)",
      tests: [
        { id: "probe.cors", name: "GET /health with Origin: https://evil.vercel.app — PROBE", method: "GET",
          path: "/health", headers: { Origin: "https://evil.vercel.app" }, probe: true, expect: [200],
          detail: function (r) {
            if (!r.headers) return "no response";
            var acao = r.headers.get("access-control-allow-origin");
            var acac = r.headers.get("access-control-allow-credentials");
            if (acao === null && IS_BROWSER) return "ACAO: (browser rewrites Origin on same-origin calls — use node driver)";
            return "ACAO: " + acao + "  ACAC: " + acac +
              (acao ? "   ← wildcard CORS accepts arbitrary origins WITH credentials (C2)" : "   ← origin not reflected");
          } },
        { id: "probe.xff", name: "25× POST /auth/login with spoofed X-Forwarded-For — PROBE", probe: true,
          method: "POST", path: "/auth/login ×25 (spoofed XFF)", expect: [200],
          run: async function (api) {
            var counts = {};
            for (var i = 1; i <= 25; i++) {
              var r = await api.call({
                method: "POST",
                path: "/auth/login",
                json: { email: "nobody-" + i + "@rltharness.dev", password: "wrong-password-x" },
                headers: { "X-Forwarded-For": "203.0.113." + i }
              });
              counts[r.status] = (counts[r.status] || 0) + 1;
            }
            var parts = Object.keys(counts).sort().map(function (s) { return s + "×" + counts[s]; }).join(", ");
            var bypass = !counts[429];
            return {
              status: 200,
              detail: "25 attempts, unique spoofed XFF each → " + parts +
                (bypass ? "   ← NO 429s: per-IP login limit bypassable via XFF (H2 open)"
                        : "   ← 429s present: limit applied to real client IP (H2 fixed)")
            };
          } }
      ]
    });

    // ── 11. account deletion ────────────────────────────────────────
    groups.push({
      title: "11 · self-service account deletion",
      tests: [
        { id: "acct.delete", name: "DELETE /auth/account", method: "DELETE", path: "/auth/account",
          json: function (c) { return { password: c.password }; }, expect: [200] },
        { id: "acct.me", name: "GET /auth/me after delete → 401", method: "GET", path: "/auth/me", expect: [401] }
      ]
    });

    return groups;
  }

  // ───────────────────────────── runner ─────────────────────────────
  function resolve(v, ctx) { return typeof v === "function" ? v(ctx) : v; }

  async function runOne(t, ctx, onResult, seq) {
    var method = resolve(t.method, ctx) || "GET";
    var path = resolve(t.path, ctx) || "";
    var res;
    var started = Date.now();

    if (t.run) {
      res = await t.run({ call: call }, ctx);
      // custom run returns {status, detail}
      res.ms = Date.now() - started;
      res.headers = res.headers || null;
    } else {
      var req = { method: method, path: path };
      var json = resolve(t.json, ctx);
      if (json !== undefined) req.json = json;
      if (t.form) req.form = t.form(ctx);
      var headers = resolve(t.headers, ctx);
      if (headers) req.headers = headers;
      if (t.bearer) req.bearer = resolve(t.bearer, ctx);
      if (t.omitCreds) req.omitCreds = true;
      res = await call(req);
    }

    var expect = t.expect || [200];
    var pass = res.status === 0 ? false : expect.indexOf(res.status) !== -1;
    var detail = res.detail || null;

    if (t.capture && res.status !== 0) { try { t.capture(ctx, res); } catch (e) { detail = "capture error: " + e; } }

    if (pass && t.verify && res.status !== 0) {
      var v;
      try { v = t.verify(ctx, res); } catch (e) { v = String(e); }
      if (t.probe) {
        if (v !== true) detail = typeof v === "string" ? v : "probe verify: " + v;
      } else if (v !== true) {
        pass = false; detail = "verify failed: " + v;
      } else if (typeof v === "string") detail = v;
    }
    if (t.detail && !detail) { try { detail = t.detail(res); } catch (e) { detail = String(e); } }
    if (!pass && !detail) {
      detail = "body: " + JSON.stringify(res.data);
      if (res.error) detail = res.error;
    }

    var result = {
      seq: seq, id: t.id, name: t.name, method: method, path: path,
      status: res.status, ms: res.ms, expect: expect, pass: pass,
      probe: !!t.probe, note: t.note || null, detail: detail, data: res.data
    };
    if (onResult) onResult(result);
    return result;
  }

  async function runAll(opts) {
    opts = opts || {};
    if (opts.base !== undefined) cfg.base = opts.base;
    if (opts.apiKey !== undefined) cfg.apiKey = opts.apiKey;
    jar = null;

    var ctx = freshCtx();
    var groups = buildSuite(ctx);
    var results = [];
    var seq = 0;

    for (var g = 0; g < groups.length; g++) {
      if (opts.onGroup) opts.onGroup(groups[g].title);
      for (var i = 0; i < groups[g].tests.length; i++) {
        seq++;
        var r = await runOne(groups[g].tests[i], ctx, opts.onResult, seq);
        results.push(r);
        if (opts.delay) await new Promise(function (res) { setTimeout(res, opts.delay); });
      }
    }

    var summary = {
      total: results.length,
      pass: results.filter(function (r) { return r.pass && !r.probe; }).length,
      fail: results.filter(function (r) { return !r.pass && !r.probe; }).length,
      probe: results.filter(function (r) { return r.probe; }).length,
      probeFail: results.filter(function (r) { return r.probe && !r.pass; }).length,
      results: results
    };
    return summary;
  }

  function fmtResult(r) {
    var mark = r.pass ? "✓" : "✗";
    var line = pad(String(r.seq), 3) + " " + mark + " " +
      pad(r.method, 6) + " " + pad(r.path, 62) + " " +
      pad(String(r.status), 4) + " " + pad(r.ms + "ms", 7) +
      "  expect " + r.expect.join("/") +
      (r.probe ? "  [PROBE]" : "");
    if (r.detail) line += "\n       └ " + r.detail;
    if (r.note && !r.detail) line += "\n       └ note: " + r.note;
    return line;
  }

  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ───────────────────────────── browser UI ─────────────────────────────
  async function initUI() {
    var groupsEl = document.getElementById("groups");
    var logEl = document.getElementById("log");
    var summaryEl = document.getElementById("summary");
    var noteEl = document.getElementById("runner-note");
    var baseEl = document.getElementById("cfg-base");
    var keyEl = document.getElementById("cfg-key");

    noteEl.textContent = IS_BROWSER
      ? "Browser mode: cookies handled automatically. Security probes (CORS/XFF) are most accurate via the node driver (run_all.js)."
      : "";

    var ctxPreview = freshCtx();
    var groups = buildSuite(ctxPreview);

    groups.forEach(function (g) {
      var h = document.createElement("h2");
      h.textContent = g.title;
      groupsEl.appendChild(h);
      var ul = document.createElement("ul");
      g.tests.forEach(function (t) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = t.name;
        btn.addEventListener("click", async function () {
          cfg.base = baseEl.value.trim();
          cfg.apiKey = keyEl.value.trim();
          btn.disabled = true;
          try {
            var r = await runOne(t, ctxPreview, null, 0);
            logEl.textContent += fmtResult(r) + "\n\n";
            logEl.scrollTop = logEl.scrollHeight;
          } finally {
            btn.disabled = false;
          }
        });
        li.appendChild(btn);
        if (t.note) li.appendChild(document.createTextNode(" — " + t.note));
        ul.appendChild(li);
      });
      groupsEl.appendChild(ul);
    });

    document.getElementById("btn-run").addEventListener("click", async function () {
      var btn = this;
      btn.disabled = true;
      cfg.base = baseEl.value.trim();
      cfg.apiKey = keyEl.value.trim();
      logEl.textContent = "";
      summaryEl.textContent = "running…";
      try {
        var s = await runAll({
          onGroup: function (title) {
            logEl.textContent += "—— " + title + " ——\n";
          },
          onResult: function (r) {
            logEl.textContent += fmtResult(r) + "\n";
            logEl.scrollTop = logEl.scrollHeight;
          }
        });
        summaryEl.textContent =
          "TOTAL " + s.total + "  PASS " + s.pass + "  FAIL " + s.fail +
          "  PROBE " + s.probe + (s.probeFail ? " (mismatched " + s.probeFail + ")" : "");
        logEl.textContent += "\n" + summaryEl.textContent + "\n";
      } catch (e) {
        summaryEl.textContent = "ERROR: " + e;
        logEl.textContent += "ERROR: " + e + "\n";
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("btn-clear").addEventListener("click", function () {
      logEl.textContent = "";
      summaryEl.textContent = "—";
    });
  }

  // ───────────────────────────── exports ─────────────────────────────
  var api = { runAll: runAll, runOne: runOne, buildSuite: buildSuite, fmtResult: fmtResult, cfg: cfg };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (IS_BROWSER) initUI();
})();
