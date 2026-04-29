const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString
});

module.exports = {
  query(text, params) {
    return pool.query(text, params);
  }
};

