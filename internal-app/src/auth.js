const jwt = require('jsonwebtoken');

const TOKEN_STORAGE_KEY = 'gym_internal_token';

function appendToken(targetPath, token) {
  if (!token) {
    return targetPath;
  }

  const separator = targetPath.includes('?') ? '&' : '?';
  return `${targetPath}${separator}token=${encodeURIComponent(token)}`;
}

function extractBearerToken(headerValue) {
  if (!headerValue) {
    return null;
  }

  const normalized = String(headerValue).trim();
  if (!normalized.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  const token = normalized.slice(7).trim();
  return token || null;
}

function extractRequestToken(req) {
  const bearerToken = extractBearerToken(req.get('authorization'));
  if (bearerToken) {
    return bearerToken;
  }

  if (typeof req.query.token === 'string' && req.query.token.trim() !== '') {
    return req.query.token.trim();
  }

  return null;
}

function createAuthStateMiddleware(options) {
  return (req, res, next) => {
    const token = extractRequestToken(req);

    req.authToken = token;
    req.authUser = null;
    req.authError = null;

    if (token) {
      try {
        req.authUser = jwt.verify(token, options.secret);
      } catch (error) {
        req.authError = error;
      }
    }

    res.locals.currentUser = req.authUser;
    res.locals.authToken = req.authToken;
    res.locals.authStorageKey = TOKEN_STORAGE_KEY;
    res.locals.authPath = (targetPath) => appendToken(targetPath, req.authToken);

    next();
  };
}

function issueToken(user, options) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role
    },
    options.secret,
    {
      expiresIn: options.expiresIn
    }
  );
}

function requireAuth(req, res, next) {
  if (req.authUser) {
    return next();
  }

  return res.redirect('/login');
}

function redirectIfAuthenticated(req, res, next) {
  if (req.authUser) {
    return res.redirect(res.locals.authPath('/admin'));
  }

  return next();
}

module.exports = {
  TOKEN_STORAGE_KEY,
  appendToken,
  createAuthStateMiddleware,
  issueToken,
  requireAuth,
  redirectIfAuthenticated
};
