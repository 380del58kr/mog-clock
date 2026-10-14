// 정기 업무("🌿 정기 업무" DB)의 "이번 회차 완료" 체크를 새 회차가 시작될 때 자동으로 해제한다.
//  - 매주 월요일(한국 시간)  : 반복이 "매주"인 항목
//  - 매월 1일(한국 시간)     : 반복이 "매달"인 항목
// 환경 변수: NOTION_TOKEN(필수), NOTION_DB_ID, MODE(auto|weekly|monthly|both), NOW_ISO(테스트용), NOTION_API_BASE(테스트용)
const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_DB_ID || '641c1e1d2ece4434b12a868ded07ee91';
const BASE = process.env.NOTION_API_BASE || 'https://api.notion.com/v1';
const MODE = (process.env.MODE || 'auto').trim() || 'auto';
const CHECK_PROP = '이번 회차 완료';
const KIND_PROP = '반복';

if (!TOKEN) {
  console.log('::warning::NOTION_TOKEN 시크릿이 없어 건너뜁니다. 저장소 Settings > Secrets and variables > Actions 에 NOTION_TOKEN 을 추가하세요.');
  process.exit(0);
}

const kst = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
const parts = {};
for (const p of kst.formatToParts(process.env.NOW_ISO ? new Date(process.env.NOW_ISO) : new Date())) parts[p.type] = p.value;
const isMonday = parts.weekday === 'Mon';
const isFirst = parts.day === '01';
const doWeekly = MODE === 'weekly' || MODE === 'both' || (MODE === 'auto' && isMonday);
const doMonthly = MODE === 'monthly' || MODE === 'both' || (MODE === 'auto' && isFirst);
console.log(`KST ${parts.year}-${parts.month}-${parts.day} (${parts.weekday}) mode=${MODE} weekly=${doWeekly} monthly=${doMonthly}`);
if (!doWeekly && !doMonthly) { console.log('오늘은 초기화할 회차가 없습니다.'); process.exit(0); }

async function api(method, path, body, attempt = 1) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const wait = (Number(res.headers.get('retry-after')) || 2 * attempt) * 1000;
    console.log(`재시도(${attempt}) ${res.status}, ${wait}ms 대기`);
    await new Promise((r) => setTimeout(r, wait));
    return api(method, path, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const rows = [];
let cursor;
do {
  const r = await api('POST', `/databases/${DB}/query`, {
    filter: { property: CHECK_PROP, checkbox: { equals: true } },
    page_size: 100,
    ...(cursor ? { start_cursor: cursor } : {}),
  });
  rows.push(...r.results);
  cursor = r.has_more ? r.next_cursor : undefined;
} while (cursor);

let reset = 0;
for (const page of rows) {
  const kind = page.properties?.[KIND_PROP]?.select?.name || '';
  const title = (page.properties?.['루틴']?.title || []).map((t) => t.plain_text).join('') || '(제목 없음)';
  const hit = (doWeekly && kind.includes('매주')) || (doMonthly && kind.includes('매달'));
  if (!hit) continue;
  await api('PATCH', `/pages/${page.id}`, { properties: { [CHECK_PROP]: { checkbox: false } } });
  reset++;
  console.log(`해제: [${kind}] ${title}`);
}
console.log(reset ? `완료: ${reset}개 해제` : '해제할 항목 없음');
