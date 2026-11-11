import assert from 'node:assert/strict';

const baseUrl = (process.env.VOXA_WEB_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const routes = [
  '/',
  '/login',
  '/discover',
  '/communities',
  '/creator/audience',
  '/admin/community-moderation',
  '/live',
];

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl + '/login');
      if (response.ok) return;
      lastError = new Error('Web server returned ' + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error('VOXA web server did not become ready: ' + String(lastError));
}

await waitForServer();

for (const route of routes) {
  const response = await fetch(baseUrl + route, { redirect: 'manual' });
  assert.equal(response.status, 200, route + ' should render (received ' + response.status + ')');
  const html = await response.text();
  assert.ok(html.includes('<html') || html.includes('<!DOCTYPE html'), route + ' should return an HTML document');
  process.stdout.write('PASS ' + route + '\n');
}
