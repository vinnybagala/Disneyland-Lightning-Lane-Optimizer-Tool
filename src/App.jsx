import { useState, useEffect, useRef, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const PARK_IDS = {
  DL:  "16",
  DCA: "17",
};
const POLL_INTERVAL   = 5 * 60 * 1000;
const MAX_MEM_HISTORY = 48;
const SUPABASE_URL    = "https://ntxuavikjwxesndffsgq.supabase.co";
const SUPABASE_KEY    = "sb_publishable_CgX9cKbkp_r3KcIpKa5GZg_-LK9BbrY";
const SB_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function dbInsertSnapshots(snapshots) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/wait_time_snapshots`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
      body: JSON.stringify(snapshots),
    });
    if (!res.ok) console.warn("DB insert error", res.status, await res.text());
  } catch (e) { console.warn("DB insert failed", e); }
}

async function dbLoadHistory(tripDay) {
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/wait_time_snapshots?trip_day=eq.${tripDay}&snapshot_time=gte.${encodeURIComponent(since)}&order=snapshot_time.asc&limit=2000`;
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) { console.warn("dbLoadHistory error", res.status, await res.text()); return []; }
    return await res.json();
  } catch(e) { console.warn("dbLoadHistory catch", e); return []; }
}

async function dbLoadYesterday(tripDay) {
  if (tripDay === 1) return [];
  try {
    const url = `${SUPABASE_URL}/rest/v1/wait_time_snapshots?trip_day=eq.${tripDay - 1}&order=snapshot_time.asc&limit=2000`;
    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) { console.warn("dbLoadYesterday error", res.status); return []; }
    return await res.json();
  } catch(e) { console.warn("dbLoadYesterday catch", e); return []; }
}

// ─── Ride Data ────────────────────────────────────────────────────────────────
const LL_TIERS = {
  DL: {
    tier1: [
      { name: "Indiana Jones Adventure",           note: "Book FIRST — sells out by noon" },
      { name: "Space Mountain",                    note: "Book FIRST — sells out by noon" },
      { name: "Mickey & Minnie's Runaway Railway",  note: "Book FIRST — sells out by noon" },
    ],
    tier2: [
      { name: "Matterhorn Bobsleds",               note: "Late afternoon sellout" },
      { name: "Big Thunder Mountain Railroad",     note: "Late afternoon sellout" },
      { name: "Tiana's Bayou Adventure",           note: "Late afternoon sellout" },
      { name: "Haunted Mansion",                   note: "Late afternoon sellout" },
    ],
    tier3: [
      { name: "Millennium Falcon: Smugglers Run",  note: "Rarely urgent — book later in day" },
      { name: "Star Tours",                        note: "Rarely urgent — book later in day" },
    ],
    nonLL_A: [
      { name: "Rise of the Resistance",            note: "Single Pass only — before 11am" },
    ],
    nonLL_B: [
      { name: "Pirates of the Caribbean",          note: "⚠️ CLOSED THIS TRIP", closed: true },
      { name: "Jungle Cruise",                     note: "No LL — ride before 2pm" },
    ],
  },
  DCA: {
    tier1: [
      { name: "Guardians of the Galaxy – Mission: BREAKOUT!", note: "Book FIRST in DCA" },
      { name: "Toy Story Midway Mania!",            note: "Book second in DCA" },
    ],
    tier2: [
      { name: "Soarin' Around the World",           note: "Ride standby <30min early or LL later" },
      { name: "Goofy's Sky School",                 note: "Late afternoon sellout" },
      { name: "Incredicoaster",                     note: "Late afternoon sellout" },
    ],
    tier3: [
      { name: "WEB SLINGERS: A Spider-Man Adventure", note: "Available most of day" },
      { name: "The Little Mermaid",                 note: "Available most of day" },
      { name: "Monsters Inc. Mike & Sulley",        note: "Available most of day" },
      { name: "Grizzly River Run",                  note: "Tier 2 in summer heat" },
    ],
    nonLL_A: [
      { name: "Radiator Springs Racers",            note: "Single Pass or ride before 11am" },
    ],
    nonLL_B: [],
  },
};

const ALL_RIDES   = Object.values(LL_TIERS).flatMap(p => Object.values(p).flat());
const TIER_COLOR  = { tier1:"#f87171", tier2:"#fb923c", tier3:"#4ade80", nonLL_A:"#c084fc", nonLL_B:"#60a5fa" };
const TIER_LABEL  = { tier1:"T1·LL", tier2:"T2·LL", tier3:"T3·LL", nonLL_A:"No LL·A", nonLL_B:"No LL·B" };
const WAIT_COLOR  = (w) => w <= 20 ? "#4ade80" : w <= 40 ? "#facc15" : w <= 60 ? "#fb923c" : "#f87171";

