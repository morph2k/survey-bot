const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");

const app = express();
const port = process.env.PORT || 3000;

const dbPath = path.join(__dirname, "data", "surveybot.db");
const db = new Database(dbPath);

const issuerUsername = process.env.ISSUER_USERNAME || "issuer";
const issuerPassword = process.env.ISSUER_PASSWORD || "change-me";
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret";

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

app.use("/public", express.static(path.join(__dirname, "public")));

function ensureSurveyIssuerColumn(defaultIssuerId) {
  const columns = db.prepare("PRAGMA table_info(surveys)").all();
  const hasIssuerId = columns.some((column) => column.name === "issuer_id");
  if (!hasIssuerId) {
    db.exec("ALTER TABLE surveys ADD COLUMN issuer_id INTEGER");
    if (defaultIssuerId) {
      db.prepare("UPDATE surveys SET issuer_id = ? WHERE issuer_id IS NULL").run(
        defaultIssuerId
      );
    }
  }
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS issuers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      issuer_id INTEGER,
      category_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      survey_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (survey_id) REFERENCES surveys (id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issuer_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (issuer_id, name)
    );
  `);

  const existing = db.prepare("SELECT id FROM issuers WHERE username = ?").get(issuerUsername);
  let issuerId = existing ? existing.id : null;
  if (!existing) {
    const hash = bcrypt.hashSync(issuerPassword, 10);
    const info = db.prepare(
      "INSERT INTO issuers (username, password_hash, created_at) VALUES (?, ?, ?)"
    ).run(issuerUsername, hash, new Date().toISOString());
    issuerId = info.lastInsertRowid;
    console.log(`Created issuer user '${issuerUsername}'. Set ISSUER_PASSWORD to change.`);
  }

  ensureSurveyIssuerColumn(issuerId);
  const surveyColumns = db.prepare("PRAGMA table_info(surveys)").all();
  const hasCategoryId = surveyColumns.some((column) => column.name === "category_id");
  if (!hasCategoryId) {
    db.exec("ALTER TABLE surveys ADD COLUMN category_id INTEGER");
  }
}

initDb();

function requireAuth(req, res, next) {
  if (req.session && req.session.issuerId) {
    return next();
  }
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/s/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "survey.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/signup", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "signup.html"));
});

app.get("/admin/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send("Missing credentials");
  }

  const issuer = db
    .prepare("SELECT id, password_hash FROM issuers WHERE username = ?")
    .get(username);

  if (!issuer || !bcrypt.compareSync(password, issuer.password_hash)) {
    return res.status(401).send("Invalid credentials");
  }

  req.session.issuerId = issuer.id;
  res.redirect("/admin/dashboard");
});

app.post("/admin/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send("Missing credentials");
  }

  const existing = db.prepare("SELECT id FROM issuers WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).send("Username already exists");
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO issuers (username, password_hash, created_at) VALUES (?, ?, ?)")
    .run(username, hash, new Date().toISOString());

  req.session.issuerId = info.lastInsertRowid;
  res.redirect("/admin/dashboard");
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin");
  });
});

app.get("/api/surveys", requireAuth, (req, res) => {
  const surveys = db
    .prepare(
      `SELECT surveys.id, surveys.name, surveys.slug, surveys.created_at,
        categories.name AS category_name
      FROM surveys
      LEFT JOIN categories ON categories.id = surveys.category_id
      WHERE surveys.issuer_id = ?
      ORDER BY surveys.created_at DESC`
    )
    .all(req.session.issuerId);
  res.json({ surveys });
});

app.post("/api/surveys", requireAuth, (req, res) => {
  const { name, slug, categoryId } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: "Name and slug are required" });
  }

  try {
    db.prepare(
      "INSERT INTO surveys (name, slug, issuer_id, category_id, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(name, slug, req.session.issuerId, categoryId || null, new Date().toISOString());
  } catch (err) {
    return res.status(409).json({ error: "Survey slug already exists" });
  }

  res.status(201).json({ ok: true });
});

app.get("/api/surveys/:id/stats", requireAuth, (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = db
    .prepare(
      `SELECT surveys.id, surveys.name, surveys.slug, surveys.created_at,
        categories.name AS category_name
      FROM surveys
      LEFT JOIN categories ON categories.id = surveys.category_id
      WHERE surveys.id = ? AND surveys.issuer_id = ?`
    )
    .get(surveyId, req.session.issuerId);

  if (!survey) {
    return res.status(404).json({ error: "Survey not found" });
  }

  const responses = db
    .prepare("SELECT rating, created_at FROM responses WHERE survey_id = ?")
    .all(surveyId);

  const filter = req.query.filter || "all";
  const filterValue = req.query.value || "";
  const filteredResponses = responses.filter((response) => {
    if (filter === "after") {
      if (!filterValue) return true;
      return response.created_at >= filterValue;
    }
    if (filter === "weekday") {
      const day = Number(filterValue);
      if (Number.isNaN(day)) return true;
      return new Date(response.created_at).getDay() === day;
    }
    return true;
  });

  const total = filteredResponses.length;
  const average =
    total === 0
      ? null
      : filteredResponses.reduce((sum, item) => sum + item.rating, 0) / total;
  const distribution = filteredResponses.reduce(
    (acc, row) => {
      acc[row.rating] += 1;
      return acc;
    },
    { 1: 0, 2: 0, 3: 0, 4: 0 }
  );

  const latest = filteredResponses
    .map((response) => response.created_at)
    .sort()
    .slice(-1)[0];

  const bucketed = [];
  if (filter === "week" || filter === "month") {
    const buckets = new Map();
    for (const response of responses) {
      const date = new Date(response.created_at);
      if (Number.isNaN(date.getTime())) {
        continue;
      }
      let key = "";
      if (filter === "week") {
        const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = day.getUTCDay() || 7;
        day.setUTCDate(day.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
        key = `${day.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }
      if (!buckets.has(key)) {
        buckets.set(key, { count: 0, sum: 0 });
      }
      const entry = buckets.get(key);
      entry.count += 1;
      entry.sum += response.rating;
    }
    for (const [label, data] of Array.from(buckets.entries()).sort()) {
      bucketed.push({
        label,
        count: data.count,
        average: data.count ? Number((data.sum / data.count).toFixed(2)) : 0
      });
    }
  }

  res.json({
    survey,
    stats: {
      total,
      average: average ? Number(average).toFixed(2) : "0.00",
      distribution,
      latest: latest || null,
      buckets: bucketed
    },
    filter: {
      type: filter,
      value: filterValue
    }
  });
});

