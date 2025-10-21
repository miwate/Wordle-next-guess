// Main Application

// ==================== DATA & STATE ====================
let answers = [];
let guesses = [];
let history = [];

// ==================== DOM HELPERS ====================
const el = id => document.getElementById(id);

function escapeHtml(s = '') {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================== WORD LIST MANAGEMENT ====================
function parseWordList(text) {
    return text.split(/[\r\n]+/)
        .map(s => s.trim().toLowerCase())
        .filter(w => /^[a-z]{5}$/.test(w));
}

function relUrl(file) {
    return new URL(file, window.location.href).toString();
}

async function tryAutoLoad() {
    const loadStatus = el('loadStatus');
    loadStatus.textContent = 'Trying to fetch answers.txt & guesses.txt (relative to this page)';
    try {
        const [aResp, gResp] = await Promise.all([
            fetch(relUrl('answers.txt')),
            fetch(relUrl('guesses.txt'))
        ]);
        if (!aResp.ok || !gResp.ok) throw new Error('not found');
        const [aTxt, gTxt] = await Promise.all([aResp.text(), gResp.text()]);
        answers = parseWordList(aTxt);
        guesses = parseWordList(gTxt);
        onListsLoaded();
    } catch (e) {
        loadStatus.textContent = 'Auto-load failed : upload files or paste lists.';
    }
}

function onListsLoaded() {
    el('candidateCount').textContent = answers.length;
    el('loadStatus').textContent = `Loaded ${answers.length} answers and ${guesses.length} guesses.`;
    renderCandidatesPreview();
}

// ==================== OPENERS LOADING ====================
async function loadOpeners() {
    const container = el('openersSection');
    const ROWS = 3;
    const COLS = 7;
    const TOTAL = ROWS * COLS;

    const candidateFiles = [relUrl('best_openers.txt')];

    try {
        let bestResp = null;
        for (const url of candidateFiles) {
            const r = await fetch(url);
            if (r.ok) {
                bestResp = r;
                break;
            }
        }
        if (!bestResp) throw new Error("No best_openers file found");

        const bestTxt = await bestResp.text();

        const parseLines = txt => {
            return txt.trim()
                .split(/[\r\n]+/)
                .map(line => {
                    const parts = line.trim().split(/\s+/);
                    const word = parts[0] ?? '';
                    const entropy = parts[1] ?? '';
                    return { word, entropy };
                })
                .filter(x => x.word);
        };

        const entries = parseLines(bestTxt);

        let tableHtml = `
<div class="grid-wrap">
  <div class="muted">Best openers with entropy score (higher is better) - ${Math.min(entries.length, TOTAL)} shown</div>
  <table class="openers-grid" role="table" aria-label="Best openers">
    <tbody>`;

        for (let r = 0; r < ROWS; r++) {
            tableHtml += '<tr>';
            for (let c = 0; c < COLS; c++) {
                const idx = r * COLS + c;
                if (idx < entries.length) {
                    const e = entries[idx];
                    tableHtml += `<td>
                      <span class="openers-cell-word">${escapeHtml(e.word)}</span>
                      ${e.entropy ? `<span class="openers-cell-entropy">${escapeHtml(e.entropy)}</span>` : ''}
                    </td>`;
                } else {
                    tableHtml += `<td></td>`;
                }
            }
            tableHtml += '</tr>';
        }

        tableHtml += '</tbody></table></div>';
        container.innerHTML = tableHtml;
    } catch (e) {
        container.innerHTML = `<div class="bad">Failed to load openers: ${escapeHtml(e.message)}</div>`;
    }
}

// ==================== WORDLE SOLVER CORE ====================
function feedback(guess, solution) {
    guess = guess.toLowerCase();
    solution = solution.toLowerCase();
    const res = ['b', 'b', 'b', 'b', 'b'];
    const solCount = {};
    for (const ch of solution) solCount[ch] = (solCount[ch] || 0) + 1;
    
    // greens
    for (let i = 0; i < 5; i++) {
        if (guess[i] === solution[i]) {
            res[i] = 'g';
            solCount[guess[i]] = (solCount[guess[i]] || 0) - 1;
        }
    }
    
    // yellows
    for (let i = 0; i < 5; i++) {
        if (res[i] === 'b' && (solCount[guess[i]] || 0) > 0) {
            res[i] = 'y';
            solCount[guess[i]] = solCount[guess[i]] - 1;
        }
    }
    return res.join('');
}

function consistentWithFeedback(word, guess, pattern) {
    return feedback(guess, word) === pattern;
}

function narrowCandidates(history) {
    let pool = answers.slice();
    for (const [guess, pat] of history) {
        pool = pool.filter(w => consistentWithFeedback(w, guess, pat));
    }
    return pool;
}

function entropy(guess, pool) {
    const buckets = new Map();
    for (const sol of pool) {
        const pat = feedback(guess, sol);
        buckets.set(pat, (buckets.get(pat) || 0) + 1);
    }
    const total = pool.length;
    let ent = 0;
    for (const count of buckets.values()) {
        const p = count / total;
        ent -= p * Math.log2(p);
    }
    return ent;
}

async function rankGuesses(pool, allGuesses, topk = 15, onlyAnswers = false, onProgress = null) {
    let searchSpace;
    if (onlyAnswers) {
        searchSpace = pool.slice();
    } else {
        const setPool = new Set(pool);
        searchSpace = pool.slice();
        for (const g of allGuesses) if (!setPool.has(g)) searchSpace.push(g);
    }

    const scored = [];
    const n = searchSpace.length;
    for (let i = 0; i < n; i++) {
        const g = searchSpace[i];
        if (!/^[a-z]{5}$/.test(g)) continue;
        const score = entropy(g, pool);
        scored.push({ score, g });
        if (onProgress && (i % 50 === 0)) onProgress(i, n);
        if (i % 800 === 0) await new Promise(r => setTimeout(r, 0));
    }
    scored.sort((a, b) => b.score - a.score || a.g.localeCompare(b.g));
    return scored.slice(0, topk);
}

// ==================== UI RENDERING ====================
function renderCandidatesPreview(list = null) {
    const box = el('candidatesBox');
    const arr = list || answers;
    if (!arr || arr.length === 0) {
        box.textContent = '---';
        el('candidateCount').textContent = 0;
        return;
    }
    el('candidateCount').textContent = arr.length;
    const showAll = el('showAllCandidates').checked;
    const items = showAll ? arr : arr.slice(0, 80);
    box.innerHTML = items.map(w => `<span class="chip" style="margin:4px;display:inline-block">${w}</span>`).join('');
    if (!showAll && arr.length > 80) {
        box.insertAdjacentHTML('beforeend', `<div class="muted" style="margin-top:8px">Showing 80 of ${arr.length} candidates</div>`);
    }
}

function renderHistory() {
    const container = el('historyList');
    if (history.length === 0) {
        container.innerHTML = '<div class="muted">No guesses yet</div>';
        return;
    }
    container.innerHTML = '';
    history.forEach((hp, idx) => {
        const row = document.createElement('div');
        row.className = 'hist-row';
        row.innerHTML = `
      <div class="chip">${hp.guess}</div>
      <div class="chip">${hp.pattern}</div>
      <div style="flex:1" class="muted">pattern for ${hp.guess}</div>
      <button class="copy-btn" data-idx="${idx}">✂</button>
      <button class="copy-btn" data-del="${idx}">🗑</button>
    `;
        container.appendChild(row);
    });
    
    container.querySelectorAll('[data-idx]').forEach(btn => btn.onclick = e => {
        const idx = +e.currentTarget.dataset.idx;
        navigator.clipboard?.writeText(`${history[idx].guess} ${history[idx].pattern}`).then(() => {
            e.currentTarget.textContent = '✓';
            setTimeout(() => e.currentTarget.textContent = '✂', 700);
        });
    });
    
    container.querySelectorAll('[data-del]').forEach(btn => btn.onclick = e => {
        const idx = +e.currentTarget.dataset.del;
        history.splice(idx, 1);
        renderHistory();
    });
}

// ==================== EVENT HANDLERS ====================
function setupEventListeners() {
    el('tryAuto').addEventListener('click', tryAutoLoad);

    el('answersFile').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (!f) return;
        const txt = await f.text();
        answers = parseWordList(txt);
        if (!guesses.length) guesses = answers.slice();
        onListsLoaded();
    });

    el('guessesFile').addEventListener('change', async e => {
        const f = e.target.files[0];
        if (!f) return;
        const txt = await f.text();
        guesses = parseWordList(txt);
        if (!answers.length) answers = guesses.slice();
        onListsLoaded();
    });

    el('addHistory').addEventListener('click', () => {
        const g = el('guessInput').value.trim().toLowerCase();
        const p = el('patternInput').value.trim().toLowerCase();
        if (!/^[a-z]{5}$/.test(g)) {
            alert('Guess must be 5 letters');
            return;
        }
        if (!/^[gyb]{5}$/.test(p)) {
            alert('Pattern must be 5 chars of g/y/b');
            return;
        }
        history.push({ guess: g, pattern: p });
        el('guessInput').value = '';
        el('patternInput').value = '';
        renderHistory();
    });

    el('compute').addEventListener('click', async () => {
        if (!answers.length) {
            alert('No answers loaded --- upload, paste, or add answers.txt to the repo and click Auto-load.');
            return;
        }
        const onlyAnswers = el('onlyAnswers').checked;
        const hist = history.map(h => [h.guess, h.pattern]);
        let pool = narrowCandidates(hist);
        renderCandidatesPreview(pool);
        
        const resultsArea = el('resultsArea');
        
        // Don't compute suggestions if only 2 or fewer candidates remain
        if (pool.length <= 2) {
            el('topBox').textContent = pool.length === 0 ? 'No candidates remain' : 
                pool.length === 1 ? `Only 1 candidate: ${pool[0]}` : 
                `Only 2 candidates: ${pool[0]}, ${pool[1]}`;
            resultsArea.innerHTML = '<div class="muted">Too few candidates to suggest guesses. Just pick one!</div>';
            return;
        }
        
        el('topBox').innerHTML = '<span class="spinner"></span> Computing';
        const allGuesses = (guesses.length ? guesses : answers);
        const scored = await rankGuesses(pool, allGuesses, 40, onlyAnswers, (i, n) => {
            el('topBox').innerHTML = `<span class="spinner"></span> processing ${i}/${n}`;
        });
        
        if (!scored.length) {
            resultsArea.innerHTML = '<div class="muted">No suggested guesses (empty search space).</div>';
            el('topBox').textContent = '---';
            return;
        }
        
        el('topBox').innerHTML = scored.slice(0, 6).map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
    <div><span class="result-word">${s.g}</span> <span class="muted">entropy: ${s.score.toFixed(2)}</span></div>
    <div><button class="copy-btn" data-copy="${s.g}">copy</button></div>
  </div>`).join('');
        
        el('topBox').querySelectorAll('[data-copy]').forEach(b => b.onclick = e => {
            navigator.clipboard?.writeText(e.currentTarget.dataset.copy);
            e.currentTarget.textContent = '✓';
            setTimeout(() => e.currentTarget.textContent = 'copy', 600);
        });

        resultsArea.innerHTML = `<table>
    <thead><tr><th>Rank</th><th>Guess</th><th>Entropy</th><th>Action</th></tr></thead>
    <tbody>${scored.map((s, idx) => `<tr><td>${idx + 1}</td><td class="result-word">${s.g}</td><td>${s.score.toFixed(2)}</td><td><button class="copy-btn" data-copy="${s.g}">copy</button></td></tr>`).join('')}</tbody>
  </table>`;
        
        resultsArea.querySelectorAll('[data-copy]').forEach(b => b.onclick = e => {
            navigator.clipboard?.writeText(e.currentTarget.dataset.copy);
            e.currentTarget.textContent = '✓';
            setTimeout(() => e.currentTarget.textContent = 'copy', 600);
        });
    });

    el('reset').addEventListener('click', () => {
        history = [];
        renderHistory();
        el('resultsArea').innerHTML = '';
        el('topBox').textContent = '---';
        renderCandidatesPreview(answers);
    });
}

// ==================== THEME MANAGEMENT ====================
function setupTheme() {
    const themes = [
        { bg: "#f6fff8", card: "#ffffff", muted: "#5f6f61", accent1: "#34d399", accent2: "#10b981", stroke: "rgba(16,38,30,0.06)", text: "#1b3324", chip: "#e6fdf3" },
        { bg: "#fff8fb", card: "#ffffff", muted: "#7b6f88", accent1: "#f472b6", accent2: "#c084fc", stroke: "rgba(30,16,38,0.06)", text: "#2b2540", chip: "#fff0f7" }
    ];

    const lightTheme = themes[1]; // Purple
    const darkTheme = {
        bg: "#1e1e1e",
        card: "#252526",
        muted: "#858585",
        accent1: "#c586c0",
        accent2: "#569cd6",
        stroke: "#3c3c3c",
        text: "#d4d4d4",
        chip: "#2d2d2d"
    };

    const root = document.documentElement;
    const btn = el('themeToggle');

    function applyTheme(themeObj) {
        Object.entries(themeObj).forEach(([key, value]) => {
            root.style.setProperty(`--${key}`, value);
        });
    }

    function updateButton(mode) {
        if (mode === 'dark') {
            btn.textContent = '☀️';
            btn.setAttribute('aria-pressed', 'true');
            btn.setAttribute('aria-label', 'Switch to light mode');
        } else {
            btn.textContent = '🌙';
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', 'Switch to dark mode');
        }
    }

    // Determine initial mode
    let saved = localStorage.getItem('color-mode');
    let initialMode;
    if (saved === 'dark' || saved === 'light') initialMode = saved;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) initialMode = 'dark';
    else initialMode = 'light';

    // Apply initial theme
    applyTheme(initialMode === 'dark' ? darkTheme : lightTheme);
    updateButton(initialMode);

    // Toggle handler
    btn.addEventListener('click', () => {
        const next = btn.getAttribute('aria-pressed') === 'true' ? 'light' : 'dark';
        applyTheme(next === 'dark' ? darkTheme : lightTheme);
        updateButton(next);
        localStorage.setItem('color-mode', next);
    });
}

// ==================== INITIALIZATION ====================
window.addEventListener('load', () => {
    tryAutoLoad();
    renderHistory();
    loadOpeners();
});

document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    setupTheme();
});