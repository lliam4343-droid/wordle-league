/* global SHEET_CSV_URL, Chart */
let groupChart, playerChart;


const NAME_MAP = {
  "Danny - Denmark": "Danny",
  "Danny Denmark": "Danny",
  "Luis": "Luis",
  "Lliam Mckinnon": "Lliam",
  "Lliam McKinnon": "Lliam",
  "Jamie Marshall": "Jamie",
  "Barry Barry": "Barry Barry",
  "Dave White": "Dave"
};


function parseDateDMY(s) {
  // dd/mm/yy or dd/mm/yyyy
  const parts = (s || "").trim().split("/").map(x => x.trim());
  if (parts.length !== 3) return null;
  const d = Number(parts[0]), m = Number(parts[1]);
  let y = Number(parts[2]);
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
  if (y < 100) y = 2000 + y;
  return new Date(y, m - 1, d);
}

function isoWeekKey(dt) {
  // Returns YYYY-Www
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const y = d.getUTCFullYear();
  return `${y}-W${String(weekNo).padStart(2,"0")}`;
}

function monthKey(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[s]));
}

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function csvToRows(csvText) {
  // Simple CSV parsing (no quoted commas expected)
  const lines = csvText.trim().split(/\r?\n/);
  return lines.map(l => l.split(","));
}

function computeLeaderboard(items) {
  const byPlayer = new Map();
  for (const it of items) {
    if (!byPlayer.has(it.player)) byPlayer.set(it.player, { games:0, wins:0, fails:0, sum:0, best:Infinity, worst:0, twos:0, threes:0 });
    const p = byPlayer.get(it.player);
    p.games += 1;
    if (it.fail) p.fails += 1; else p.wins += 1;
    if (!it.fail) {
      p.sum += it.guesses;
      p.best = Math.min(p.best, it.guesses);
      p.worst = Math.max(p.worst, it.guesses);
      if (it.guesses === 2) p.twos += 1;
      if (it.guesses === 3) p.threes += 1;
    }
  }
  const rows = Array.from(byPlayer.entries()).map(([player,s]) => ({
    player, games:s.games, wins:s.wins, fails:s.fails,
    avg: s.wins ? (s.sum / s.wins) : 0,
    best: Number.isFinite(s.best) ? s.best : "-",
    worst: s.worst || "-",
    twos: s.twos, threes: s.threes
  }));
  rows.sort((a,b) => {
    if (a.avg !== b.avg) return a.avg - b.avg;
    if (a.fails !== b.fails) return a.fails - b.fails;
    return (a.best === "-" ? 999 : a.best) - (b.best === "-" ? 999 : b.best);
  });
  return rows;
}

function computeStreaks(items) {
  // items sorted by date then puzzle. streak based on consecutive days with win (per player)
  const byPlayer = new Map();
  for (const it of items) {
    if (!byPlayer.has(it.player)) byPlayer.set(it.player, []);
    byPlayer.get(it.player).push(it);
  }

  const out = new Map();
  for (const [player, arr] of byPlayer.entries()) {
    // Ensure chronological
    arr.sort((a,b) => a.dt - b.dt || a.puzzle - b.puzzle);

    let longest = 0, current = 0;
    let curStart = null;
    let lastDateKey = null;

    for (const it of arr) {
      const dk = it.dateKey;
      if (it.fail) {
        current = 0;
        curStart = null;
        lastDateKey = dk;
        continue;
      }
      // win
      if (current === 0) curStart = dk;
      // If there are gaps in days we still count streak as consecutive played days? Most groups play daily.
      // We'll treat streak as consecutive calendar days with a win, based on dateKey.
      if (lastDateKey && dk !== lastDateKey) {
        const lastDt = parseDateDMY(lastDateKey);
        const thisDt = parseDateDMY(dk);
        const diffDays = Math.round((thisDt - lastDt) / 86400000);
        if (diffDays > 1) {
          // break streak due to gap
          current = 0;
          curStart = dk;
        }
      }
      current += 1;
      longest = Math.max(longest, current);
      lastDateKey = dk;
    }

    // current streak ending latest date: compute from end backwards
    let cur = 0;
    let last = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const it = arr[i];
      if (it.fail) break;
      if (last) {
        const lastDt = parseDateDMY(last);
        const thisDt = parseDateDMY(it.dateKey);
        const diffDays = Math.round((lastDt - thisDt) / 86400000);
        if (diffDays > 1) break;
      }
      cur += 1;
      last = it.dateKey;
    }

    out.set(player, { longest, current: cur });
  }
  return out;
}

function renderMiniSummary(leaderboard, streaks) {
  const el = document.getElementById("miniSummary");
  if (!leaderboard.length) { el.innerHTML = ""; return; }
  const top = leaderboard[0];
  const groupAvg = leaderboard.reduce((s,r)=>s + (r.avg||0), 0) / leaderboard.length;
  const chips = [
    `👑 ${escapeHtml(top.player)} ${top.avg.toFixed(2)}`,
    `📊 Group avg ${groupAvg.toFixed(2)}`,
  ];
  // Add top current streak
  let bestStreak = { player: null, current: 0 };
  for (const r of leaderboard) {
    const st = streaks.get(r.player);
    if (st && st.current > bestStreak.current) bestStreak = { player: r.player, current: st.current };
  }
  if (bestStreak.player) chips.push(`🔥 Current streak: ${escapeHtml(bestStreak.player)} ${bestStreak.current}`);

  el.innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join("");
}

