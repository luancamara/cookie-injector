const rawEl = document.getElementById('raw');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');

// Mostra a versão carregada (confirma que a extensão foi recarregada)
document.getElementById('version').textContent = 'v' + chrome.runtime.getManifest().version;

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
// Remove APENAS variantes conflitantes do MESMO host (host-only vs domínio, com/sem
// ponto) e SOMENTE depois que o novo cookie já foi gravado com sucesso. Nunca remove
// o cookie que acabamos de gravar. Isso evita destruir uma sessão existente quando o
// chrome.cookies.set falha (ex.: cookies __Host-, SameSite=None sem Secure, etc.).
async function removeConflictingVariants(name, host, path, justSetDomain) {
  let existing;
  try {
    existing = await chrome.cookies.getAll({ name, domain: host });
  } catch (_) {
    return;
  }
  const variants = new Set(['.' + host, host]);   // mesmo host, host-only e de-domínio
  for (const e of existing) {
    if (e.name !== name || e.path !== path) continue;
    if (e.domain === justSetDomain) continue;       // não remove o que acabamos de gravar
    if (!variants.has(e.domain)) continue;          // só variantes do mesmo host
    const eScheme = e.secure ? 'https://' : 'http://';
    try {
      await chrome.cookies.remove({ url: eScheme + e.domain.replace(/^\./, '') + e.path, name: e.name });
    } catch (_) { /* ignora falha de limpeza */ }
  }
}

async function setCookie(c) {
  const host = c.domain.replace(/^\./, '');
  const scheme = c.secure ? 'https://' : 'http://';
  const path = c.path || '/';
  const details = {
    url: scheme + host + path,
    name: c.name,
    value: c.value,
    path,
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
  // Grava primeiro — set() já sobrescreve um cookie de mesma identidade.
  const result = await chrome.cookies.set(details);
  // Só limpa variantes conflitantes se a gravação deu certo (não-destrutivo em falha).
  if (result) {
    await removeConflictingVariants(c.name, host, path, result.domain);
  }
  return result;
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

document.getElementById('pasteInject').addEventListener('click', async () => {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    logEl.innerHTML = '';
    line('Não consegui ler a área de transferência: ' + e.message, 'err');
    return;
  }
  if (!text || !text.trim()) {
    logEl.innerHTML = '';
    line('Área de transferência vazia — copie os cookies antes.', 'err');
    return;
  }
  rawEl.value = text;
  if (store) store.set({ raw: text });
  await inject();
});
document.getElementById('inject').addEventListener('click', inject);
document.getElementById('parse').addEventListener('click', preview);
document.getElementById('clear').addEventListener('click', () => {
  rawEl.value = '';
  if (store) store.remove('raw');
  logEl.innerHTML = '';
  statusEl.textContent = '';
});

// --- Leitura / exportação dos cookies deste perfil --------------------------
const domainsEl = document.getElementById('domains');
const readLogEl = document.getElementById('readLog');
const readStatusEl = document.getElementById('readStatus');
const exportedEl = document.getElementById('exported');
const showValuesEl = document.getElementById('showValues');

const SS_OUT = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: null };

// Domínios padrão + persistência da última lista digitada
if (store) {
  store.get('domains', (d) => {
    domainsEl.value = (d && d.domains) || 'google.com, atlassian.net, atlassian.com';
  });
  domainsEl.addEventListener('input', () => store.set({ domains: domainsEl.value }));
} else {
  domainsEl.value = 'google.com, atlassian.net, atlassian.com';
}

function parsedDomains() {
  return domainsEl.value.split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean);
}

async function collectCookies() {
  const domains = parsedDomains();
  const seen = new Set();
  const out = [];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    for (const c of cookies) {
      const key = c.name + '|' + c.domain + '|' + c.path;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  out.sort((a, b) => (a.domain + a.name).localeCompare(b.domain + b.name));
  return out;
}

function toExportFormat(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: SS_OUT[c.sameSite] ?? null,
    expirationDate: c.session ? 'session' : new Date(c.expirationDate * 1000).toISOString(),
    hostOnly: !!c.hostOnly,
  };
}

