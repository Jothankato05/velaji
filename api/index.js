// Vercel function: the compiled API from `npm run build` (dist/). All API
// routes are rewritten here by vercel.json; the web app is served statically.
module.exports = require('../dist/serverless').default;
