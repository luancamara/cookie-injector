const rawEl = document.getElementById('raw');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');

const SAME_SITE = { none: 'no_restriction', lax: 'lax', strict: 'strict' };
const SS_TOKENS = ['strict', 'lax', 'none'];

function line(msg, cls) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.className = cls;
  logEl.appendChild(li);
}

// --- Persistência da última colagem (opcional) ------------------------------
const store = (chrome.storage && chrome.storage.local) || null;
if (store) {
  store.get('raw', (d) => { if (d && d.raw) rawEl.value = d.raw; });
  rawEl.addEventListener('input', () => store.set({ raw: rawEl.value }));
} else {
  statusEl.textContent = 'storage indisponível — recarregue a extensão (a colagem não será lembrada)';
}

// --- Parser do texto bruto do DevTools --------------------------------------
// Colunas (TAB): Name, Value, Domain, Path, Expires, Size, HttpOnly, Secure,
// SameSite, [Partition Key], Priority, ...
function parseRaw(raw) {
  const cookies = [];
  const warnings = [];

  for (let rawLine of raw.split('\n')) {
    const line = rawLine.replace(/^[\s,]+/, '').replace(/\s+$/, '');
    if (!line) continue;

    const isTab = line.includes('\t');
    const fields = (isTab ? line.split('\t') : line.split(/ {2,}/)).map(s => s.trim());
    if (fields.length < 4) continue;                 // não é linha de cookie

    const [name, value, domain, path] = fields;
    if (!name || name.toLowerCase() === 'name') continue;   // cabeçalho
    if (!domain || !domain.includes('.')) continue;         // sem domínio válido

    const expires = fields[4] || '';
    let httpOnly = false, secure = false, sameSite = null;

    if (isTab) {
      httpOnly = fields[6] === '✓' || /^true$/i.test(fields[6] || '');
      secure = fields[7] === '✓' || /^true$/i.test(fields[7] || '');
      const ss = (fields[8] || '').toLowerCase();
      if (SS_TOKENS.includes(ss)) sameSite = fields[8];
    } else {
      // Sem TABs as colunas vazias somem -> melhor esforço (pode errar HttpOnly).
      const rest = fields.slice(6);
      sameSite = rest.find(f => SS_TOKENS.includes(f.toLowerCase())) || null;
      const ticks = rest.filter(f => f === '✓').length;
      if (ticks >= 2) { httpOnly = true; secure = true; }
      else if (ticks === 1) { secure = true; }     // chute: 1 ✓ costuma ser Secure
      warnings.push(`Linha sem TAB (flags por aproximação): ${name}`);
    }

    // Regras dos prefixos
    if (name.startsWith('__Secure-') || name.startsWith('__Host-')) secure = true;

    let outPath = path || '/';
    let hostOnly;
    if (name.startsWith('__Host-')) {
      hostOnly = true;       // __Host- exige host-only + path "/"
      outPath = '/';
    } else {
      hostOnly = !domain.startsWith('.');   // sem ponto inicial => host-only
    }

    cookies.push({ name, value, domain, path: outPath, secure, httpOnly, sameSite, expires, hostOnly });
  }

  return { cookies, warnings };
}

// --- Injeção ----------------------------------------------------------------
async function setCookie(c) {
  const host = c.domain.replace(/^\./, '');
  const scheme = c.secure ? 'https://' : 'http://';
  const details = {
    url: scheme + host + (c.path || '/'),
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
  };
  if (!c.hostOnly) details.domain = c.domain;
  if (c.sameSite) {
    const ss = SAME_SITE[String(c.sameSite).toLowerCase()];
    if (ss) details.sameSite = ss;
  }
  if (c.expires && !/^session$/i.test(c.expires)) {
    const t = Date.parse(c.expires);
    if (!isNaN(t)) details.expirationDate = t / 1000;
  }
  return chrome.cookies.set(details);
}

async function inject() {
  logEl.innerHTML = '';
  const { cookies, warnings } = parseRaw(rawEl.value);
  warnings.forEach(w => line('⚠ ' + w, 'warn'));

  if (!cookies.length) {
    line('Nada para injetar — confira se colou as linhas (com TAB).', 'err');
    return;
  }

  statusEl.textContent = 'injetando…';
  let ok = 0, fail = 0;
  for (const c of cookies) {
    const where = c.name + ' @ ' + c.domain + c.path;
    try {
      const set = await setCookie(c);
      if (set) { ok++; line('✓ ' + where, 'ok'); }
      else {
        fail++;
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        line('✗ falhou (null): ' + where + (err ? ' — ' + err : ''), 'err');
      }
    } catch (e) {
      fail++;
      line('✗ ' + where + ' — ' + e.message, 'err');
    }
  }
  statusEl.textContent = `${ok} ok · ${fail} falha(s) · ${cookies.length} total`;
}

function preview() {
  logEl.innerHTML = '';
  const { cookies, warnings } = parseRaw(rawEl.value);
  warnings.forEach(w => line('⚠ ' + w, 'warn'));
  if (!cookies.length) { line('Nenhum cookie reconhecido.', 'err'); return; }
  cookies.forEach(c => {
    const flags = [c.secure && 'Secure', c.httpOnly && 'HttpOnly', c.sameSite, c.hostOnly && 'host-only']
      .filter(Boolean).join(', ');
    line(`${c.name} @ ${c.domain}${c.path} ${flags ? '[' + flags + ']' : ''}`, 'muted');
  });
  statusEl.textContent = `${cookies.length} cookie(s) reconhecido(s)`;
}

document.getElementById('inject').addEventListener('click', inject);
document.getElementById('parse').addEventListener('click', preview);
document.getElementById('clear').addEventListener('click', () => {
  rawEl.value = '';
  if (store) store.remove('raw');
  logEl.innerHTML = '';
  statusEl.textContent = '';
});