const RIDE_HISTORY = {
  "Indiana Jones Adventure": {
    park:"DL", tier:"tier1",
    hourly: {8:20,9:25,10:40,11:60,12:75,13:85,14:90,15:95,16:90,17:80,18:70,19:60,20:50,21:40},
    peak:"1:00pm-3:00pm", walkBefore:"9:30am", tip:"Book LL first. If standby under 25min before 9:30am walk on and save LL."
  },
  "Space Mountain": {
    park:"DL", tier:"tier1",
    hourly: {8:15,9:20,10:35,11:55,12:70,13:80,14:85,15:85,16:80,17:70,18:60,19:50,20:40,21:30},
    peak:"1:00pm-3:00pm", walkBefore:"9:30am", tip:"Book LL first. Walkable at rope drop, spikes fast by 11am."
  },
  "Mickey & Minnie's Runaway Railway": {
    park:"DL", tier:"tier1",
    hourly: {8:30,9:40,10:55,11:65,12:70,13:75,14:75,15:70,16:65,17:60,18:55,19:50,20:45,21:35},
    peak:"12:00pm-3:00pm", walkBefore:"Never — always use LL", tip:"Book LL immediately on scan-in. Rarely walkable."
  },
  "Matterhorn Bobsleds": {
    park:"DL", tier:"tier2",
    hourly: {8:15,9:20,10:35,11:45,12:55,13:65,14:70,15:70,16:65,17:55,18:45,19:40,20:35,21:25},
    peak:"1:00pm-4:00pm", walkBefore:"9:30am", tip:"Walk on at rope drop. Book LL if over 35min."
  },
  "Big Thunder Mountain Railroad": {
    park:"DL", tier:"tier2",
    hourly: {8:10,9:15,10:25,11:35,12:45,13:50,14:55,15:55,16:50,17:45,18:40,19:35,20:30,21:20},
    peak:"1:00pm-4:00pm", walkBefore:"10:00am", tip:"Great morning standby ride. Save LL for afternoon."
  },
  "Tiana's Bayou Adventure": {
    park:"DL", tier:"tier2",
    hourly: {8:20,9:30,10:45,11:55,12:65,13:75,14:80,15:75,16:70,17:60,18:50,19:45,20:35,21:25},
    peak:"1:00pm-4:00pm", walkBefore:"9:30am", tip:"Book LL by 10am. Sells out afternoon."
  },
  "Haunted Mansion": {
    park:"DL", tier:"tier2",
    hourly: {8:10,9:15,10:25,11:35,12:45,13:50,14:55,15:50,16:45,17:40,18:35,19:30,20:25,21:20},
    peak:"12:00pm-3:00pm", walkBefore:"10:00am", tip:"Walk on morning. Use LL only if over 40min."
  },
  "Millennium Falcon: Smugglers Run": {
    park:"DL", tier:"tier3",
    hourly: {8:15,9:20,10:30,11:40,12:45,13:50,14:50,15:45,16:40,17:35,18:30,19:25,20:20,21:15},
    peak:"12:00pm-3:00pm", walkBefore:"10:00am", tip:"Tier 3 — rarely urgent. Book LL later in day."
  },
  "Star Tours": {
    park:"DL", tier:"tier3",
    hourly: {8:10,9:15,10:20,11:25,12:30,13:35,14:35,15:30,16:25,17:20,18:15,19:15,20:10,21:10},
    peak:"12:00pm-2:00pm", walkBefore:"Anytime", tip:"Low demand all day. Good filler between LL windows."
  },
  "Rise of the Resistance": {
    park:"DL", tier:"nonLL_A",
    hourly: {8:45,9:60,10:70,11:75,12:80,13:85,14:80,15:75,16:70,17:65,18:55,19:50,20:40,21:30},
    peak:"12:00pm-3:00pm", walkBefore:"8:00am only", tip:"Single Pass or rope drop ONLY. Lines form before park opens."
  },
  "Jungle Cruise": {
    park:"DL", tier:"nonLL_B",
    hourly: {8:10,9:15,10:25,11:35,12:45,13:50,14:50,15:45,16:40,17:35,18:30,19:25,20:20,21:15},
    peak:"12:00pm-3:00pm", walkBefore:"10:00am", tip:"No LL available. Ride before 10am or skip midday."
  },
  "Guardians of the Galaxy – Mission: BREAKOUT!": {
    park:"DCA", tier:"tier1",
    hourly: {8:25,9:35,10:50,11:65,12:75,13:85,14:90,15:90,16:85,17:75,18:65,19:55,20:45,21:35},
    peak:"1:00pm-4:00pm", walkBefore:"9:30am", tip:"Book LL FIRST in DCA. Peaks hard in afternoon."
  },
  "Toy Story Midway Mania!": {
    park:"DCA", tier:"tier1",
    hourly: {8:20,9:30,10:45,11:60,12:70,13:75,14:75,15:70,16:65,17:55,18:50,19:40,20:35,21:25},
    peak:"12:00pm-3:00pm", walkBefore:"9:30am", tip:"Book LL second in DCA immediately after Guardians."
  },
  "Soarin' Around the World": {
    park:"DCA", tier:"tier2",
    hourly: {8:15,9:20,10:35,11:45,12:55,13:60,14:65,15:60,16:55,17:50,18:40,19:35,20:25,21:20},
    peak:"12:00pm-3:00pm", walkBefore:"9:30am", tip:"Walk on early, book LL if over 30min."
  },
  "Goofy's Sky School": {
    park:"DCA", tier:"tier2",
    hourly: {8:10,9:15,10:25,11:35,12:40,13:45,14:45,15:40,16:35,17:30,18:25,19:20,20:15,21:10},
    peak:"12:00pm-3:00pm", walkBefore:"10:00am", tip:"Lower demand. Good standby in morning."
  },
  "Incredicoaster": {
    park:"DCA", tier:"tier2",
    hourly: {8:15,9:25,10:35,11:50,12:60,13:65,14:65,15:60,16:55,17:45,18:40,19:35,20:25,21:20},
    peak:"12:00pm-3:00pm", walkBefore:"9:30am", tip:"Walk on early morning. Book LL by 11am."
  },
  "WEB SLINGERS: A Spider-Man Adventure": {
    park:"DCA", tier:"tier3",
    hourly: {8:10,9:15,10:25,11:35,12:40,13:45,14:45,15:40,16:35,17:30,18:25,19:20,20:15,21:10},
    peak:"12:00pm-2:00pm", walkBefore:"Anytime", tip:"Tier 3 — available most of day. Good filler."
  },
  "The Little Mermaid": {
    park:"DCA", tier:"tier3",
    hourly: {8:5,9:10,10:15,11:20,12:25,13:25,14:25,15:20,16:20,17:15,18:15,19:10,20:10,21:5},
    peak:"12:00pm-2:00pm", walkBefore:"Anytime", tip:"Almost always walkable. Use as filler anytime."
  },
  "Monsters Inc. Mike & Sulley": {
    park:"DCA", tier:"tier3",
    hourly: {8:5,9:10,10:15,11:20,12:25,13:30,14:30,15:25,16:20,17:20,18:15,19:10,20:10,21:5},
    peak:"12:00pm-2:00pm", walkBefore:"Anytime", tip:"Low demand all day. Good filler."
  },
  "Grizzly River Run": {
    park:"DCA", tier:"tier3",
    hourly: {8:10,9:15,10:25,11:35,12:45,13:55,14:60,15:60,16:55,17:50,18:40,19:30,20:20,21:10},
    peak:"1:00pm-4:00pm", walkBefore:"10:00am", tip:"Spikes in afternoon heat. Ride morning or use LL."
  },
  "Radiator Springs Racers": {
    park:"DCA", tier:"nonLL_A",
    hourly: {8:45,9:70,10:90,11:100,12:110,13:115,14:110,15:105,16:95,17:85,18:70,19:60,20:45,21:30},
    peak:"11:00am-3:00pm", walkBefore:"8:00am ONLY", tip:"HIGHEST demand in DCA. Single Pass or rope drop. Lines form before park opens. Do NOT attempt standby after 9am."
  },
};

const getRideMeta = (name) => {
  for (const park of ["DL","DCA"])
    for (const tier of ["tier1","tier2","tier3","nonLL_A","nonLL_B"]) {
      const r = LL_TIERS[park][tier]?.find(r => r.name === name);
      if (r) return { ...r, tier, park };
    }
  return null;
};

const toBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
});

