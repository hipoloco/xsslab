function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }

  return res.redirect('/login');
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect('/admin');
  }

  return next();
}

module.exports = {
  requireAuth,
  redirectIfAuthenticated
};

