const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./db');
const { requireAuth, redirectIfAuthenticated } = require('./auth');

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return value === 'true';
}

function formatDate(value) {
  if (!value) {
    return 'N/A';
  }

  return new Date(value).toLocaleString('es-UY', {
    hour12: false
  });
}

function buildSettings() {
  const labMode = process.env.LAB_MODE === 'mitigated' ? 'mitigated' : 'vulnerable';
  const vulnerableDefaults = labMode === 'vulnerable';

  return {
    labMode,
    renderUnsafeHtml: parseBoolean(process.env.RENDER_UNSAFE_HTML, vulnerableDefaults),
    cookieHttpOnly: parseBoolean(process.env.COOKIE_HTTPONLY, !vulnerableDefaults),
    enableCsp: parseBoolean(process.env.ENABLE_CSP, !vulnerableDefaults)
  };
}

function parseMessageId(rawValue) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    return null;
  }

  return value;
}

const app = express();
const port = Number(process.env.INTERNAL_PORT || 3001);
const settings = buildSettings();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));

if (settings.enableCsp) {
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    next();
  });
}

app.use(session({
  name: 'gym_internal_session',
  secret: process.env.SESSION_SECRET || 'lab_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: settings.cookieHttpOnly,
    sameSite: 'lax',
    secure: false
  }
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.settings = settings;
  res.locals.formatDate = formatDate;
  next();
});

async function findUser(username, password) {
  const result = await db.query(
    `SELECT id, username, role
       FROM internal_users
      WHERE username = $1 AND password = $2
      LIMIT 1`,
    [username, password]
  );

  return result.rows[0] || null;
}

async function fetchCounts() {
  const result = await db.query(
    `SELECT status, COUNT(*)::int AS total
       FROM contact_messages
      GROUP BY status`
  );

  const counts = {
    new: 0,
    processing: 0,
    processed: 0,
    flagged: 0
  };

  for (const row of result.rows) {
    counts[row.status] = row.total;
  }

  return counts;
}

app.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { error: null });
});

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/admin');
  }

  return res.render('login', { error: null });
});

app.post('/login', redirectIfAuthenticated, async (req, res, next) => {
  const { username = '', password = '' } = req.body;

  try {
    const user = await findUser(username.trim(), password);
    if (!user) {
      return res.status(401).render('login', {
        error: 'Credenciales inválidas.'
      });
    }

    req.session.user = user;
    return res.redirect('/admin');
  } catch (error) {
    return next(error);
  }
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) {
      return next(error);
    }

    res.clearCookie('gym_internal_session');
    return res.redirect('/login');
  });
});

app.get('/admin', requireAuth, async (req, res, next) => {
  try {
    const counts = await fetchCounts();
    const recentMessages = await db.query(
      `SELECT id, full_name, email, status, created_at
         FROM contact_messages
        ORDER BY created_at DESC, id DESC
        LIMIT 5`
    );

    res.render('dashboard', {
      counts,
      recentMessages: recentMessages.rows
    });
  } catch (error) {
    next(error);
  }
});

app.get('/admin/messages', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, full_name, email, phone, message, status, created_at, processed_at
         FROM contact_messages
        ORDER BY created_at DESC, id DESC`
    );

    res.render('messages', {
      messages: result.rows
    });
  } catch (error) {
    next(error);
  }
});

app.get('/admin/messages/next', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `WITH next_message AS (
         SELECT id
           FROM contact_messages
          WHERE status = 'new'
          ORDER BY created_at ASC, id ASC
          LIMIT 1
       )
       UPDATE contact_messages
          SET status = 'processing'
        WHERE id = (SELECT id FROM next_message)
      RETURNING id, full_name, email, phone, message, status, created_at, processed_at`
    );

    if (!result.rows[0]) {
      return res.render('message-detail', {
        message: null,
        sourceLabel: 'Siguiente mensaje'
      });
    }

    return res.render('message-detail', {
      message: result.rows[0],
      sourceLabel: 'Siguiente mensaje'
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/admin/messages/:id', requireAuth, async (req, res, next) => {
  const messageId = parseMessageId(req.params.id);
  if (!messageId) {
    return res.status(404).send('Mensaje no encontrado');
  }

  try {
    const result = await db.query(
      `SELECT id, full_name, email, phone, message, status, created_at, processed_at
         FROM contact_messages
        WHERE id = $1`,
      [messageId]
    );

    if (!result.rows[0]) {
      return res.status(404).send('Mensaje no encontrado');
    }

    return res.render('message-detail', {
      message: result.rows[0],
      sourceLabel: `Mensaje #${messageId}`
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/admin/messages/:id/process', requireAuth, async (req, res, next) => {
  const messageId = parseMessageId(req.params.id);
  if (!messageId) {
    return res.status(404).send('Mensaje no encontrado');
  }

  try {
    const result = await db.query(
      `UPDATE contact_messages
          SET status = 'processed',
              processed_at = now()
        WHERE id = $1
      RETURNING id`,
      [messageId]
    );

    if (!result.rows[0]) {
      return res.status(404).send('Mensaje no encontrado');
    }

    return res.redirect(`/admin/messages/${messageId}`);
  } catch (error) {
    return next(error);
  }
});

app.get('/health', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({
      status: 'ok',
      service: 'internal-app',
      labMode: settings.labMode
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error('[internal-app] request failed', error);
  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).send('Internal Server Error');
});

app.listen(port, () => {
  console.log(
    `[internal-app] listening on ${port} (mode=${settings.labMode}, httpOnly=${settings.cookieHttpOnly}, csp=${settings.enableCsp}, rawHtml=${settings.renderUnsafeHtml})`
  );
});
