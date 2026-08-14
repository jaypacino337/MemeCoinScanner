/**
 * Post-build smoke check.
 *
 * Asserts on rendered content, not just status codes: Next serves its error
 * boundary with HTTP 200, so a status-only check happily passes on a page whose
 * server render threw.
 */
const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

const PAGES = [
  { path: '/', expect: ['Dashboard', 'Top opportunities'] },
  { path: '/tiktok', expect: ['TikTok Radar', 'Filters'] },
  { path: '/instagram', expect: ['Instagram Radar', 'Filters'] },
  { path: '/x', expect: ['X Radar', 'Filters'] },
  { path: '/tiktok?animalsOnly=true&minViews=0', expect: ['TikTok Radar'] },
  { path: '/duplicate-checker', expect: ['duplicate checker', 'Viral subject'] },
  { path: '/saved', expect: ['Saved ideas'] },
  { path: '/rejected', expect: ['Rejected'] },
  { path: '/settings', expect: ['Data sources', 'Scoring model'] },
];

// Any of these in the HTML means a server render threw.
const FAILURE_MARKERS = [
  'Something went wrong',
  'Application error',
  'Internal Server Error',
  'An error occurred in the Server Components render',
];

/**
 * React separates adjacent text nodes with `<!-- -->` in server-rendered
 * markup, so `{label} Radar` reaches the wire as `TikTok<!-- --> Radar`.
 * Strip comments and collapse whitespace before matching on visible copy.
 */
function visibleText(html) {
  return html.replace(/<!--.*?-->/gs, '').replace(/\s+/g, ' ');
}

let failed = 0;

for (const page of PAGES) {
  const response = await fetch(base + page.path);
  const raw = await response.text();
  const html = visibleText(raw);
  const problems = [];

  if (response.status !== 200) problems.push(`HTTP ${response.status}`);
  for (const marker of FAILURE_MARKERS) {
    if (html.includes(marker)) problems.push(`error boundary rendered ("${marker}")`);
  }
  for (const needle of page.expect) {
    if (!html.toLowerCase().includes(needle.toLowerCase())) {
      problems.push(`missing expected content "${needle}"`);
    }
  }

  if (problems.length > 0) {
    failed += 1;
    console.error(`FAIL ${page.path}\n      ${problems.join('\n      ')}`);
  } else {
    console.log(`ok   ${page.path}`);
  }
}

// Detail page for whatever the feed currently ranks first.
const feed = await (await fetch(`${base}/api/feed?limit=1`)).json();
const first = feed.candidates?.[0];
if (!first) {
  console.error('FAIL /api/feed returned no candidates — run `npm run db:seed` first');
  failed += 1;
} else {
  const html = visibleText(await (await fetch(`${base}/idea/${first.id}`)).text());
  const problems = FAILURE_MARKERS.filter((m) => html.includes(m));
  if (!html.includes('Score breakdown')) problems.push('missing score breakdown');
  if (problems.length > 0) {
    failed += 1;
    console.error(`FAIL /idea/${first.id}\n      ${problems.join('\n      ')}`);
  } else {
    console.log(`ok   /idea/[id]`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} page(s) failed the smoke check.`);
  process.exit(1);
}
console.log('\nAll pages rendered without a server error.');
