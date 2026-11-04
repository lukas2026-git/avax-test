// Netlify runtime environment, with a fallback for the standalone local server.
function env(name) {
  return globalThis.Netlify ? globalThis.Netlify.env.get(name) : process.env[name];
}
module.exports = { env };