// ─── Park API ─────────────────────────────────────────────────────────────────
async function fetchWaits(parkId) {
  try {
    const res = await fetch(`/api/waits?park=${parkId}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const rides = (data.lands||[]).flatMap(land => land.rides||[]);
    return rides
      .filter(r => r.is_open && r.wait_time != null)
      .map(r => ({ id: String(r.id), name: r.name, wait: r.wait_time, status: r.is_open ? "OPERATING" : "CLOSED" }))
      .sort((a,b) => b.wait - a.wait);
  } catch { return null; }
}

// ─── AI System Prompt ─────────────────────────────────────────────────────────
const AI_SYSTEM = `You are an expert Disneyland Lightning Lane optimizer trained on LL University (Park Hop Insider, April 2026). Your sole goal is to maximize the number of preferred rides completed in a single day across both parks.

CORE RULES:
- Scan into park first, then activate LL Multi Pass
- Book 1st LL immediately upon scan-in
- Rebook: after redeeming most recent LL OR 2 hours after booking — whichever comes FIRST
- Two-hour timer based on BOOKING time, not return time
- Always MODIFY, never cancel — preserves 2-hr clock
- Hold multiple LLs simultaneously — no fixed cap
- Each attraction: one LL redemption per day
- Return windows: 1 hour. ~5 min early, ~15 min late grace (not guaranteed)
- LL Single Pass does NOT affect Multi Pass timer
- SEP: issued if ride breaks down during ACTIVE window. Bonus pass. Book again immediately. Save for afternoon.
- Don't modify until 30-45 min into return window — preserves SEP eligibility

DEMAND TIERS (THIS TRIP):
DL Tier 1 (book FIRST): Indiana Jones, Space Mountain, Mickey & Minnie's Railway → sell out by noon
DL Tier 2: Matterhorn, Big Thunder, Tiana's Bayou, Haunted Mansion → late afternoon sellout
DL Tier 3: Smugglers Run, Star Tours → available late day
DL Non-LL A (before 11am): Rise of the Resistance (Single Pass)
DL Non-LL B (before 2pm): Jungle Cruise (Pirates CLOSED)
DCA Tier 1 (book FIRST): Guardians BREAKOUT, Toy Story Mania → early afternoon sellout
DCA Tier 2: Soarin', Goofy's Sky School, Incredicoaster → late afternoon
DCA Tier 3: Web Slingers, Little Mermaid, Monsters Inc, Grizzly River Run
DCA Non-LL A (before 11am): Radiator Springs Racers
CLOSED: Pirates of the Caribbean, Buzz Lightyear Astro Blasters

DAY STRATEGIES:
DAY 1 (Start DL, hop to DCA): Cannot enter DCA until 11am. Stack DL Tier 1/2 LLs in morning. Book DCA LLs before hopping. Cross over mid-day with 2-3 DCA LLs stacked. Finish in DCA.
DAY 2 (Start DCA, hop to DL): No park hop time restriction. Start with Radiator Springs Racers at rope drop. Book Guardians + Toy Story LL immediately. Hop to DL whenever DCA list is exhausted.

OPTIMIZATION FORMULA: Score = (Preference Rank × 0.5) + (Wait Time Savings × 0.3) + (Proximity Score × 0.2). Highest score = next recommended ride.

HISTORICAL WAIT TIME BASELINES (Thrill Data, Disneyland Anaheim, June 2026 typical patterns):

DISNEYLAND PARK wait time arc:
8:00am: 7-10min (rope drop, lowest of day, walk on almost everything)
9:00am: 14-16min (still manageable, book first LL immediately on scan-in)
10:00am: 21-23min (rising fast, Tier 1 LL selling out now)
11:00am: 28-30min (peak approaching, standby under 30min disappearing)
12:00pm-3:00pm: 30-35min park average PEAK (Indiana Jones and Space Mountain hitting 75-100min standby)
4:00pm-5:00pm: 29-30min (still busy)
6:00pm-8:00pm: 26-28min (evening drop, good for Tier 2 standby)

KEY DL RIDE PATTERNS:
Indiana Jones: walkable before 9:30am (~20min), 60min by 11am, peaks 80-100min 1pm-4pm
Space Mountain: walkable before 9:30am, 55min by 11am, peaks 75-90min 1pm-4pm
Mickey and Minnies Railway: 45-70min all day, book LL first thing
Matterhorn: 25min rope drop, 50-65min by noon, 70min peak afternoon
Big Thunder Mountain: 20min morning, 40-55min midday, manageable evening
Haunted Mansion: 20-30min most of day, spikes 45-55min peak hours
Tianas Bayou Adventure: 35-50min most of day, peaks 65-80min afternoon
Rise of the Resistance: 45-75min all day, ride at rope drop or Single Pass only
Jungle Cruise: 20min morning, 35-50min midday
Smugglers Run: 25-40min most of day, rarely over 60min

KEY DCA RIDE PATTERNS:
Radiator Springs Racers: 45-75min by 9am, peaks 90-120min midday, MUST ride rope drop or Single Pass
Guardians BREAKOUT: 35-55min morning, peaks 70-95min afternoon
Toy Story Mania: 30-45min morning, peaks 60-80min afternoon
Incredicoaster: 20-35min morning, 45-65min afternoon
Soarin Around the World: 20-30min morning, 40-60min afternoon
Goofys Sky School: 15-25min morning, 30-45min afternoon
Web Slingers: 20-35min most of day
Grizzly River Run: spikes in afternoon heat, Tier 2 level in summer

CRITICAL TIMING INTELLIGENCE:
Indiana Jones, Space Mountain, Mickey Railway LL SELLS OUT by 11am-12pm on busy days
Guardians and Toy Story LL sell out by 1pm-2pm
BEST standby window: 8am-9:30am for ALL rides
WORST standby time: 12pm-4pm, use LL stack instead
Evening drop: 6pm-8pm waits fall 15-20%, good for Tier 2 standby
Day 1 park hop sweet spot: leave DL around 1pm-2pm when DL peaks, arrive DCA with LL stack already booked

STANDBY RULE: Standby ≤30 min = walk on, save LL slot.

TREND ANALYSIS: Use historical data to identify rising/falling trends, predict peaks, spot SEP opportunities from sudden drops.

YESTERDAY COMPARISON: If yesterday's data is provided, compare current trends to yesterday's patterns. Flag if today is tracking worse or better than yesterday at the same time.

Be sharp, numbered, specific. Reference actual ride names and wait times. Always end with "NEXT ACTION:" — one clear thing to do right now.`;

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, yesterdayData, color = "#facc15", width = 60, height = 24 }) {
  if (!data || data.length < 2) return <span style={{ fontSize:10, color:"#334155" }}>—</span>;
  const allVals = [...data, ...(yesterdayData||[])];
  const max = Math.max(...allVals, 1);
  const pts = (arr) => arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const arrow = last > prev ? "↑" : last < prev ? "↓" : "→";
  const arrowColor = last > prev ? "#f87171" : last < prev ? "#4ade80" : "#facc15";
  const lastPt = pts(data).split(" ").pop();
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <svg width={width} height={height} style={{ overflow:"visible" }}>
        {yesterdayData && yesterdayData.length >= 2 && (
          <polyline points={pts(yesterdayData)} fill="none" stroke="#475569" strokeWidth="1" strokeDasharray="2,2" opacity="0.5"/>
        )}
        <polyline points={pts(data)} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.8"/>
        <circle cx={parseFloat(lastPt.split(",")[0])} cy={parseFloat(lastPt.split(",")[1])} r="2.5" fill={color}/>
      </svg>
      <span style={{ fontSize:11, color:arrowColor, fontWeight:700 }}>{arrow}</span>
    </div>
  );
}

// ─── Trend summary for AI ─────────────────────────────────────────────────────
function buildTrendSummary(history, yesterday) {
  if (!history || Object.keys(history).length === 0) return "(no trend data yet)";
  const lines = [];
  for (const [name, snaps] of Object.entries(history)) {
    if (snaps.length < 2) continue;
    const waits = snaps.map(s => s.wait);
    const current = waits[waits.length - 1];
    const oldest  = waits[0];
    const max = Math.max(...waits);
    const min = Math.min(...waits);
    const trend = current > oldest + 5 ? "RISING" : current < oldest - 5 ? "FALLING" : "STABLE";
    let yNote = "";
    if (yesterday[name] && yesterday[name].length > 2) {
      const yw = yesterday[name].map(s => s.wait);
      const yMax = Math.max(...yw);
      const yAvg = Math.round(yw.reduce((a,b)=>a+b,0)/yw.length);
      yNote = ` | Yesterday: avg ${yAvg}min, peak ${yMax}min`;
    }
    lines.push(`${name}: ${current}min now (${trend} — was ${oldest}min ${snaps.length*5}min ago, range ${min}-${max}min today${yNote})`);
  }
  return lines.length > 0 ? lines.join("\n") : "(collecting...)";
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]               = useState("waits");
  const [tripDay, setTripDay] = useState(() => { try { return parseInt(localStorage.getItem("ll_tripday")||"1"); } catch { return 1; } });
  const DEFAULT_FAVORITES = [
  { name: "Incredicoaster",                              park: "DCA" },
  { name: "Space Mountain",                              park: "DL"  },
  { name: "Rise of the Resistance",                      park: "DL"  },
  { name: "Radiator Springs Racers",                     park: "DCA" },
  { name: "Guardians of the Galaxy – Mission: BREAKOUT!", park: "DCA" },
  { name: "Big Thunder Mountain Railroad",               park: "DL"  },
  { name: "Goofy's Sky School",                          park: "DCA" },
  { name: "Indiana Jones Adventure",                     park: "DL"  },
  { name: "Tiana's Bayou Adventure",                     park: "DL"  },
  { name: "Grizzly River Run",                           park: "DCA" },
  { name: "Matterhorn Bobsleds",                         park: "DL"  },
  { name: "Toy Story Midway Mania!",                     park: "DCA" },
  { name: "Millennium Falcon: Smugglers Run",            park: "DL"  },
  { name: "WEB SLINGERS: A Spider-Man Adventure",        park: "DCA" },
  { name: "Mickey & Minnie's Runaway Railway",           park: "DL"  },
  { name: "Soarin' Around the World",                    park: "DCA" },
  { name: "Haunted Mansion",                             park: "DL"  },
  { name: "Jungle Cruise",                               park: "DL"  },
  { name: "Monsters Inc. Mike & Sulley",                 park: "DCA" },
  { name: "The Little Mermaid",                          park: "DCA" },
];
const [favorites, setFavorites] = useState(() => { try { const s = localStorage.getItem("ll_favorites"); return s ? JSON.parse(s) : DEFAULT_FAVORITES; } catch { return DEFAULT_FAVORITES; } });
  const [dragIdx, setDragIdx]       = useState(null);
  const [activePark, setActivePark] = useState("DL");
  const [waitsDL, setWaitsDL]       = useState(null);
  const [waitsDCA, setWaitsDCA]     = useState(null);
  const [history, setHistory]       = useState({});
  const [yesterday, setYesterday]   = useState({});
  const [polling, setPolling]       = useState(false);
  const [pollCount, setPollCount]   = useState(0);
  const [lastFetched, setLastFetched] = useState(null);
  const [nextPoll, setNextPoll]     = useState(null);
  const [countdown, setCountdown]   = useState(0);
  const [alerts, setAlerts]         = useState([]);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [aiResult, setAiResult]     = useState(null);
  const [aiLoading, setAiLoading]   = useState(false);
  const [strategy, setStrategy]     = useState("elite");
  const [expandedTip, setExpandedTip] = useState(null);
  const [dbStatus, setDbStatus]     = useState("idle"); // idle | saving | saved | error
  const pollTimer = useRef(null);
  const fileRef = useRef();

  // ── Load persisted history on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const rows = await dbLoadHistory(tripDay);
      const yRows = await dbLoadYesterday(tripDay);
      const toMap = (arr) => {
        const map = {};
        for (const r of arr) {
          if (!map[r.ride_name]) map[r.ride_name] = [];
          map[r.ride_name].push({ time: r.snapshot_time, wait: r.wait_minutes });
        }
        return map;
      };
      if (rows.length > 0) { setHistory(toMap(rows)); setPollCount(rows.length > 0 ? Math.ceil(rows.length / 20) : 0); }
      if (yRows.length > 0) setYesterday(toMap(yRows));
    })();
  }, [tripDay]);

  // ── Poll ─────────────────────────────────────────────────────────────────────
  const doPoll = useCallback(async (silent = false) => {
    const [dl, dca] = await Promise.all([fetchWaits(PARK_IDS.DL), fetchWaits(PARK_IDS.DCA)]);
    const now = new Date();
    if (dl || dca) {
      if (dl) setWaitsDL(dl);
      if (dca) setWaitsDCA(dca);
      setLastFetched(now);
      setPollCount(c => c + 1);
      setNextPoll(new Date(now.getTime() + POLL_INTERVAL));

      const allNew = [...(dl||[]), ...(dca||[])];

      // Update in-memory history
      setHistory(prev => {
        const next = { ...prev };
        for (const ride of allNew) {
          const existing = next[ride.name] || [];
          next[ride.name] = [...existing, { time: now.toISOString(), wait: ride.wait }].slice(-MAX_MEM_HISTORY);
        }
        return next;
      });

      // Persist to Supabase
      setDbStatus("saving");
      const park_lookup = {};
      (dl||[]).forEach(r => park_lookup[r.name] = "DL");
      (dca||[]).forEach(r => park_lookup[r.name] = "DCA");
      const rows = allNew.map(r => ({
        ride_name: r.name,
        park: park_lookup[r.name] || "DL",
        wait_minutes: r.wait,
        snapshot_time: now.toISOString(),
        trip_day: tripDay,
      }));
      await dbInsertSnapshots(rows);
      setDbStatus("saved");
      setTimeout(() => setDbStatus("idle"), 2000);

      // Alerts
      setFavorites(favs => {
        const newAlerts = [];
        for (const fav of favs) {
          const live = allNew.find(r => r.name === fav.name);
          if (live && live.wait <= 30) {
            const meta = getRideMeta(fav.name);
            if (meta && (meta.tier === "tier1" || meta.tier === "tier2"))
              newAlerts.push(`${fav.name} dropped to ${live.wait}min — walk on now!`);
          }
        }
        if (newAlerts.length > 0) setAlerts(newAlerts);
        return favs;
      });
    }
  }, [tripDay]);

  const startPolling = useCallback(() => {
    setPolling(true);
    doPoll(false);
    pollTimer.current = setInterval(() => doPoll(true), POLL_INTERVAL);
  }, [doPoll]);

  const stopPolling = useCallback(() => {
    setPolling(false);
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  useEffect(() => {
    if (!nextPoll) return;
    const t = setInterval(() => setCountdown(Math.max(0, Math.round((nextPoll - new Date()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [nextPoll]);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);
  // ── Persist favorites + tripDay ─────────────────────────────────────────────
  useEffect(() => { try { localStorage.setItem("ll_favorites", JSON.stringify(favorites)); } catch {} }, [favorites]);
  useEffect(() => { try { localStorage.setItem("ll_tripday", String(tripDay)); } catch {} }, [tripDay]);


  // ── Favorites ────────────────────────────────────────────────────────────────
  const favNames = new Set(favorites.map(f => f.name));
  const addFav   = (name, park) => { if (!favNames.has(name)) setFavorites(p => [...p, { name, park }]); };
  const removeFav = (name) => setFavorites(f => f.filter(x => x.name !== name));
  const handleDragStart = (i) => setDragIdx(i);
  const handleDrop = (i) => {
    if (dragIdx === null || dragIdx === i) return;
    const next = [...favorites];
    const [item] = next.splice(dragIdx, 1);
    next.splice(i, 0, item);
    setFavorites(next);
    setDragIdx(null);
  };

  const handleFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setScreenshot(f); setScreenshotPreview(URL.createObjectURL(f)); setAiResult(null);
  };

  // ── AI ───────────────────────────────────────────────────────────────────────
  const runAnalysis = async () => {
    setAiLoading(true); setAiResult(null);
    try {
      const allWaits = [...(waitsDL||[]).map(w=>`${w.name}: ${w.wait}min (DL)`), ...(waitsDCA||[]).map(w=>`${w.name}: ${w.wait}min (DCA)`)].join("\n");
      const trendSummary = buildTrendSummary(history, yesterday);
      const hasYesterday = Object.keys(yesterday).length > 0;
      const favList = favorites.map((f,i) => {
        const m = getRideMeta(f.name);
        return `${i+1}. ${f.name} (${f.park}) [${m?.tier||"?"}]${m?.closed?" ⚠️CLOSED":""}`;
      }).join("\n");
      const stratLabel = strategy==="stack"?"Stacking":strategy==="bookredeem"?"Book & Redeem":"Elite Combo";
      const dayContext = tripDay===1
        ? "DAY 1: Starting at Disneyland, hopping to DCA. Cannot enter DCA until 11am. No early entry."
        : "DAY 2: Starting at DCA, hopping to DL. No park hop time restriction. No early entry.";

      const userText = `${dayContext}
Strategy: ${stratLabel}
Poll count: ${pollCount} (${Math.round(pollCount*5/60*10)/10}hr of data)
Yesterday's data available: ${hasYesterday ? "YES — use for comparison" : "NO"}

MY PRIORITY RIDES (ranked by preference):
${favList||"(none set)"}

CURRENT LIVE WAIT TIMES:
${allWaits||"(not loaded)"}

TREND DATA (today vs yesterday):
${trendSummary}

Give me:
1. What LL return times I'm holding (from screenshot if attached)
2. What to book with LL RIGHT NOW and why
3. What to ride standby right now (≤30min, stable/falling trend)
4. What NOT to use LL on right now
5. Optimal sequence for next 3-4 hours
6. How today compares to yesterday at this time (if yesterday data available)
7. Any rising trend alerts — act now before it spikes
8. Stacking or SEP opportunities

NEXT ACTION: (one clear thing to do right now)

CLOSED: Pirates of the Caribbean, Buzz Lightyear — never recommend.`;

      const content = [{ type:"text", text:userText }];
      if (screenshot) {
        const b64 = await toBase64(screenshot);
        content.unshift({ type:"image", source:{ type:"base64", media_type:screenshot.type||"image/png", data:b64 }});
      }
      const res = await fetch("/api/ai", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:1000, system:AI_SYSTEM, messages:[{role:"user",content}] }),
      });
      const raw = await res.text();
      console.log("AI raw response:", raw.slice(0,500));
      let data;
      try { data = JSON.parse(raw); } catch(e) { setAiResult("Parse error: " + raw.slice(0,200)); setAiLoading(false); return; }
      if (data.error) {
        setAiResult("API Error: " + (data.error.message || JSON.stringify(data.error)));
      } else if (data.content && data.content.length > 0) {
        const text = data.content.filter(b=>b.type==="text").map(b=>b.text).join("");
        setAiResult(text || "Empty content block. Raw: " + JSON.stringify(data.content).slice(0,200));
      } else {
        setAiResult("No content in response. Keys: " + Object.keys(data).join(", ") + " | " + raw.slice(0,300));
      }
    } catch { setAiResult("Error. Please try again."); }
    setAiLoading(false);
  };

  const currentWaits = activePark==="DL" ? waitsDL : waitsDCA;
  const tierData = LL_TIERS[activePark];
  const hasYesterday = Object.keys(yesterday).length > 0;

  const tips = [
    { id:"2hr",   icon:"⏱", title:"2-Hour Rule",                body:"Book again after redeeming your most recent LL — OR 2 hours after last booking — whichever comes FIRST. Timer is based on booking time, not return window." },
    { id:"mod",   icon:"✏️", title:"Always Modify, Never Cancel", body:"Canceling kills your reservation. Modifying preserves it AND doesn't reset your 2-hour clock. Modify as many times as you want while the window is open." },
    { id:"sep",   icon:"🎟", title:"Select Experience Pass (SEP)", body:"Ride breaks down during your active window → SEP issued automatically in My Plans. Bonus pass — doesn't count as one-use. Book again immediately. Save for a high-value afternoon ride." },
    { id:"stack", icon:"📚", title:"Stacking",                    body:"Book Tier 1 early → don't ride yet. Modify window into afternoon. Every 2hrs book another, push it late. Ride standby <30min in morning. By 2pm you have 3+ stacked LLs when waits are 75-100 min." },
    { id:"sb",    icon:"🚶", title:"When to Skip LL",             body:"Standby ≤30 min = walk on and save your LL slot. Especially for Tier 1/2 rides — you want those slots for when waits hit 75-100 min in the afternoon." },
    { id:"sep2",  icon:"⚡", title:"SEP Timing Trick",            body:"Wait 30-45 min into your return window before modifying. If the ride goes down during that window you get an SEP. Modifying too early forfeits eligibility." },
  ];

  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif", background:"#080b14", minHeight:"100vh", color:"#dde4f0", maxWidth:480, margin:"0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,700&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#0e1628 0%,#080b14 100%)", padding:"14px 14px 0", borderBottom:"1px solid rgba(250,204,21,0.1)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:9 }}>
            <div style={{ width:32, height:32, borderRadius:7, background:"linear-gradient(135deg,#b45309,#facc15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>⚡</div>
            <div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:17, color:"#facc15", lineHeight:1 }}>LL OPTIMIZER</div>
              <div style={{ fontSize:9, color:"#64748b", letterSpacing:1, textTransform:"uppercase" }}>LL University · Park Hop Insider</div>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
            {/* Day selector */}
            <div style={{ display:"flex", gap:4 }}>
              {[1,2].map(d => (
                <button key={d} onClick={()=>setTripDay(d)} style={{ padding:"3px 10px", border:`1px solid ${tripDay===d?"rgba(250,204,21,0.4)":"rgba(255,255,255,0.08)"}`, borderRadius:5, cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"'DM Sans',sans-serif", background:tripDay===d?"rgba(250,204,21,0.1)":"transparent", color:tripDay===d?"#facc15":"#475569" }}>
                  Day {d}
                </button>
              ))}
            </div>
            <button onClick={polling?stopPolling:startPolling} style={{ background:polling?"rgba(74,222,128,0.12)":"rgba(250,204,21,0.1)", border:`1px solid ${polling?"rgba(74,222,128,0.3)":"rgba(250,204,21,0.25)"}`, color:polling?"#4ade80":"#facc15", borderRadius:5, padding:"4px 9px", cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>
              {polling?"● LIVE":"▶ START"}
            </button>
            {polling && <div style={{ fontSize:8, color:"#475569" }}>next: {countdown}s · {pollCount} polls</div>}
            {dbStatus==="saving" && <div style={{ fontSize:8, color:"#facc15" }}>💾 saving...</div>}
            {dbStatus==="saved"  && <div style={{ fontSize:8, color:"#4ade80" }}>✓ saved</div>}
            {hasYesterday && <div style={{ fontSize:8, color:"#c084fc" }}>📊 yesterday loaded</div>}
          </div>
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div style={{ background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:6, padding:"6px 10px", marginBottom:7 }}>
            {alerts.map((a,i) => <div key={i} style={{ fontSize:11, color:"#4ade80", fontWeight:700 }}>🟢 {a}</div>)}
            <button onClick={()=>setAlerts([])} style={{ fontSize:9, color:"#334155", background:"none", border:"none", cursor:"pointer" }}>dismiss</button>
          </div>
        )}

        {/* Day context banner */}
        <div style={{ background:"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:6, padding:"5px 10px", marginBottom:7, fontSize:10, color:"#818cf8" }}>
          {tripDay===1 ? "📍 Day 1 — Start DL → Hop to DCA after 11am" : "📍 Day 2 — Start DCA → Hop to DL anytime"}
        </div>

        <div style={{ background:"rgba(251,146,60,0.06)", border:"1px solid rgba(251,146,60,0.12)", borderRadius:6, padding:"5px 10px", marginBottom:8, fontSize:9, color:"#fb923c" }}>
          ⚠️ Closed: Pirates of the Caribbean · Buzz Lightyear Astro Blasters
        </div>

        <div style={{ display:"flex", marginBottom:"-1px" }}>
          {[["waits","📊","Waits"],["data","📈","Data"],["planner","🎢","Rides"],["tips","💡","Guide"],["optimizer","🧠","AI"]].map(([key,icon,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{ flex:1, padding:"7px 0", border:"none", cursor:"pointer", background:"transparent", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:tab===key?700:400, color:tab===key?"#facc15":"#475569", borderBottom:`2px solid ${tab===key?"#facc15":"transparent"}`, transition:"all 0.15s" }}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:13 }}>

        {/* ── WAITS ── */}
        {tab==="waits" && (
          <div>
            {!polling && (
              <div style={{ background:"rgba(250,204,21,0.04)", border:"1px solid rgba(250,204,21,0.1)", borderRadius:9, padding:"14px 16px", marginBottom:12, textAlign:"center" }}>
                <div style={{ fontSize:22, marginBottom:5 }}>📡</div>
                <div style={{ fontSize:13, fontWeight:700, color:"#facc15", marginBottom:3 }}>Start Live Tracking</div>
                <div style={{ fontSize:11, color:"#64748b", marginBottom:10, lineHeight:1.5 }}>
                  Polls every 5 min · saves to database · builds trend history
                  {hasYesterday && <span style={{ color:"#c084fc" }}> · yesterday's data loaded ✓</span>}
                </div>
                <button onClick={startPolling} style={{ background:"linear-gradient(135deg,#92400e,#facc15)", border:"none", borderRadius:7, padding:"9px 22px", color:"#080b14", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13, cursor:"pointer" }}>
                  ▶ START TRACKING
                </button>
              </div>
            )}

            {polling && (
              <div style={{ display:"flex", gap:5, marginBottom:10 }}>
                {[["● LIVE","#4ade80","rgba(74,222,128,0.12)"],["rgba(74,222,128,0.15)"]].length && [
                  ["Status","● Live","#4ade80"],
                  ["Polls",`${pollCount} (${Math.round(pollCount*5/60*10)/10}hr)`,"#dde4f0"],
                  ["Next",`${countdown}s`,"#dde4f0"],
                ].map(([label,val,c])=>(
                  <div key={label} style={{ flex:1, background:"#0e1628", borderRadius:7, padding:"7px 10px", border:"1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ fontSize:8, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>{label}</div>
                    <div style={{ fontSize:12, fontWeight:700, color:c }}>{val}</div>
                  </div>
                ))}
              </div>
            )}

            {hasYesterday && (
              <div style={{ background:"rgba(192,132,252,0.06)", border:"1px solid rgba(192,132,252,0.15)", borderRadius:7, padding:"5px 10px", marginBottom:10, fontSize:10, color:"#c084fc" }}>
                📊 Yesterday's data loaded — dashed lines on sparklines show yesterday's pattern
              </div>
            )}

            {[["DL","🏰 Disneyland",waitsDL,"#818cf8"],["DCA","🎡 Cal Adventure",waitsDCA,"#f87171"]].map(([pk,label,waits,accent])=>(
              <div key={pk} style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(255,255,255,0.05)", marginBottom:10, overflow:"hidden" }}>
                <div style={{ padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontWeight:700, fontSize:12, color:accent }}>{label}</div>
                {!waits ? (
                  <div style={{ padding:18, textAlign:"center", color:"#334155", fontSize:11 }}>{polling?"Loading first poll…":"Tap Start Tracking"}</div>
                ) : (() => {
                  const parkFavs = favorites.filter(f => f.park === pk);
                  const filtered = parkFavs.map(fav => waits.find(w => w.name === fav.name)).filter(Boolean);
                  if (filtered.length === 0) return <div style={{ padding:18, textAlign:"center", color:"#334155", fontSize:11 }}>No priority rides found in live data</div>;
                  return filtered.map(ride => {
                    const meta    = getRideMeta(ride.name);
                    const rHist   = history[ride.name]?.map(s=>s.wait);
                    const rYest   = yesterday[ride.name]?.map(s=>s.wait);
                    const isClosed = ride.name.includes("Buzz Lightyear")||ride.name.includes("Pirates");
                    return (
                      <div key={ride.id} style={{ display:"flex", alignItems:"center", padding:"6px 12px", borderBottom:"1px solid rgba(255,255,255,0.03)", gap:6, opacity:isClosed?0.3:1 }}>
                        <span style={{ fontSize:8, flexShrink:0 }}>⭐</span>
                        <span style={{ flex:1, fontSize:11, color:"#dde4f0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ride.name}</span>
                        {meta && <span style={{ fontSize:8, padding:"1px 4px", borderRadius:8, background:`${TIER_COLOR[meta.tier]}20`, color:TIER_COLOR[meta.tier], fontWeight:700, flexShrink:0 }}>{TIER_LABEL[meta.tier]}</span>}
                        {rHist && rHist.length >= 2 && <Sparkline data={rHist.slice(-12)} yesterdayData={rYest?.slice(-12)} color={WAIT_COLOR(ride.wait)}/>}
                        {ride.wait <= 30 && !isClosed && <span style={{ fontSize:8, color:"#4ade80", fontWeight:700, flexShrink:0 }}>WALK</span>}
                        <span style={{ fontSize:11, fontWeight:700, color:WAIT_COLOR(ride.wait), minWidth:34, textAlign:"right", flexShrink:0 }}>{ride.wait}m</span>
                      </div>
                    );
                  });
                })()}
              </div>
            ))}

            <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", fontSize:9, color:"#475569" }}>
              {[["#4ade80","≤20m"],["#facc15","21-40m"],["#fb923c","41-60m"],["#f87171",">60m"]].map(([c,l])=>(
                <span key={l} style={{ display:"flex", alignItems:"center", gap:3 }}><span style={{ width:6, height:6, borderRadius:"50%", background:c, display:"inline-block" }}/>{l}</span>
              ))}
              {hasYesterday && <span>· - - - yesterday</span>}
            </div>
          </div>
        )}

        {/* ── DATA TAB ── */}
        {tab==="data" && (
          <div>
            <div style={{ background:"rgba(250,204,21,0.04)", border:"1px solid rgba(250,204,21,0.1)", borderRadius:8, padding:"9px 12px", marginBottom:11, fontSize:11, color:"#a16207", lineHeight:1.5 }}>
              📊 Historical wait time patterns from <strong style={{ color:"#facc15" }}>Thrill Data</strong> — typical June patterns for each of your priority rides. Use this as your morning briefing.
            </div>

            {/* Park filter */}
            <div style={{ display:"flex", gap:7, marginBottom:11 }}>
              {["ALL","DL","DCA"].map(p => (
                <button key={p} onClick={()=>setActivePark(p==="ALL"?"ALL":p)}
                  style={{ flex:1, padding:"7px 0", border:`1px solid ${activePark===p||(!["DL","DCA"].includes(activePark)&&p==="ALL")?"rgba(250,204,21,0.3)":"rgba(255,255,255,0.07)"}`, borderRadius:7, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:700, fontSize:11, background:activePark===p||(!["DL","DCA"].includes(activePark)&&p==="ALL")?"rgba(250,204,21,0.1)":"transparent", color:activePark===p||(!["DL","DCA"].includes(activePark)&&p==="ALL")?"#facc15":"#475569" }}>
                  {p==="ALL"?"Both Parks":p==="DL"?"🏰 Disneyland":"🎡 Cal Adventure"}
                </button>
              ))}
            </div>

            {favorites.filter(f => activePark==="ALL"||!["DL","DCA"].includes(activePark)||f.park===activePark).map(fav => {
              const rd = RIDE_HISTORY[fav.name];
              if (!rd) return null;
              const hours = Object.keys(rd.hourly).map(Number).sort((a,b)=>a-b);
              const waits = hours.map(h => rd.hourly[h]);
              const peak = Math.max(...waits);
              const min = Math.min(...waits);
              const liveW = [...(waitsDL||[]),...(waitsDCA||[])].find(w=>w.name===fav.name);
              const meta = getRideMeta(fav.name);
              return (
                <div key={fav.name} style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(255,255,255,0.05)", marginBottom:10, overflow:"hidden" }}>
                  {/* Header */}
                  <div style={{ padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:"#dde4f0" }}>{fav.name}</div>
                      <div style={{ display:"flex", gap:6, marginTop:3, alignItems:"center" }}>
                        {meta && <span style={{ fontSize:8, padding:"1px 5px", borderRadius:8, background:`${TIER_COLOR[meta.tier]}20`, color:TIER_COLOR[meta.tier], fontWeight:700 }}>{TIER_LABEL[meta.tier]}</span>}
                        <span style={{ fontSize:9, color:"#475569" }}>Peak: {rd.peak}</span>
                        <span style={{ fontSize:9, color:"#4ade80" }}>Walk on: {rd.walkBefore}</span>
                      </div>
                    </div>
                    {liveW && <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:9, color:"#475569" }}>LIVE NOW</div>
                      <div style={{ fontSize:14, fontWeight:700, color:WAIT_COLOR(liveW.wait) }}>{liveW.wait}m</div>
                    </div>}
                  </div>

                  {/* Stat row */}
                  <div style={{ display:"flex", gap:6, padding:"7px 12px", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    {[["Peak",`${peak}min`,"#f87171"],["Low",`${min}min`,"#4ade80"],["Walk Before",rd.walkBefore,"#facc15"]].map(([label,val,c])=>(
                      <div key={label} style={{ flex:1, background:"rgba(255,255,255,0.03)", borderRadius:6, padding:"5px 6px", textAlign:"center" }}>
                        <div style={{ fontSize:8, color:"#475569", marginBottom:1 }}>{label}</div>
                        <div style={{ fontSize:10, fontWeight:700, color:c }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Hourly bars */}
                  <div style={{ padding:"8px 12px" }}>
                    <div style={{ display:"flex", gap:3, alignItems:"flex-end", height:50, marginBottom:6 }}>
                      {hours.map(hr => {
                        const w = rd.hourly[hr];
                        const pct = Math.round((w/peak)*100);
                        const label = hr > 12 ? `${hr-12}p` : hr===12 ? "12p" : `${hr}a`;
                        return (
                          <div key={hr} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                            <div style={{ width:"100%", height:`${pct}%`, minHeight:3, background:WAIT_COLOR(w), borderRadius:"2px 2px 0 0", opacity:0.85 }}/>
                            <div style={{ fontSize:7, color:"#334155", transform:"rotate(-45deg)", transformOrigin:"center", marginTop:2 }}>{label}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize:10, color:"#64748b", lineHeight:1.5, marginTop:8, fontStyle:"italic" }}>💡 {rd.tip}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── RIDES ── */}        {/* ── RIDES ── */}
        {tab==="planner" && (
          <div>
            <div style={{ display:"flex", gap:7, marginBottom:11 }}>
              {["DL","DCA"].map(p=>(
                <button key={p} onClick={()=>setActivePark(p)} style={{ flex:1, padding:"7px 0", border:`1px solid ${activePark===p?(p==="DL"?"rgba(129,140,248,0.4)":"rgba(248,113,113,0.4)"):"rgba(255,255,255,0.07)"}`, borderRadius:7, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:700, fontSize:12, background:activePark===p?(p==="DL"?"rgba(99,102,241,0.12)":"rgba(239,68,68,0.1)"):"transparent", color:activePark===p?(p==="DL"?"#818cf8":"#f87171"):"#475569" }}>
                  {p==="DL"?"🏰 Disneyland":"🎡 Cal Adventure"}
                </button>
              ))}
            </div>

            {favorites.length > 0 && (
              <div style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(250,204,21,0.12)", marginBottom:11, overflow:"hidden" }}>
                <div style={{ padding:"8px 13px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700, fontSize:12, color:"#facc15" }}>⭐ MY PRIORITY LIST</span>
                  <span style={{ fontSize:9, color:"#475569" }}>Drag to reorder</span>
                </div>
                {favorites.map((fav,i)=>{
                  const meta    = getRideMeta(fav.name);
                  const liveW   = [...(waitsDL||[]),...(waitsDCA||[])].find(w=>w.name===fav.name);
                  const rHist   = history[fav.name]?.map(s=>s.wait);
                  const rYest   = yesterday[fav.name]?.map(s=>s.wait);
                  return (
                    <div key={fav.name} draggable onDragStart={()=>handleDragStart(i)} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(i)}
                      style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 11px", borderBottom:"1px solid rgba(255,255,255,0.04)", cursor:"grab", background:dragIdx===i?"rgba(250,204,21,0.04)":"transparent", opacity:meta?.closed?0.5:1 }}>
                      <span style={{ color:"#facc15", fontFamily:"'Syne',sans-serif", fontSize:12, width:16, textAlign:"center", flexShrink:0 }}>{i+1}</span>
                      <span style={{ flex:1, fontSize:12 }}>{fav.name}{meta?.closed?" ⚠️":""}</span>
                      {rHist && rHist.length >= 2 && <Sparkline data={rHist.slice(-8)} yesterdayData={rYest?.slice(-8)} color={liveW?WAIT_COLOR(liveW.wait):"#facc15"}/>}
                      {liveW && <span style={{ fontSize:11, fontWeight:700, color:WAIT_COLOR(liveW.wait), flexShrink:0 }}>{liveW.wait}m</span>}
                      {meta && <span style={{ fontSize:8, padding:"1px 4px", borderRadius:8, background:`${TIER_COLOR[meta.tier]}20`, color:TIER_COLOR[meta.tier], fontWeight:700, flexShrink:0 }}>{TIER_LABEL[meta.tier]}</span>}
                      <button onClick={()=>removeFav(fav.name)} style={{ background:"none", border:"none", color:"#334155", cursor:"pointer", fontSize:13, padding:"0 2px", flexShrink:0 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {[["tier1","🔴 Tier 1 — Book First"],["tier2","🟠 Tier 2 — Early Afternoon"],["tier3","🟢 Tier 3 — Available Late"],["nonLL_A","🟣 No LL · A — Before 11am"],["nonLL_B","🔵 No LL · B — Before 2pm"]].map(([tier,label])=>{
              const rides = tierData[tier];
              if (!rides||rides.length===0) return null;
              return (
                <div key={tier} style={{ marginBottom:8, background:"#0e1628", borderRadius:9, border:"1px solid rgba(255,255,255,0.05)", overflow:"hidden" }}>
                  <div style={{ padding:"7px 13px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:10, fontWeight:700, color:TIER_COLOR[tier] }}>{label}</div>
                  {rides.map(ride=>{
                    const added  = favNames.has(ride.name);
                    const liveW  = currentWaits?.find(w=>w.name.toLowerCase().includes(ride.name.toLowerCase().slice(0,14)));
                    const rHist  = history[ride.name]?.map(s=>s.wait);
                    const rYest  = yesterday[ride.name]?.map(s=>s.wait);
                    return (
                      <div key={ride.name} style={{ display:"flex", alignItems:"center", padding:"6px 11px", borderBottom:"1px solid rgba(255,255,255,0.03)", gap:6, opacity:ride.closed?0.4:1 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, color:added?"#94a3b8":"#dde4f0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{ride.name}</div>
                          <div style={{ fontSize:9, color:ride.closed?"#fb923c":"#475569", marginTop:1 }}>{ride.note}</div>
                        </div>
                        {rHist && rHist.length >= 2 && <Sparkline data={rHist.slice(-8)} yesterdayData={rYest?.slice(-8)} color={liveW?WAIT_COLOR(liveW.wait):"#64748b"}/>}
                        {liveW && !ride.closed && <span style={{ fontSize:10, fontWeight:700, color:WAIT_COLOR(liveW.wait), flexShrink:0 }}>{liveW.wait}m</span>}
                        {!ride.closed && (
                          <button onClick={()=>added?removeFav(ride.name):addFav(ride.name,activePark)} style={{ flexShrink:0, background:added?"rgba(239,68,68,0.08)":"rgba(250,204,21,0.08)", border:`1px solid ${added?"rgba(239,68,68,0.2)":"rgba(250,204,21,0.18)"}`, color:added?"#f87171":"#facc15", borderRadius:5, padding:"3px 8px", cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>
                            {added?"−":"+"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* ── GUIDE ── */}
        {tab==="tips" && (
          <div>
            <div style={{ background:"rgba(250,204,21,0.04)", border:"1px solid rgba(250,204,21,0.1)", borderRadius:8, padding:"9px 12px", marginBottom:11, fontSize:11, color:"#a16207", lineHeight:1.5 }}>
              Strategies from <strong style={{ color:"#facc15" }}>LL University</strong> by Park Hop Insider (April 2026). Tap to expand.
            </div>
            {tips.map(tip=>(
              <div key={tip.id} onClick={()=>setExpandedTip(expandedTip===tip.id?null:tip.id)}
                style={{ background:"#0e1628", borderRadius:8, border:`1px solid ${expandedTip===tip.id?"rgba(250,204,21,0.15)":"rgba(255,255,255,0.05)"}`, marginBottom:6, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px" }}>
                  <span style={{ fontSize:15 }}>{tip.icon}</span>
                  <span style={{ flex:1, fontWeight:700, fontSize:12, color:expandedTip===tip.id?"#facc15":"#dde4f0" }}>{tip.title}</span>
                  <span style={{ color:"#475569", fontSize:10, display:"inline-block", transform:expandedTip===tip.id?"rotate(90deg)":"none", transition:"transform 0.15s" }}>▶</span>
                </div>
                {expandedTip===tip.id && <div style={{ padding:"0 12px 12px", paddingTop:9, fontSize:12, color:"#94a3b8", lineHeight:1.65, borderTop:"1px solid rgba(255,255,255,0.05)" }}>{tip.body}</div>}
              </div>
            ))}
            <div style={{ background:"#0e1628", borderRadius:8, border:"1px solid rgba(255,255,255,0.05)", marginTop:11, overflow:"hidden" }}>
              <div style={{ padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontWeight:700, fontSize:11, color:"#facc15" }}>📋 Your Trip — Demand Tiers</div>
              {[
                ["DL 🔴 T1","Indiana Jones · Space Mountain · Mickey & Minnie's","Book FIRST — noon sellout","#f87171"],
                ["DL 🟠 T2","Matterhorn · Big Thunder · Tiana's · Haunted Mansion","Late afternoon sellout","#fb923c"],
                ["DL 🟢 T3","Smugglers Run · Star Tours","Available late day","#4ade80"],
                ["DL 🟣 No LL·A","Rise of the Resistance","Single Pass — before 11am","#c084fc"],
                ["DL 🔵 No LL·B","Jungle Cruise (Pirates ⚠️ closed)","Before 2pm","#60a5fa"],
                ["DCA 🔴 T1","Guardians BREAKOUT · Toy Story Mania","Book FIRST in DCA","#f87171"],
                ["DCA 🟠 T2","Soarin' · Goofy's Sky School · Incredicoaster","Late afternoon","#fb923c"],
                ["DCA 🟢 T3","Web Slingers · Little Mermaid · Monsters Inc · Grizzly","Most of day","#4ade80"],
                ["DCA 🟣 No LL·A","Radiator Springs Racers","Single Pass or before 11am","#c084fc"],
              ].map(([label,rides,note,c])=>(
                <div key={label} style={{ padding:"7px 12px", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:2 }}>
                    <span style={{ fontSize:9, fontWeight:700, color:c }}>{label}</span>
                    <span style={{ fontSize:9, color:"#475569" }}>— {note}</span>
                  </div>
                  <div style={{ fontSize:10, color:"#64748b" }}>{rides}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── AI ── */}
        {tab==="optimizer" && (
          <div>
            <div style={{ display:"flex", gap:5, marginBottom:11, flexWrap:"wrap" }}>
              {[[favorites.length>0,`${favorites.length} rides`],[!!(waitsDL||waitsDCA),"Waits loaded"],[pollCount>0,`${pollCount} polls · ${Math.round(pollCount*5/60*10)/10}hr`],[hasYesterday,"Yesterday loaded"],[!!screenshot,"Screenshot"]].map(([ok,label],i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:12, background:ok?"rgba(74,222,128,0.07)":"rgba(255,255,255,0.03)", border:`1px solid ${ok?"rgba(74,222,128,0.18)":"rgba(255,255,255,0.06)"}`, fontSize:9, color:ok?"#4ade80":"#475569" }}>
                  {ok?"✓":"○"} {label}
                </div>
              ))}
            </div>

            {/* Day context */}
            <div style={{ background:"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.15)", borderRadius:7, padding:"7px 11px", marginBottom:10, fontSize:11, color:"#818cf8" }}>
              {tripDay===1
                ? "📍 Day 1 strategy: Stack DL Tier 1 LLs → ride standby AM → hop DCA after 11am with LLs stacked"
                : "📍 Day 2 strategy: RSR at rope drop → Guardians + Toy Story LL → hop DL anytime"}
            </div>

            {/* Strategy */}
            <div style={{ background:"#0e1628", borderRadius:8, border:"1px solid rgba(255,255,255,0.05)", marginBottom:10, overflow:"hidden" }}>
              <div style={{ padding:"7px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:10, fontWeight:700, color:"#94a3b8" }}>STRATEGY</div>
              {[["bookredeem","📖 Book & Redeem","Simple — one LL at a time"],["stack","📚 Stacking","Build afternoon LL block, standby in AM"],["elite","⚡ Elite Combo","Stack AM + Book & Redeem PM — max ride count"]].map(([val,label,desc])=>(
                <div key={val} onClick={()=>setStrategy(val)} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.03)", cursor:"pointer", background:strategy===val?"rgba(250,204,21,0.04)":"transparent" }}>
                  <div style={{ width:13, height:13, borderRadius:"50%", border:`2px solid ${strategy===val?"#facc15":"#334155"}`, background:strategy===val?"#facc15":"transparent", flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:strategy===val?"#facc15":"#dde4f0" }}>{label}</div>
                    <div style={{ fontSize:10, color:"#475569" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Screenshot */}
            <div style={{ background:"#0e1628", borderRadius:8, border:"1px solid rgba(255,255,255,0.05)", marginBottom:10, overflow:"hidden" }}>
              <div style={{ padding:"7px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:10, fontWeight:700, color:"#94a3b8" }}>📱 LL SCREENSHOT (OPTIONAL)</div>
              <div style={{ padding:10 }}>
                {screenshotPreview ? (
                  <div>
                    <img src={screenshotPreview} alt="LL" style={{ width:"100%", borderRadius:6, maxHeight:240, objectFit:"contain", background:"#080b14" }}/>
                    <button onClick={()=>{setScreenshot(null);setScreenshotPreview(null);setAiResult(null);}} style={{ marginTop:6, background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.15)", color:"#f87171", borderRadius:5, padding:"3px 9px", cursor:"pointer", fontSize:10, fontFamily:"'DM Sans',sans-serif" }}>Remove</button>
                  </div>
                ) : (
                  <div onClick={()=>fileRef.current?.click()} style={{ border:"2px dashed rgba(250,204,21,0.1)", borderRadius:6, padding:"18px 14px", textAlign:"center", cursor:"pointer" }}>
                    <div style={{ fontSize:24, marginBottom:4 }}>📷</div>
                    <div style={{ fontSize:11, color:"#64748b" }}>Upload your LL return times screenshot</div>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display:"none" }}/>
                  </div>
                )}
              </div>
            </div>

            <button onClick={runAnalysis} disabled={aiLoading} style={{ width:"100%", padding:"11px 0", border:"none", borderRadius:8, cursor:aiLoading?"not-allowed":"pointer", background:aiLoading?"rgba(250,204,21,0.07)":"linear-gradient(135deg,#92400e,#facc15)", color:aiLoading?"#475569":"#080b14", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:15, letterSpacing:0.8, marginBottom:12 }}>
              {aiLoading?"ANALYZING…":"⚡ OPTIMIZE MY DAY"}
            </button>

            {aiResult && (
              <div style={{ background:"#0e1628", borderRadius:8, border:"1px solid rgba(250,204,21,0.13)", overflow:"hidden" }}>
                <div style={{ padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontSize:14 }}>🧠</span>
                  <span style={{ fontWeight:700, fontSize:12, color:"#facc15" }}>AI RECOMMENDATION</span>
                  <span style={{ fontSize:9, color:"#475569", marginLeft:"auto" }}>
                    Day {tripDay} · {Math.round(pollCount*5/60*10)/10}hr data{hasYesterday?" · +yesterday":""}
                  </span>
                </div>
                <div style={{ padding:12, fontSize:12, lineHeight:1.75, color:"#94a3b8", whiteSpace:"pre-wrap" }}>{aiResult}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
