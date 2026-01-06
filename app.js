/* global SHEET_CSV_URL, Chart */
function csvToRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  // Basic CSV split (works for our simple columns)
  return lines.map(l => l.split(","));
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadData() {
  const statusEl = document.getElementById("status");
  if (!SHEET_CSV_URL || SHEET_CSV_URL.includes("PASTE_YOUR_CSV_LINK_HERE")) {
    statusEl.textContent = "Set your Google Sheets CSV link in config.js (SHEET_CSV_URL).";
    return;
  }

  statusEl.textContent = "Fetching data…";
  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch sheet");
  const csv = await res.text();
  const rows = csvToRows(csv);

  // Expect header: Date,Puzzle,Player,Guesses,Result
  const body = rows.slice(1).filter(r => r.length >= 5);

  // Leaderboard aggregation
  const byPlayer = new Map();
  for (const r of body) {
    const player = (r[2] || "").trim();
    const guesses = safeNum((r[3] || "").trim());
    const result = (r[4] || "").trim().toLowerCase();

    if (!player) continue;
    if (!byPlayer.has(player)) byPlayer.set(player, { games: 0, wins: 0, fails: 0, sum: 0, best: Infinity, worst: 0 });
    const p = byPlayer.get(player);

    p.games += 1;
    if (result === "fail" || guesses === 0) p.fails += 1; else p.wins += 1;

    if (guesses > 0) {
      p.sum += guesses;
      p.best = Math.min(p.best, guesses);
      p.worst = Math.max(p.worst, guesses);
    }
  }

  const leaderboard = Array.from(byPlayer.entries()).map(([player, s]) => ({
    player,
    games: s.games,
    wins: s.wins,
    fails: s.fails,
    avg: s.wins > 0 ? (s.sum / s.wins) : 0, // avg over wins only
    best: Number.isFinite(s.best) ? s.best : "-",
    worst: s.worst || "-",
  }));

  leaderboard.sort((a, b) => {
    // Sort by avg asc, then fails asc, then best asc
    if (a.avg !== b.avg) return a.avg - b.avg;
    if (a.fails !== b.fails) return a.fails - b.fails;
    return (a.best === "-" ? 999 : a.best) - (b.best === "-" ? 999 : b.best);
  });

  renderLeaderboard(leaderboard);
  renderGroupAverage(body);
  statusEl.textContent = "Updated.";
}

function renderLeaderboard(rows) {
  const el = document.getElementById("leaderboard");
  if (!rows.length) {
    el.innerHTML = "<div class='status'>No rows found yet.</div>";
    return;
  }
  let html = "<table><thead><tr>" +
    "<th class='rank'>#</th><th>Player</th><th>Avg</th><th>W</th><th>F</th><th>Best</th><th>Worst</th>" +
    "</tr></thead><tbody>";

  rows.forEach((r, idx) => {
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : String(idx + 1);
    html += "<tr>" +
      `<td class='rank'>${medal}</td>` +
      `<td>${escapeHtml(r.player)}</td>` +
      `<td><span class='badge'>${r.avg ? r.avg.toFixed(2) : "-"}</span></td>` +
      `<td>${r.wins}</td>` +
      `<td>${r.fails}</td>` +
      `<td>${r.best}</td>` +
      `<td>${r.worst}</td>` +
      "</tr>";
  });

  html += "</tbody></table>";
  el.innerHTML = html;
}

let chart;
function renderGroupAverage(bodyRows) {
  // Group average guesses per date (wins only)
  const byDate = new Map();
  for (const r of bodyRows) {
    const date = (r[0] || "").trim();
    const guesses = safeNum((r[3] || "").trim());
    const result = (r[4] || "").trim().toLowerCase();
    if (!date) continue;
    if (result === "fail" || guesses === 0) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(guesses);
  }

  const labels = Array.from(byDate.keys());
  labels.sort((a, b) => {
    // dd/mm/yy
    const [da, ma, ya] = a.split("/").map(Number);
    const [db, mb, yb] = b.split("/").map(Number);
    const A = new Date(2000 + ya, ma - 1, da).getTime();
    const B = new Date(2000 + yb, mb - 1, db).getTime();
    return A - B;
  });

  const data = labels.map(d => {
    const arr = byDate.get(d) || [];
    const avg = arr.reduce((s, x) => s + x, 0) / (arr.length || 1);
    return Math.round(avg * 100) / 100;
  });

  const ctx = document.getElementById("groupChart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Group average", data, tension: 0.25 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: false, suggestedMin: 2, suggestedMax: 6 } }
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[s]));
}

loadData().catch(err => {
  const statusEl = document.getElementById("status");
  statusEl.textContent = "Error loading data. Check your CSV link and that it's published.";
  console.error(err);
});