async function listCookies() {
  readLogEl.innerHTML = '';
  exportedEl.value = '';
  const domains = parsedDomains();
  if (!domains.length) { readLogEl.appendChild(liIn('Informe ao menos um domínio.', 'err')); return; }
  readStatusEl.textContent = 'lendo…';
  let cookies;
  try {
    cookies = await collectCookies();
  } catch (e) {
    readStatusEl.textContent = '';
    readLogEl.appendChild(liIn('Erro: ' + e.message, 'err'));
    return;
  }
  if (!cookies.length) {
    readLogEl.appendChild(liIn('Nenhum cookie encontrado para: ' + domains.join(', '), 'warn'));
    readStatusEl.textContent = '';
    return;
  }
  const showVals = showValuesEl.checked;
  for (const c of cookies) {
    const flags = [c.secure && 'Secure', c.httpOnly && 'HttpOnly', SS_OUT[c.sameSite], c.hostOnly && 'host-only']
      .filter(Boolean).join(', ');
    const val = showVals ? ' = ' + c.value : '';
    readLogEl.appendChild(liIn(`${c.name} @ ${c.domain}${c.path}${val} ${flags ? '[' + flags + ']' : ''}`, 'muted'));
  }
  readStatusEl.textContent = `${cookies.length} cookie(s) em ${domains.length} domínio(s)`;
}

async function exportCookies() {
  readStatusEl.textContent = 'exportando…';
  try {
    const cookies = await collectCookies();
    exportedEl.value = JSON.stringify(cookies.map(toExportFormat), null, 2);
    readStatusEl.textContent = `${cookies.length} cookie(s) exportado(s) — copie o JSON acima`;
  } catch (e) {
    readStatusEl.textContent = '';
    exportedEl.value = '';
    readLogEl.appendChild(liIn('Erro: ' + e.message, 'err'));
  }
}

function liIn(msg, cls) {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.className = cls;
  return li;
}

async function deleteCookies() {
  const domains = parsedDomains();
  if (!domains.length) {
    readLogEl.appendChild(liIn('Informe ao menos um domínio.', 'err'));
    return;
  }
  readLogEl.innerHTML = '';
  readStatusEl.textContent = 'excluindo…';
  let removed = 0, fail = 0;
  for (const domain of domains) {
    let cookies;
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch (e) {
      readLogEl.appendChild(liIn('Erro ao ler ' + domain + ': ' + e.message, 'err'));
      continue;
    }
    for (const c of cookies) {
      const scheme = c.secure ? 'https://' : 'http://';
      const url = scheme + c.domain.replace(/^\./, '') + c.path;
      try {
        const r = await chrome.cookies.remove({ url, name: c.name });
        if (r) { removed++; readLogEl.appendChild(liIn('🗑 ' + c.name + ' @ ' + c.domain + c.path, 'muted')); }
        else { fail++; readLogEl.appendChild(liIn('✗ não removido: ' + c.name + ' @ ' + c.domain + c.path, 'err')); }
      } catch (e) {
        fail++;
        readLogEl.appendChild(liIn('✗ ' + c.name + ' — ' + e.message, 'err'));
      }
    }
  }
  readStatusEl.textContent = `${removed} removido(s)` + (fail ? ` · ${fail} falha(s)` : '') + ` em ${domains.length} domínio(s)`;
}

// Confirmação em dois cliques para evitar exclusão acidental
const deleteBtn = document.getElementById('delete');
let deleteArmed = false, deleteTimer = null;
deleteBtn.addEventListener('click', () => {
  if (!deleteArmed) {
    deleteArmed = true;
    deleteBtn.textContent = 'Confirmar exclusão?';
    deleteTimer = setTimeout(() => {
      deleteArmed = false;
      deleteBtn.textContent = 'Excluir cookies';
    }, 4000);
    return;
  }
  clearTimeout(deleteTimer);
  deleteArmed = false;
  deleteBtn.textContent = 'Excluir cookies';
  deleteCookies();
});

document.getElementById('list').addEventListener('click', listCookies);
document.getElementById('export').addEventListener('click', exportCookies);
