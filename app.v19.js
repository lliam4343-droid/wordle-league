/* global SHEET_CSV_URL, Chart */
let groupChart, playerChart;

const APP_VERSION = "v19";


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

// Fixed league roster (used for missed-day fails and to avoid duplicate name variants)
const ROSTER = ["Danny","Luis","Lliam","Jamie","Barry Barry","Dave"];

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}



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
    if (!byPlayer.has(it.player)) byPlayer.set(it.player, { games:0, wins:0, fails:0, sum:0, best:Infinity, worst:0, twos:0, threes:0, ones:0, fours:0, fives:0, sixes:0 });
    const p = byPlayer.get(it.player);
    p.games += 1;
    // Total guesses counts fails as 7
    p.totalGuesses = (p.totalGuesses || 0) + (it.fail ? 7 : it.guesses);
    // Count results by guess number
    if (it.fail) {
      // fail count already tracked in p.fails
    } else {
      if (it.guesses === 1) p.ones += 1;
      else if (it.guesses === 2) p.twos += 1;
      else if (it.guesses === 3) p.threes += 1;
      else if (it.guesses === 4) p.fours += 1;
      else if (it.guesses === 5) p.fives += 1;
      else if (it.guesses === 6) p.sixes += 1;
    }
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
    totalGuesses: s.totalGuesses || 0,
    player, games:s.games, wins:s.wins, fails:s.fails,
    avg: s.wins ? (s.sum / s.wins) : 0,
    avgWithFails: s.games ? ((s.sum + (s.fails * 7)) / s.games) : 0,
    best: Number.isFinite(s.best) ? s.best : "-",
    worst: (s.fails > 0 ? "X" : (s.worst || "-")),
    ones: s.ones, twos: s.twos, threes: s.threes, fours: s.fours, fives: s.fives, sixes: s.sixes
  }));
  rows.sort((a,b) => {
    // Overall ranking uses fail-inclusive avg (fail counts as 7)
    const av = (a.avgWithFails ?? a.avg ?? 0);
    const bv = (b.avgWithFails ?? b.avg ?? 0);
    if (av !== bv) return av - bv;
    if ((a.fails||0) !== (b.fails||0)) return (a.fails||0) - (b.fails||0);
    return ((a.best === "-" ? 999 : a.best) - (b.best === "-" ? 999 : b.best));
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
  const groupAvg = leaderboard.reduce((s,r)=>s + (r.avgWithFails||r.avg||0), 0) / leaderboard.length;
  const chips = [
    `👑 ${escapeHtml(top.player)} ${(top.avgWithFails||top.avg||0).toFixed(2)}`,
    `📊 Group avg ${groupAvg.toFixed(2)}`,
  ];
  // Add current streak leaders (handles ties)
  let maxCur = 0;
  for (const r of leaderboard) {
    const st = streaks.get(r.player);
    if (st && st.current > maxCur) maxCur = st.current;
  }
  if (maxCur > 0) {
    const leaders = leaderboard
      .map(r => ({ p: r.player, st: streaks.get(r.player) }))
      .filter(x => x.st && x.st.current === maxCur)
      .map(x => x.p);
    const shown = leaders.slice(0, 3).map(p => escapeHtml(p)).join(", ");
    const more = leaders.length > 3 ? ` +${leaders.length - 3}` : "";
    chips.push(`🔥 Current streak leaders: ${shown}${more} (${maxCur})`);
  }

  el.innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join("");
}

function renderLeaderboardTable(leaderboard, streaks) {
  const el = document.getElementById("leaderboard");
  let html = "<table><thead><tr>" +
    "<th class='rank'>#</th><th>Player</th><th>Avg</th><th>Total</th><th>6</th><th>5</th><th>4</th><th>3</th><th>2</th><th>1</th><th>Fail</th><th>W</th><th>Best</th><th>Worst</th><th>🔥</th>" +
    "</tr></thead><tbody>";

  leaderboard.forEach((r, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : String(idx + 1);
    const st = streaks.get(r.player) || { current: 0, longest: 0 };
    html += "<tr>" +
      `<td class='rank'>${medal}</td>` +
      `<td>${escapeHtml(r.player)}</td>` +
      `<td><span class='badge'>${(r.avgWithFails || r.avg) ? (r.avgWithFails || r.avg).toFixed(2) : "-"}</span></td>` +
      `<td>${r.totalGuesses}</td>` +
      `<td>${r.sixes||0}</td>` +
      `<td>${r.fives||0}</td>` +
      `<td>${r.fours||0}</td>` +
      `<td>${r.threes||0}</td>` +
      `<td>${r.twos||0}</td>` +
      `<td>${r.ones||0}</td>` +
      `<td>${r.fails||0}</td>` +
      `<td>${r.wins}</td>` +
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



function computeHallOfFame(items) {
  const lb = computeLeaderboard(items);
  const streaks = computeStreaks(items);

  const leadersBy = (arr, valueFn) => {
    let best = -Infinity;
    for (const x of arr) best = Math.max(best, valueFn(x));
    const leaders = arr.filter(x => valueFn(x) === best && best > 0).map(x => x.player);
    return { best, leaders };
  };

  // All-time King = lowest fail-inclusive avg (fails count as 7)
  const sortedByKing = lb.slice().sort((a,b)=> (a.avgWithFails||0) - (b.avgWithFails||0));
  const kingAvg = sortedByKing.length ? (sortedByKing[0].avgWithFails||0) : 0;
  const kingLeaders = sortedByKing.filter(r => (r.avgWithFails||0) === kingAvg && kingAvg > 0).map(r => r.player);

  // Most wins (ties allowed)
  const mostWins = leadersBy(lb, r => r.wins || 0);

  // Best single solve (min guesses) and who did it most
  let bestSolve = { guesses: 99, players: new Map() };
  for (const it of items) {
    if (it.fail) continue;
    if (it.guesses < bestSolve.guesses) {
      bestSolve.guesses = it.guesses;
      bestSolve.players = new Map([[it.player, 1]]);
    } else if (it.guesses === bestSolve.guesses) {
      bestSolve.players.set(it.player, (bestSolve.players.get(it.player) || 0) + 1);
    }
  }
  let bestSolveCount = 0;
  for (const c of bestSolve.players.values()) bestSolveCount = Math.max(bestSolveCount, c);
  const bestSolveLeaders = Array.from(bestSolve.players.entries())
    .filter(([p,c]) => c === bestSolveCount && bestSolveCount > 0)
    .map(([p]) => p);

  // Most 2s / 3s (ties allowed)
  const most2s = leadersBy(lb, r => r.twos || 0);
  const most3s = leadersBy(lb, r => r.threes || 0);

  // Longest streak overall (ties allowed)
  let maxLongest = 0;
  for (const r of lb) {
    const st = streaks.get(r.player);
    if (st && st.longest > maxLongest) maxLongest = st.longest;
  }
  const streakLeaders = lb
    .map(r => ({ player: r.player, st: streaks.get(r.player) }))
    .filter(x => x.st && x.st.longest === maxLongest && maxLongest > 0)
    .map(x => x.player);

  // Consistency: lowest standard deviation (fails=7 in Avg & Total) minimum N wins
  const winsByPlayer = new Map();
  for (const it of items) {
    if (it.fail) continue;
    if (!winsByPlayer.has(it.player)) winsByPlayer.set(it.player, []);
    winsByPlayer.get(it.player).push(it.guesses);
  }
  let mostConsistent = { player: null, sd: Infinity, n: 0 };
  for (const [p, arr] of winsByPlayer.entries()) {
    if (arr.length < 5) continue;
    const mean = arr.reduce((s,x)=>s+x,0)/arr.length;
    const varr = arr.reduce((s,x)=>s + Math.pow(x-mean,2),0)/arr.length;
    const sd = Math.sqrt(varr);
    if (sd < mostConsistent.sd) mostConsistent = { player: p, sd, n: arr.length };
  }

  // Hardest puzzle (highest group avg, wins only)
  const byPuzzle = new Map();
  for (const it of items) {
    if (it.fail) continue;
    if (!byPuzzle.has(it.puzzle)) byPuzzle.set(it.puzzle, []);
    byPuzzle.get(it.puzzle).push(it.guesses);
  }
  let hardest = { puzzle: null, avg: 0 };
  for (const [pz, arr] of byPuzzle.entries()) {
    const avg = arr.reduce((s,x)=>s+x,0)/arr.length;
    if (avg > hardest.avg) hardest = { puzzle: pz, avg };
  }

  // Most fails (ties allowed)
  const mostFails = (() => {
    let maxF = 0;
    for (const r of lb) maxF = Math.max(maxF, r.fails || 0);
    const leaders = lb.filter(r => (r.fails||0) === maxF && maxF > 0).map(r => r.player);
    return { best: maxF, leaders };
  })();

  return {
    king: { avg: kingAvg, leaders: kingLeaders },
    mostWins,
    bestSolve: { guesses: bestSolve.guesses === 99 ? null : bestSolve.guesses, leaders: bestSolveLeaders, count: bestSolveCount },
    most2s,
    most3s,
    streak: { longest: maxLongest, leaders: streakLeaders },
    mostConsistent: mostConsistent.player ? mostConsistent : null,
    hardest,
    mostFails
  };
}


function renderHallOfFame(hof) {
  const cardsEl = document.getElementById("hofCards");
  const tableEl = document.getElementById("hofTable");
  if (!cardsEl || !tableEl) return;

  const joinNames = (arr) => (arr && arr.length ? arr.join(", ") : "");
  const cards = [
    { icon:"👑", title:"All-time King", winner: joinNames(hof.king.leaders), desc: hof.king.avg ? `Best avg (fails=7): ${hof.king.avg.toFixed(2)}` : "—" },
    { icon:"🏅", title:"Most Wins", winner: joinNames(hof.mostWins.leaders), desc: hof.mostWins.best ? `Wins: ${hof.mostWins.best}` : "—" },
    { icon:"✨", title:"Best Single Solve", winner: joinNames(hof.bestSolve.leaders), desc: hof.bestSolve.guesses ? `${hof.bestSolve.guesses}-guess solves: ${hof.bestSolve.count}` : "—" },
    { icon:"2️⃣", title:"Most 2s", winner: joinNames(hof.most2s.leaders), desc: hof.most2s.best ? `2s: ${hof.most2s.best}` : "—" },
    { icon:"3️⃣", title:"Most 3s", winner: joinNames(hof.most3s.leaders), desc: hof.most3s.best ? `3s: ${hof.most3s.best}` : "—" },
    { icon:"🔥", title:"Streak Lord", winner: joinNames(hof.streak.leaders), desc: hof.streak.longest ? `Longest streak: ${hof.streak.longest}` : "—" },
    { icon:"🎯", title:"Most Consistent", winner: hof.mostConsistent ? hof.mostConsistent.player : "", desc: hof.mostConsistent ? `SD: ${hof.mostConsistent.sd.toFixed(2)} over ${hof.mostConsistent.n} wins` : "Need 5+ wins" },
    { icon:"😈", title:"Hardest Puzzle", winner: hof.hardest.puzzle ? `#${hof.hardest.puzzle}` : "", desc: hof.hardest.puzzle ? `Group avg: ${hof.hardest.avg.toFixed(2)}` : "—" },
    { icon:"🧱", title:"Most Fails", winner: joinNames(hof.mostFails.leaders), desc: hof.mostFails.best ? `Fails: ${hof.mostFails.best}` : "—" },
  ];

  cardsEl.innerHTML = cards.map(t => `
    <div class="trophy">
      <div class="name">${t.icon} ${escapeHtml(t.title)} — ${escapeHtml(t.winner || "—")}</div>
      <div class="desc">${escapeHtml(t.desc)}</div>
    </div>
  `).join("");

  // Records table
  const joinNames = (arr) => (arr && arr.length ? arr.join(", ") : "—");
  const rows = [
    ["All-time King (avg, fails=7)", joinNames(hof.king.leaders), hof.king.avg ? hof.king.avg.toFixed(2) : "—"],
    ["Most wins", joinNames(hof.mostWins.leaders), hof.mostWins.best ? String(hof.mostWins.best) : "—"],
    ["Best single solve (min)", joinNames(hof.bestSolve.leaders), hof.bestSolve.guesses ? `${hof.bestSolve.guesses} (count ${hof.bestSolve.count})` : "—"],
    ["Longest streak", joinNames(hof.streak.leaders), hof.streak.longest ? String(hof.streak.longest) : "—"],
    ["Most 2s", joinNames(hof.most2s.leaders), hof.most2s.best ? String(hof.most2s.best) : "—"],
    ["Most 3s", joinNames(hof.most3s.leaders), hof.most3s.best ? String(hof.most3s.best) : "—"],
    ["Most fails", joinNames(hof.mostFails.leaders), hof.mostFails.best ? String(hof.mostFails.best) : "—"],
    ["Hardest puzzle", hof.hardest.puzzle ? `#${hof.hardest.puzzle}` : "—", hof.hardest.puzzle ? hof.hardest.avg.toFixed(2) : "—"],
    ["Most consistent (SD)", hof.mostConsistent ? hof.mostConsistent.player : "—", hof.mostConsistent ? hof.mostConsistent.sd.toFixed(2) : "Need 5+ wins"],
  ];

  let html = "<table><thead><tr><th>Record</th><th>Holder</th><th>Value</th></tr></thead><tbody>";
  for (const r of rows) {
    html += `<tr><td>${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td><td>${escapeHtml(r[2])}</td></tr>`;
  }
  html += "</tbody></table>";
  tableEl.innerHTML = html;
}


function renderPeriodView(periodKey, periodItems, outTrophiesEl, outTableEl) {
  const lb = computeLeaderboard(periodItems);
  const streaks = computeStreaks(periodItems);

  // Sort for weekly/monthly: fail-inclusive avg, then fails, then best
  lb.sort((a,b)=>{
    const av = (a.avgWithFails ?? a.avg ?? 0);
    const bv = (b.avgWithFails ?? b.avg ?? 0);
    if (av !== bv) return av - bv;
    if ((a.fails||0) !== (b.fails||0)) return (a.fails||0) - (b.fails||0);
    return ((a.best==="-"?999:a.best) - (b.best==="-"?999:b.best));
  });

  // King (fail-inclusive)
  const king = lb[0] || null;

  // Sniper: most 2s+3s (ties shown)
  let maxSnipe = 0;
  for (const r of lb) maxSnipe = Math.max(maxSnipe, (r.twos||0) + (r.threes||0));
  const snipers = lb.filter(r => ((r.twos||0)+(r.threes||0)) === maxSnipe && maxSnipe > 0).map(r => r.player);

  // Brick Wall: most fails (ties shown)
  let maxFail = 0;
  for (const r of lb) maxFail = Math.max(maxFail, (r.fails||0));
  const bricks = lb.filter(r => (r.fails||0) === maxFail && maxFail > 0).map(r => r.player);

  // Streak Lord: longest streak within the period (ties shown)
  let maxLongest = 0;
  for (const r of lb) {
    const st = streaks.get(r.player);
    if (st && st.longest > maxLongest) maxLongest = st.longest;
  }
  const streakLeaders = lb
    .map(r => ({ p: r.player, st: streaks.get(r.player) }))
    .filter(x => x.st && x.st.longest === maxLongest && maxLongest > 0)
    .map(x => x.p);

  const join = (arr) => (arr && arr.length ? arr.join(", ") : "—");

  const trophies = [
    { icon:"👑", title:"Wordle King", winner: king ? king.player : "—", desc: king ? `Lowest avg (fails=7): ${king.avgWithFails.toFixed(2)}` : "—" },
    { icon:"🎯", title:"Sniper", winner: join(snipers), desc: maxSnipe ? `Most 2s+3s: ${maxSnipe}` : "—" },
    { icon:"🧱", title:"Brick Wall", winner: join(bricks), desc: maxFail ? `Most fails: ${maxFail}` : "—" },
    { icon:"🔥", title:"Streak Lord", winner: join(streakLeaders), desc: maxLongest ? `Longest streak: ${maxLongest}` : "—" },
  ];

  outTrophiesEl.innerHTML = trophyCards(trophies);

  // Table
  let html = "<table><thead><tr>" +
    "<th class='rank'>#</th><th>Player</th><th>Avg</th><th>Total</th>" +
    "<th>6</th><th>5</th><th>4</th><th>3</th><th>2</th><th>1</th><th>Fail</th>" +
    "<th>W</th><th>Best</th><th>Worst</th><th>🔥</th>" +
    "</tr></thead><tbody>";

  lb.forEach((r, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : String(idx + 1);
    const st = streaks.get(r.player) || { current: 0, longest: 0 };
    html += "<tr>" +
      `<td class='rank'>${medal}</td>` +
      `<td>${escapeHtml(r.player)}</td>` +
      `<td><span class='badge'>${(r.avgWithFails ?? r.avg) ? (r.avgWithFails ?? r.avg).toFixed(2) : "-"}</span></td>` +
      `<td>${r.totalGuesses}</td>` +
      `<td>${r.sixes||0}</td>` +
      `<td>${r.fives||0}</td>` +
      `<td>${r.fours||0}</td>` +
      `<td>${r.threes||0}</td>` +
      `<td>${r.twos||0}</td>` +
      `<td>${r.ones||0}</td>` +
      `<td>${r.fails||0}</td>` +
      `<td>${r.wins}</td>` +
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
    let playerRaw = (r[2] || "").trim();
    let player = playerRaw;
    // Direct map
    if (NAME_MAP[player]) player = NAME_MAP[player];
    // Normalized map (handles stray spaces/case)
    else {
      const n = normalizeName(playerRaw);
      // try matching keys by normalized form
      for (const k of Object.keys(NAME_MAP)) {
        if (normalizeName(k) === n) { player = NAME_MAP[k]; break; }
      }
    }
    const guesses = safeNum((r[3] || "").trim());
    const result = (r[4] || "").trim().toLowerCase();
    const fail = result === "fail" || guesses === 0;
    return { dateKey, dt, puzzle, player, guesses: fail ? 0 : guesses, fail };
  }).filter(it => it.dt && it.player);

  items.sort((a,b) => a.dt - b.dt || a.puzzle - b.puzzle || a.player.localeCompare(b.player));
  // Treat blank day as fail: if a player has no entry for a date, count as fail (synthetic X)
  const allPlayers = ROSTER.slice();
  const byDate = new Map();
  items.forEach(i => {
    if (!byDate.has(i.dateKey)) byDate.set(i.dateKey, new Set());
    byDate.get(i.dateKey).add(i.player);
  });

  const synthetic = [];
  for (const [dateKey, players] of byDate.entries()) {
    const dt = parseDateDMY(dateKey);
    for (const p of allPlayers) {
      if (!players.has(p)) {
        synthetic.push({ dateKey, dt, puzzle: 0, player: p, guesses: 0, fail: true });
      }
    }
  }
  items.push(...synthetic);


  if (!items.length) { setStatus("No data found yet."); return; }

  const leaderboard = computeLeaderboard(items);
  const streaks = computeStreaks(items);

  renderMiniSummary(leaderboard, streaks);
  renderLeaderboardTable(leaderboard, streaks);
  renderGroupAverage(items);

  // Form tab
  const players = ROSTER.filter(p => leaderboard.some(r => r.player === p));
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

  // Hall of Fame
  const hof = computeHallOfFame(items);
  renderHallOfFame(hof);

  const vEl = document.getElementById("appVersion");
  if (vEl) vEl.textContent = `App version: ${APP_VERSION}`;
  setStatus("Updated.");
}

main().catch(err => {
  console.error(err);
  setStatus("Error loading data. Check your CSV link + publish settings.");
});