function renderLeaderboardTable(leaderboard, streaks) {
  const el = document.getElementById("leaderboard");
  let html = "<table><thead><tr>" +
    "<th class='rank'>#</th><th>Player</th><th>Avg</th><th>W</th><th>F</th><th>Best</th><th>Worst</th><th>🔥</th>" +
    "</tr></thead><tbody>";

  leaderboard.forEach((r, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : String(idx + 1);
    const st = streaks.get(r.player) || { current: 0, longest: 0 };
    html += "<tr>" +
      `<td class='rank'>${medal}</td>` +
      `<td>${escapeHtml(r.player)}</td>` +
      `<td><span class='badge'>${r.avg ? r.avg.toFixed(2) : "-"}</span></td>` +
      `<td>${r.wins}</td>` +
      `<td>${r.fails}</td>` +
      `<td>${r.best}</td>` +
      `<td>${r.worst}</td>` +
      `<td title="Current / Longest">${st.current}/${st.longest}</td>` +
      "</tr>";
  });

  html += "</tbody></table>";
  el.innerHTML = html;
}

function renderGroupAverage(items) {
  const byDate = new Map();
  for (const it of items) {
    if (it.fail) continue;
    if (!byDate.has(it.dateKey)) byDate.set(it.dateKey, []);
    byDate.get(it.dateKey).push(it.guesses);
  }
  const labels = Array.from(byDate.keys()).sort((a,b) => parseDateDMY(a) - parseDateDMY(b));
  const data = labels.map(d => {
    const arr = byDate.get(d) || [];
    return Math.round((arr.reduce((s,x)=>s+x,0)/(arr.length||1))*100)/100;
  });

  const ctx = document.getElementById("groupChart").getContext("2d");
  if (groupChart) groupChart.destroy();
  groupChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Group average", data, tension: 0.25 }] },
    options: { responsive:true, plugins:{ legend:{ display:true } }, scales:{ y:{ suggestedMin:2, suggestedMax:6 } } }
  });
}

function buildPlayerSelect(players) {
  const sel = document.getElementById("playerSelect");
  sel.innerHTML = players.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
}

function renderPlayerForm(items, player, windowSize) {
  const rows = items.filter(it => it.player === player && !it.fail).sort((a,b)=>a.dt-b.dt||a.puzzle-b.puzzle);
  const labels = rows.map(r => r.dateKey);
  const guesses = rows.map(r => r.guesses);

  // rolling average
  const roll = guesses.map((_, i) => {
    const start = Math.max(0, i - windowSize + 1);
    const slice = guesses.slice(start, i+1);
    const avg = slice.reduce((s,x)=>s+x,0)/slice.length;
    return Math.round(avg*100)/100;
  });

  const ctx = document.getElementById("playerChart").getContext("2d");
  if (playerChart) playerChart.destroy();
  playerChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Guesses", data: guesses, tension: 0.25 },
        { label: `Rolling avg (${windowSize})`, data: roll, tension: 0.25 }
      ]
    },
    options: { responsive:true, plugins:{ legend:{ display:true } }, scales:{ y:{ suggestedMin:2, suggestedMax:6 } } }
  });
}

function computePeriod(items, keyFn) {
  const byKey = new Map();
  for (const it of items) {
    const k = keyFn(it.dt);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(it);
  }
  const keys = Array.from(byKey.keys()).sort();
  return { keys, byKey };
}

function trophyCards(trophies) {
  return trophies.map(t => `
    <div class="trophy">
      <div class="name">${t.icon} ${escapeHtml(t.title)} — ${escapeHtml(t.winner || "—")}</div>
      <div class="desc">${escapeHtml(t.desc)}</div>
    </div>
  `).join("");
}