app.get("/api/surveys/slug/:slug", (req, res) => {
  const survey = db
    .prepare("SELECT id, name, slug, created_at FROM surveys WHERE slug = ?")
    .get(req.params.slug);
  if (!survey) {
    return res.status(404).json({ error: "Survey not found" });
  }
  res.json({ survey });
});

app.get("/api/surveys/:id/export", requireAuth, (req, res) => {
  const surveyId = Number(req.params.id);
  const survey = db
    .prepare(
      "SELECT id, name, slug FROM surveys WHERE id = ? AND issuer_id = ?"
    )
    .get(surveyId, req.session.issuerId);

  if (!survey) {
    return res.status(404).json({ error: "Survey not found" });
  }

  const responses = db
    .prepare(
      "SELECT created_at, rating FROM responses WHERE survey_id = ? ORDER BY created_at ASC"
    )
    .all(surveyId);

  const filter = req.query.filter || "all";
  const filterValue = req.query.value || "";
  const filteredResponses = responses.filter((response) => {
    if (filter === "after") {
      if (!filterValue) return true;
      return response.created_at >= filterValue;
    }
    if (filter === "weekday") {
      const day = Number(filterValue);
      if (Number.isNaN(day)) return true;
      return new Date(response.created_at).getDay() === day;
    }
    return true;
  });

  const csvEscape = (value) => {
    const stringValue = String(value ?? "");
    if (stringValue.includes("\"") || stringValue.includes(",") || stringValue.includes("\n")) {
      return `"${stringValue.replace(/\"/g, '""')}"`;
    }
    return stringValue;
  };

  const rows = [
    ["survey", "slug", "timestamp", "rating"],
    ...filteredResponses.map((row) => [survey.name, survey.slug, row.created_at, row.rating])
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=\"${survey.slug}-responses.csv\"`
  );
  res.send(csv);
});

app.get("/api/categories", requireAuth, (req, res) => {
  const categories = db
    .prepare(
      "SELECT id, name, created_at FROM categories WHERE issuer_id = ? ORDER BY created_at DESC"
    )
    .all(req.session.issuerId);
  res.json({ categories });
});

app.post("/api/categories", requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    db.prepare(
      "INSERT INTO categories (issuer_id, name, created_at) VALUES (?, ?, ?)"
    ).run(req.session.issuerId, name, new Date().toISOString());
  } catch (err) {
    return res.status(409).json({ error: "Category already exists" });
  }

  res.status(201).json({ ok: true });
});

app.get("/api/categories/rollup", requireAuth, (req, res) => {
  const filter = req.query.filter || "all";
  const filterValue = req.query.value || "";
  const categories = db
    .prepare(
      "SELECT id, name FROM categories WHERE issuer_id = ? ORDER BY name ASC"
    )
    .all(req.session.issuerId);

  const responses = db
    .prepare(
      "SELECT responses.rating, responses.created_at, surveys.category_id FROM responses JOIN surveys ON surveys.id = responses.survey_id WHERE surveys.issuer_id = ? AND surveys.category_id IS NOT NULL"
    )
    .all(req.session.issuerId);

  const filteredResponses = responses.filter((response) => {
    if (filter === "after") {
      if (!filterValue) return true;
      return response.created_at >= filterValue;
    }
    if (filter === "weekday") {
      const day = Number(filterValue);
      if (Number.isNaN(day)) return true;
      return new Date(response.created_at).getDay() === day;
    }
    return true;
  });

  const rollup = categories.map((category) => {
    const categoryResponses = filteredResponses.filter(
      (response) => response.category_id === category.id
    );
    const total = categoryResponses.length;
    const average =
      total === 0
        ? null
        : categoryResponses.reduce((sum, item) => sum + item.rating, 0) / total;
    const distribution = categoryResponses.reduce(
      (acc, row) => {
        acc[row.rating] += 1;
        return acc;
      },
      { 1: 0, 2: 0, 3: 0, 4: 0 }
    );

    return {
      id: category.id,
      name: category.name,
      total,
      average: average ? Number(average).toFixed(2) : "0.00",
      distribution
    };
  });

  res.json({ rollup, filter: { type: filter, value: filterValue } });
});

app.post("/api/surveys/:slug/responses", (req, res) => {
  const rating = Number(req.body.rating);
  if (![1, 2, 3, 4].includes(rating)) {
    return res.status(400).json({ error: "Rating must be 1-4" });
  }

  const survey = db
    .prepare("SELECT id FROM surveys WHERE slug = ?")
    .get(req.params.slug);
  if (!survey) {
    return res.status(404).json({ error: "Survey not found" });
  }

  db.prepare(
    "INSERT INTO responses (survey_id, rating, created_at) VALUES (?, ?, ?)"
  ).run(survey.id, rating, new Date().toISOString());

  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Surveybot running on http://localhost:${port}`);
});
