const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const port = Number(process.env.PUBLIC_PORT || 3000);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.render('index', {
    error: null,
    form: {
      full_name: '',
      email: '',
      phone: '',
      message: ''
    }
  });
});

app.post('/contact', async (req, res, next) => {
  const { full_name = '', email = '', phone = '', message = '' } = req.body;
  const form = {
    full_name,
    email,
    phone,
    message
  };

  if (!full_name.trim() || !email.trim() || !message.trim()) {
    return res.status(400).render('index', {
      error: 'Nombre, email y mensaje son obligatorios.',
      form
    });
  }

  try {
    await db.query(
      `INSERT INTO contact_messages (full_name, email, phone, message)
       VALUES ($1, $2, $3, $4)`,
      [full_name.trim(), email.trim(), phone.trim(), message]
    );

    return res.status(201).render('thanks', {
      fullName: full_name.trim()
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/health', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'public-app' });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error('[public-app] request failed', error);
  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).send('Internal Server Error');
});

app.listen(port, () => {
  console.log(`[public-app] listening on ${port}`);
});