function renderPeriodView(periodKey, periodItems, outTrophiesEl, outTableEl) {
  const lb = computeLeaderboard(periodItems);
  const streaks = computeStreaks(periodItems);

  // Trophies:
  const king = lb.find(r => r.wins > 0) || null;
  const sniper = lb.slice().sort((a,b)=> (b.twos+b.threes) - (a.twos+a.threes))[0] || null;
  const brick = lb.slice().sort((a,b)=> b.fails - a.fails)[0] || null;

  let streakLord = { player: null, longest: 0 };
  for (const r of lb) {
    const st = streaks.get(r.player);
    if (st && st.longest > streakLord.longest) streakLord = { player: r.player, longest: st.longest };
  }

  const trophies = [
    { icon:"👑", title:"Wordle King", winner: king ? king.player : "", desc: king ? `Lowest avg: ${king.avg.toFixed(2)} (wins only)` : "—" },
    { icon:"🎯", title:"Sniper", winner: sniper ? sniper.player : "", desc: sniper ? `Most 2s+3s: ${(sniper.twos+sniper.threes)}` : "—" },
    { icon:"🧱", title:"Brick Wall", winner: brick ? brick.player : "", desc: brick ? `Most fails: ${brick.fails}` : "—" },
    { icon:"🔥", title:"Streak Lord", winner: streakLord.player || "", desc: streakLord.player ? `Longest streak: ${streakLord.longest}` : "—" },
  ];

  outTrophiesEl.innerHTML = trophyCards(trophies);

  // Table
  let html = "<table><thead><tr>" +
    "<th class='rank'>#</th><th>Player</th><th>Avg</th><th>W</th><th>F</th><th>Best</th><th>Worst</th><th>🔥</th>" +
    "</tr></thead><tbody>";
  lb.forEach((r, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : String(idx + 1);
    const st = streaks.get(r.player) || { current: 0, longest: 0 };
    html += "<tr>" +
      `<td class='rank'>${medal}</td>` +
      `<td>${escapeHtml(r.player)}</td>` +
      `<td><span class='badge'>${r.avg ? r.avg.toFixed(2) : "-"}</span></td>` +
      `<td>${r.wins}</td>` +
      `<td>${r.fails}</td>` +
      `<td>${r.best}</td>` +
      `<td>${r.worst}</td>` +
      `<td title="Current / Longest">${st.current}/${st.longest}</td>` +
      "</tr>";
  });
  html += "</tbody></table>";
  outTableEl.innerHTML = html;
}

function setupTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab"));
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tabpane").forEach(p => p.classList.add("hidden"));
      document.getElementById(`tab-${tab}`).classList.remove("hidden");
      buttons.forEach(b => b.setAttribute("aria-selected", b === btn ? "true" : "false"));
    });
  });
}

async function main() {
  setupTabs();

  if (!SHEET_CSV_URL) { setStatus("Missing SHEET_CSV_URL in config.js"); return; }
  setStatus("Fetching data…");

  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) { setStatus("Could not load sheet. Check Publish to web + CSV link."); return; }
  const csv = await res.text();
  const rows = csvToRows(csv);

  // Expect header: Date,Puzzle,Player,Guesses,Result
  const body = rows.slice(1).filter(r => r.length >= 5);

  const items = body.map(r => {
    const dateKey = (r[0] || "").trim();
    const dt = parseDateDMY(dateKey);
    const puzzle = safeNum((r[1] || "").trim());
    let player = (r[2] || "").trim();
    if (NAME_MAP[player]) player = NAME_MAP[player];
    const guesses = safeNum((r[3] || "").trim());
    const result = (r[4] || "").trim().toLowerCase();
    const fail = result === "fail" || guesses === 0;
    return { dateKey, dt, puzzle, player, guesses: fail ? 0 : guesses, fail };
  }).filter(it => it.dt && it.player);

  items.sort((a,b) => a.dt - b.dt || a.puzzle - b.puzzle || a.player.localeCompare(b.player));

  if (!items.length) { setStatus("No data found yet."); return; }

  const leaderboard = computeLeaderboard(items);
  const streaks = computeStreaks(items);

  renderMiniSummary(leaderboard, streaks);
  renderLeaderboardTable(leaderboard, streaks);
  renderGroupAverage(items);

  // Form tab
  const players = leaderboard.map(r => r.player);
  buildPlayerSelect(players);
  const playerSelect = document.getElementById("playerSelect");
  const rollingSelect = document.getElementById("rollingSelect");
  const updateForm = () => renderPlayerForm(items, playerSelect.value, Number(rollingSelect.value));
  playerSelect.addEventListener("change", updateForm);
  rollingSelect.addEventListener("change", updateForm);
  updateForm();

  // Weekly
  const weekly = computePeriod(items, dt => isoWeekKey(dt));
  const weekSelect = document.getElementById("weekSelect");
  weekSelect.innerHTML = weekly.keys.map(k => `<option value="${k}">${k}</option>`).join("");
  const weeklyTrophiesEl = document.getElementById("weeklyTrophies");
  const weeklyTableEl = document.getElementById("weeklyTable");
  const updateWeekly = () => {
    const k = weekSelect.value;
    renderPeriodView(k, weekly.byKey.get(k) || [], weeklyTrophiesEl, weeklyTableEl);
  };
  weekSelect.addEventListener("change", updateWeekly);
  updateWeekly();

  // Monthly
  const monthly = computePeriod(items, dt => monthKey(dt));
  const monthSelect = document.getElementById("monthSelect");
  monthSelect.innerHTML = monthly.keys.map(k => `<option value="${k}">${k}</option>`).join("");
  const monthlyTrophiesEl = document.getElementById("monthlyTrophies");
  const monthlyTableEl = document.getElementById("monthlyTable");
  const updateMonthly = () => {
    const k = monthSelect.value;
    renderPeriodView(k, monthly.byKey.get(k) || [], monthlyTrophiesEl, monthlyTableEl);
  };
  monthSelect.addEventListener("change", updateMonthly);
  updateMonthly();

  setStatus("Updated.");
}

main().catch(err => {
  console.error(err);
  setStatus("Error loading data. Check your CSV link + publish settings.");
});
