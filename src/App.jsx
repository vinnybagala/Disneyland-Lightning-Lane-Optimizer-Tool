import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const PARK_IDS = {
  DL:  "83cceffa-2120-4b1e-a90e-486e1d09b07e",
  DCA: "47f90d2c-e191-4239-a466-5892ef59a88b",
};
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_HISTORY = 48; // 4 hours of 5-min snapshots

// ─── Ride Data ────────────────────────────────────────────────────────────────
const LL_TIERS = {
  DL: {
    tier1: [
      { name: "Indiana Jones Adventure",            note: "Book FIRST — sells out by noon" },
      { name: "Space Mountain",                     note: "Book FIRST — sells out by noon" },
      { name: "Mickey & Minnie's Runaway Railway",  note: "Book FIRST — sells out by noon" },
    ],
    tier2: [
      { name: "Matterhorn Bobsleds",                note: "Late afternoon sellout" },
      { name: "Big Thunder Mountain Railroad",      note: "Late afternoon sellout" },
      { name: "Tiana's Bayou Adventure",            note: "Late afternoon sellout" },
      { name: "Haunted Mansion",                    note: "Late afternoon sellout" },
    ],
    tier3: [
      { name: "Millennium Falcon: Smugglers Run",   note: "Rarely urgent — book later in day" },
      { name: "Star Tours",                         note: "Rarely urgent — book later in day" },
    ],
    nonLL_A: [
      { name: "Rise of the Resistance",             note: "Single Pass only — before 11am" },
    ],
    nonLL_B: [
      { name: "Pirates of the Caribbean",           note: "⚠️ CLOSED THIS TRIP", closed: true }, 
      { name: "Jungle Cruise",                      note: "No LL — ride before 2pm" },
    ],
  },
  DCA: {
    tier1: [
      { name: "Guardians of the Galaxy – Mission: BREAKOUT!", note: "Book FIRST in DCA" },
      { name: "Toy Story Midway Mania!",             note: "Book second in DCA" },
    ],
    tier2: [
      { name: "Soarin' Around the World",            note: "Ride standby <30min early or LL later" },
      { name: "Goofy's Sky School",                  note: "Late afternoon sellout" },
      { name: "Incredicoaster",                      note: "Late afternoon sellout" },
    ],
    tier3: [
      { name: "WEB SLINGERS: A Spider-Man Adventure", note: "Available most of day" },
      { name: "The Little Mermaid",                  note: "Available most of day" },
      { name: "Monsters Inc. Mike & Sulley",         note: "Available most of day" },
      { name: "Grizzly River Run",                   note: "Tier 2 in summer heat" },
    ],
    nonLL_A: [
      { name: "Radiator Springs Racers",             note: "Single Pass or ride before 11am" },
    ],
    nonLL_B: [],
  },
};

const ALL_RIDES = Object.values(LL_TIERS).flatMap(p => Object.values(p).flat());
const TIER_COLOR  = { tier1:"#f87171", tier2:"#fb923c", tier3:"#4ade80", nonLL_A:"#c084fc", nonLL_B:"#60a5fa" };
const TIER_LABEL  = { tier1:"T1·LL", tier2:"T2·LL", tier3:"T3·LL", nonLL_A:"No LL·A", nonLL_B:"No LL·B" };
const WAIT_COLOR  = (w) => w <= 20 ? "#4ade80" : w <= 40 ? "#facc15" : w <= 60 ? "#fb923c" : "#f87171";

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

// ─── API ──────────────────────────────────────────────────────────────────────
async function fetchWaits(parkId) {
  try {
    const res = await fetch(`https://api.themeparks.wiki/v1/entity/${parkId}/live`, { headers:{ Accept:"application/json" }});
    if (!res.ok) throw new Error();
    const data = await res.json();
    return (data.liveData||[])
      .filter(e => e.entityType==="ATTRACTION" && e.queue?.STANDBY?.waitTime != null)
      .map(e => ({ id:e.id, name:e.name, wait:e.queue.STANDBY.waitTime, status:e.status }))
      .sort((a,b) => b.wait - a.wait);
  } catch { return null; }
}

// ─── AI System Prompt ─────────────────────────────────────────────────────────
const AI_SYSTEM = `You are an expert Disneyland Lightning Lane optimizer trained on LL University (Park Hop Insider, April 2026).

CORE RULES:
- Scan into park first, then activate LL Multi Pass
- Book 1st LL immediately upon scan-in
- Rebook: after redeeming most recent LL OR 2 hours after booking — whichever comes FIRST
- Two-hour timer based on BOOKING time, not return time
- Always MODIFY, never cancel — modifying preserves 2-hr clock
- Hold multiple LLs simultaneously — no fixed cap
- Each attraction: one LL redemption per day
- Return windows: 1 hour. ~5 min early, ~15 min late grace (not guaranteed)
- LL Single Pass does NOT affect Multi Pass timer
- SEP: issued if ride breaks down during ACTIVE window. Bonus pass — doesn't count as one-use. Book again immediately. Save for afternoon.
- Don't modify until 30-45 min into return window — preserves SEP eligibility

DEMAND TIERS (THIS TRIP):
DL Tier 1 (book FIRST): Indiana Jones, Space Mountain, Mickey & Minnie's Railway → sell out by noon
DL Tier 2: Matterhorn, Big Thunder, Tiana's Bayou, Haunted Mansion → late afternoon sellout
DL Tier 3: Smugglers Run, Star Tours → available late day
DL Non-LL A (before 11am): Rise of the Resistance (Single Pass)
DL Non-LL B (before 2pm): Jungle Cruise (Pirates of the Caribbean is CLOSED this trip)
DCA Tier 1 (book FIRST): Guardians BREAKOUT, Toy Story Mania → early afternoon sellout
DCA Tier 2: Soarin', Goofy's Sky School, Incredicoaster → late afternoon
DCA Tier 3: Web Slingers, Little Mermaid, Monsters Inc, Grizzly River Run
DCA Non-LL A (before 11am): Radiator Springs Racers

CLOSED THIS TRIP: Pirates of the Caribbean, Buzz Lightyear Astro Blasters — never recommend these. Star Tours IS open and available.

STRATEGIES:
- BOOK & REDEEM: Book earliest LL → ride → book next. Simple.
- STACKING: Book Tier 1 early, push return windows via Modify into afternoon. Every 2hrs book another. Ride standby <30min in morning. By 2pm have 3+ stacked LLs.
- ELITE COMBO: Stack AM + Book & Redeem PM at ~2pm for Tier 3. Best ride count.

STANDBY RULE: Standby ≤30 min = walk on, save LL slot. Afternoon waits hit 75-100 min on Tier 1/2 rides.

TREND ANALYSIS: You will receive historical wait time data (snapshots every 5 minutes). Use this to:
- Identify rising trends (book LL NOW before it gets worse)
- Identify falling trends (wait it out, ride standby soon)
- Predict peak windows based on trajectory
- Spot anomalies (sudden drop may mean ride had downtime — SEP opportunity)

Be sharp, specific, numbered. Reference actual ride names and wait times. Give a clear sequence.`;

// ─── Sparkline component ──────────────────────────────────────────────────────
function Sparkline({ data, color = "#facc15", width = 60, height = 24 }) {
  if (!data || data.length < 2) return <span style={{ fontSize:10, color:"#334155" }}>—</span>;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const arrow = last > prev ? "↑" : last < prev ? "↓" : "→";
  const arrowColor = last > prev ? "#f87171" : last < prev ? "#4ade80" : "#facc15";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      <svg width={width} height={height} style={{ overflow:"visible" }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.7"/>
        <circle cx={parseFloat(pts.split(" ").pop().split(",")[0])} cy={parseFloat(pts.split(" ").pop().split(",")[1])} r="2.5" fill={color}/>
      </svg>
      <span style={{ fontSize:11, color:arrowColor, fontWeight:700 }}>{arrow}</span>
    </div>
  );
}

// ─── Trend summary for AI ─────────────────────────────────────────────────────
function buildTrendSummary(history) {
  if (!history || Object.keys(history).length === 0) return "(no trend data yet — poll running)";
  const lines = [];
  for (const [name, snapshots] of Object.entries(history)) {
    if (snapshots.length < 2) continue;
    const waits = snapshots.map(s => s.wait);
    const current = waits[waits.length - 1];
    const oldest = waits[0];
    const max = Math.max(...waits);
    const min = Math.min(...waits);
    const trend = current > oldest + 5 ? "RISING" : current < oldest - 5 ? "FALLING" : "STABLE";
    lines.push(`${name}: ${current}min now (${trend} — was ${oldest}min ${snapshots.length * 5}min ago, range ${min}-${max}min today)`);
  }
  return lines.length > 0 ? lines.join("\n") : "(collecting data...)";
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]                 = useState("waits");
  const [favorites, setFavorites]     = useState([]);
  const [dragIdx, setDragIdx]         = useState(null);
  const [activePark, setActivePark]   = useState("DL");
  const [waitsDL, setWaitsDL]         = useState(null);
  const [waitsDCA, setWaitsDCA]       = useState(null);
  const [history, setHistory]         = useState({});  // { rideName: [{time, wait}] }
  const [polling, setPolling]         = useState(false);
  const [pollCount, setPollCount]     = useState(0);
  const [lastFetched, setLastFetched] = useState(null);
  const [nextPoll, setNextPoll]       = useState(null);
  const [waitsLoading, setWaitsLoading] = useState(false);
  const [screenshot, setScreenshot]   = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [aiResult, setAiResult]       = useState(null);
  const [aiLoading, setAiLoading]     = useState(false);
  const [strategy, setStrategy]       = useState("elite");
  const [expandedTip, setExpandedTip] = useState(null);
  const [alerts, setAlerts]           = useState([]);
  const pollTimer = useRef(null);
  const countdownTimer = useRef(null);
  const [countdown, setCountdown]     = useState(0);
  const fileRef = useRef();

  // ── Poll function ────────────────────────────────────────────────────────────
  const doPoll = useCallback(async (silent = false) => {
    if (!silent) setWaitsLoading(true);
    const [dl, dca] = await Promise.all([fetchWaits(PARK_IDS.DL), fetchWaits(PARK_IDS.DCA)]);
    const now = new Date();
    if (dl || dca) {
      if (dl) setWaitsDL(dl);
      if (dca) setWaitsDCA(dca);
      setLastFetched(now);
      setPollCount(c => c + 1);
      setNextPoll(new Date(now.getTime() + POLL_INTERVAL));

      // Update history
      const allNew = [...(dl||[]), ...(dca||[])];
      setHistory(prev => {
        const next = { ...prev };
        for (const ride of allNew) {
          const key = ride.name;
          const existing = next[key] || [];
          const updated = [...existing, { time: now.toISOString(), wait: ride.wait }].slice(-MAX_HISTORY);
          next[key] = updated;
        }
        return next;
      });

      // Check alerts — rides on favorites list that dropped under 30 min
      setFavorites(favs => {
        const newAlerts = [];
        for (const fav of favs) {
          const live = allNew.find(r => r.name === fav.name);
          if (live && live.wait <= 30) {
            const meta = getRideMeta(fav.name);
            if (meta && (meta.tier === "tier1" || meta.tier === "tier2")) {
              newAlerts.push(`${fav.name} just dropped to ${live.wait} min — walk on now!`);
            }
          }
        }
        if (newAlerts.length > 0) setAlerts(newAlerts);
        return favs;
      });
    }
    if (!silent) setWaitsLoading(false);
  }, []);

  // ── Start/stop polling ───────────────────────────────────────────────────────
  const startPolling = useCallback(() => {
    setPolling(true);
    doPoll(false);
    pollTimer.current = setInterval(() => doPoll(true), POLL_INTERVAL);
  }, [doPoll]);

  const stopPolling = useCallback(() => {
    setPolling(false);
    if (pollTimer.current) clearInterval(pollTimer.current);
  }, []);

  // ── Countdown timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!nextPoll) return;
    countdownTimer.current = setInterval(() => {
      const secs = Math.max(0, Math.round((nextPoll - new Date()) / 1000));
      setCountdown(secs);
    }, 1000);
    return () => clearInterval(countdownTimer.current);
  }, [nextPoll]);

  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);

  // ── Favorites ────────────────────────────────────────────────────────────────
  const favNames = new Set(favorites.map(f => f.name));
  const addFav = (name, park) => { if (!favNames.has(name)) setFavorites(p => [...p, { name, park }]); };
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

  // ── Screenshot ───────────────────────────────────────────────────────────────
  const handleFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setScreenshot(f); setScreenshotPreview(URL.createObjectURL(f)); setAiResult(null);
  };

  // ── AI Analysis ──────────────────────────────────────────────────────────────
  const runAnalysis = async () => {
    setAiLoading(true); setAiResult(null);
    try {
      const allWaits = [...(waitsDL||[]).map(w=>`${w.name}: ${w.wait}min (DL)`), ...(waitsDCA||[]).map(w=>`${w.name}: ${w.wait}min (DCA)`)].join("\n");
      const trendSummary = buildTrendSummary(history);
      const favList = favorites.map((f,i) => {
        const m = getRideMeta(f.name);
        return `${i+1}. ${f.name} (${f.park}) [${m?.tier||"?"}]${m?.closed?" ⚠️CLOSED":""}`;
      }).join("\n");
      const stratLabel = strategy==="stack"?"Stacking":strategy==="bookredeem"?"Book & Redeem":"Elite Combo";

      const userText = `Strategy: ${stratLabel}
Poll count today: ${pollCount} (data every 5 min since tracking started)

MY PRIORITY RIDES:
${favList||"(none set)"}

CURRENT LIVE WAIT TIMES:
${allWaits||"(not loaded)"}

HISTORICAL TREND DATA (5-min snapshots):
${trendSummary}

Based on ALL of the above — current waits AND trends throughout the day — give me:
1. What LL return times I'm currently holding (from screenshot if attached)
2. What to book with LL RIGHT NOW and why (use trend data to justify urgency)
3. What to ride standby right now (≤30 min AND trending stable or down)
4. What to AVOID using LL on right now (short waits, falling trends)
5. My optimal sequence for the next 3-4 hours
6. Any trend-based alerts — rides rising fast I should act on immediately
7. Stacking or SEP opportunities based on current patterns
8. One pro tip specific to my situation right now

CLOSED THIS TRIP: Pirates of the Caribbean, Buzz Lightyear Astro Blasters — do not recommend. Star Tours IS open.`;

      const content = [{ type:"text", text:userText }];
      if (screenshot) {
        const b64 = await toBase64(screenshot);
        content.unshift({ type:"image", source:{ type:"base64", media_type:screenshot.type||"image/png", data:b64 }});
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system:AI_SYSTEM, messages:[{role:"user",content}] }),
      });
      const data = await res.json();
      setAiResult(data.content?.map(b=>b.text||"").join("")||"No response.");
    } catch { setAiResult("Error. Please try again."); }
    setAiLoading(false);
  };

  const currentWaits = activePark==="DL" ? waitsDL : waitsDCA;
  const tierData = LL_TIERS[activePark];

  const tips = [
    { id:"2hr",   icon:"⏱", title:"2-Hour Rule",                body:"Book again after redeeming your most recent LL — OR 2 hours after last booking — whichever comes FIRST. Timer is based on booking time, not return window." },
    { id:"mod",   icon:"✏️", title:"Always Modify, Never Cancel", body:"Canceling kills your reservation. Modifying preserves it AND doesn't reset your 2-hour clock. Modify as many times as you want while the window is open." },
    { id:"sep",   icon:"🎟", title:"Select Experience Pass (SEP)", body:"Ride breaks down during your active window → SEP issued automatically in My Plans. Bonus pass — doesn't count as one-use. Book again immediately. Save for a high-value afternoon ride." },
    { id:"stack", icon:"📚", title:"Stacking",                    body:"Book Tier 1 early → don't ride yet. Modify window into afternoon. Every 2hrs book another, push it late. Ride standby <30min in morning. By 2pm you have 3+ stacked LLs when waits are 75-100 min." },
    { id:"sb",    icon:"🚶", title:"When to Skip LL",             body:"Standby ≤30 min = walk on and save your LL slot. Especially for Tier 1/2 rides — you want those slots for when waits hit 75-100 min in the afternoon." },
    { id:"sep2",  icon:"⚡", title:"SEP Timing Trick",            body:"Wait 30-45 min into your return window before modifying. If the ride goes down during that window you get an SEP. Modifying too early forfeits eligibility." },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif", background:"#080b14", minHeight:"100vh", color:"#dde4f0", maxWidth:480, margin:"0 auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,500;9..40,700&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>

      {/* Header */}
      <div style={{ background:"linear-gradient(180deg,#0e1628 0%,#080b14 100%)", padding:"16px 16px 0", borderBottom:"1px solid rgba(250,204,21,0.1)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:8, background:"linear-gradient(135deg,#b45309,#facc15)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>⚡</div>
            <div>
              <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:"#facc15", lineHeight:1 }}>LL OPTIMIZER</div>
              <div style={{ fontSize:9, color:"#64748b", letterSpacing:1.2, textTransform:"uppercase" }}>LL University · Park Hop Insider</div>
            </div>
          </div>
          {/* Polling status */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
            <button onClick={polling ? stopPolling : startPolling} style={{ background:polling?"rgba(74,222,128,0.12)":"rgba(250,204,21,0.1)", border:`1px solid ${polling?"rgba(74,222,128,0.3)":"rgba(250,204,21,0.25)"}`, color:polling?"#4ade80":"#facc15", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>
              {polling ? "● LIVE" : "▶ START"}
            </button>
            {polling && countdown > 0 && <div style={{ fontSize:9, color:"#475569" }}>next poll in {countdown}s</div>}
            {pollCount > 0 && <div style={{ fontSize:9, color:"#475569" }}>{pollCount} polls · {Math.round(pollCount*5/60*10)/10}hr history</div>}
          </div>
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div style={{ background:"rgba(74,222,128,0.08)", border:"1px solid rgba(74,222,128,0.25)", borderRadius:7, padding:"7px 10px", marginBottom:8 }}>
            {alerts.map((a,i) => <div key={i} style={{ fontSize:11, color:"#4ade80", fontWeight:700 }}>🟢 {a}</div>)}
            <button onClick={()=>setAlerts([])} style={{ fontSize:10, color:"#334155", background:"none", border:"none", cursor:"pointer", marginTop:2 }}>dismiss</button>
          </div>
        )}

        {/* Closed banner */}
        <div style={{ background:"rgba(251,146,60,0.07)", border:"1px solid rgba(251,146,60,0.15)", borderRadius:7, padding:"6px 10px", marginBottom:10, fontSize:10, color:"#fb923c" }}>
          ⚠️ Closed this trip: Pirates of the Caribbean · Buzz Lightyear Astro Blasters
        </div>

        <div style={{ display:"flex", marginBottom:"-1px" }}>
          {[["waits","📊","Waits"],["planner","🎢","Rides"],["tips","💡","Guide"],["optimizer","🧠","AI"]].map(([key,icon,label])=>(
            <button key={key} onClick={()=>setTab(key)} style={{ flex:1, padding:"8px 0", border:"none", cursor:"pointer", background:"transparent", fontFamily:"'DM Sans',sans-serif", fontSize:11, fontWeight:tab===key?700:400, color:tab===key?"#facc15":"#475569", borderBottom:`2px solid ${tab===key?"#facc15":"transparent"}`, transition:"all 0.15s" }}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding:14 }}>

        {/* ── WAITS TAB ── */}
        {tab==="waits" && (
          <div>
            {!polling && (
              <div style={{ background:"rgba(250,204,21,0.05)", border:"1px solid rgba(250,204,21,0.12)", borderRadius:9, padding:"14px 16px", marginBottom:14, textAlign:"center" }}>
                <div style={{ fontSize:24, marginBottom:6 }}>📡</div>
                <div style={{ fontSize:13, fontWeight:700, color:"#facc15", marginBottom:4 }}>Start Live Tracking</div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:12, lineHeight:1.5 }}>Polls wait times every 5 minutes and builds trend history throughout your day. The longer it runs, the smarter the AI gets.</div>
                <button onClick={startPolling} style={{ background:"linear-gradient(135deg,#92400e,#facc15)", border:"none", borderRadius:8, padding:"10px 24px", color:"#080b14", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14, cursor:"pointer", letterSpacing:0.5 }}>
                  ▶ START TRACKING
                </button>
              </div>
            )}

            {polling && (
              <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                <div style={{ flex:1, background:"#0e1628", borderRadius:8, padding:"8px 12px", border:"1px solid rgba(74,222,128,0.15)" }}>
                  <div style={{ fontSize:9, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Status</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#4ade80" }}>● Live Tracking</div>
                </div>
                <div style={{ flex:1, background:"#0e1628", borderRadius:8, padding:"8px 12px", border:"1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize:9, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Polls</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#dde4f0" }}>{pollCount} ({Math.round(pollCount*5/60*10)/10}hr)</div>
                </div>
                <div style={{ flex:1, background:"#0e1628", borderRadius:8, padding:"8px 12px", border:"1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ fontSize:9, color:"#475569", textTransform:"uppercase", letterSpacing:1 }}>Next In</div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#dde4f0" }}>{countdown}s</div>
                </div>
              </div>
            )}

            {[["DL","🏰 Disneyland",waitsDL,"#818cf8"],["DCA","🎡 Cal Adventure",waitsDCA,"#f87171"]].map(([pk,label,waits,accent])=>(
              <div key={pk} style={{ background:"#0e1628", borderRadius:10, border:"1px solid rgba(255,255,255,0.05)", marginBottom:12, overflow:"hidden" }}>
                <div style={{ padding:"9px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontWeight:700, fontSize:13, color:accent }}>{label}</div>
                {!waits ? (
                  <div style={{ padding:20, textAlign:"center", color:"#334155", fontSize:12 }}>{polling?"Loading first poll…":"Tap Start Tracking above"}</div>
                ) : (
                  waits.slice(0,16).map(ride => {
                    const isFav = favNames.has(ride.name);
                    const meta = getRideMeta(ride.name);
                    const rideHist = history[ride.name]?.map(s=>s.wait);
                    const isClosed = ride.name.includes("Buzz Lightyear")||ride.name.includes("Pirates");
                    return (
                      <div key={ride.id} style={{ display:"flex", alignItems:"center", padding:"7px 12px", borderBottom:"1px solid rgba(255,255,255,0.03)", gap:7, opacity:isClosed?0.35:1 }}>
                        {isFav && <span style={{ fontSize:8, flexShrink:0 }}>⭐</span>}
                        <span style={{ flex:1, fontSize:12, color:isFav?"#dde4f0":"#94a3b8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ride.name}</span>
                        {meta && <span style={{ fontSize:8, padding:"1px 5px", borderRadius:10, background:`${TIER_COLOR[meta.tier]}20`, color:TIER_COLOR[meta.tier], fontWeight:700, flexShrink:0 }}>{TIER_LABEL[meta.tier]}</span>}
                        {rideHist && rideHist.length >= 2 && <Sparkline data={rideHist.slice(-12)} color={WAIT_COLOR(ride.wait)}/>}
                        {ride.wait <= 30 && !isClosed && <span style={{ fontSize:8, color:"#4ade80", fontWeight:700, flexShrink:0 }}>WALK</span>}
                        <span style={{ fontSize:12, fontWeight:700, color:WAIT_COLOR(ride.wait), minWidth:36, textAlign:"right", flexShrink:0 }}>{ride.wait}m</span>
                      </div>
                    );
                  })
                )}
              </div>
            ))}

            <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginTop:4 }}>
              {[["#4ade80","≤20m"],["#facc15","21-40m"],["#fb923c","41-60m"],["#f87171",">60m"]].map(([c,l])=>(
                <span key={l} style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:"#475569" }}><span style={{ width:6, height:6, borderRadius:"50%", background:c, display:"inline-block" }}/>{l}</span>
              ))}
              <span style={{ fontSize:10, color:"#475569" }}>· sparkline = trend since tracking started</span>
            </div>
          </div>
        )}

        {/* ── RIDES TAB ── */}
        {tab==="planner" && (
          <div>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              {["DL","DCA"].map(p=>(
                <button key={p} onClick={()=>setActivePark(p)} style={{ flex:1, padding:"8px 0", border:`1px solid ${activePark===p?(p==="DL"?"rgba(129,140,248,0.4)":"rgba(248,113,113,0.4)"):"rgba(255,255,255,0.07)"}`, borderRadius:8, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontWeight:700, fontSize:12, background:activePark===p?(p==="DL"?"rgba(99,102,241,0.12)":"rgba(239,68,68,0.1)"):"transparent", color:activePark===p?(p==="DL"?"#818cf8":"#f87171"):"#475569", transition:"all 0.15s" }}>
                  {p==="DL"?"🏰 Disneyland":"🎡 Cal Adventure"}
                </button>
              ))}
            </div>

            {favorites.length > 0 && (
              <div style={{ background:"#0e1628", borderRadius:10, border:"1px solid rgba(250,204,21,0.12)", marginBottom:12, overflow:"hidden" }}>
                <div style={{ padding:"9px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontWeight:700, fontSize:12, color:"#facc15" }}>⭐ MY PRIORITY LIST</span>
                  <span style={{ fontSize:10, color:"#475569" }}>Drag to reorder</span>
                </div>
                {favorites.map((fav,i)=>{
                  const meta = getRideMeta(fav.name);
                  const liveWait = [...(waitsDL||[]),...(waitsDCA||[])].find(w=>w.name===fav.name);
                  const rideHist = history[fav.name]?.map(s=>s.wait);
                  return (
                    <div key={fav.name} draggable onDragStart={()=>handleDragStart(i)} onDragOver={e=>e.preventDefault()} onDrop={()=>handleDrop(i)}
                      style={{ display:"flex", alignItems:"center", gap:7, padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.04)", cursor:"grab", background:dragIdx===i?"rgba(250,204,21,0.04)":"transparent", opacity:meta?.closed?0.5:1 }}>
                      <span style={{ color:"#facc15", fontFamily:"'Syne',sans-serif", fontSize:13, width:18, textAlign:"center", flexShrink:0 }}>{i+1}</span>
                      <span style={{ flex:1, fontSize:12 }}>{fav.name}{meta?.closed?" ⚠️":""}</span>
                      {rideHist && rideHist.length >= 2 && <Sparkline data={rideHist.slice(-8)} color={liveWait?WAIT_COLOR(liveWait.wait):"#facc15"}/>}
                      {liveWait && <span style={{ fontSize:11, fontWeight:700, color:WAIT_COLOR(liveWait.wait), flexShrink:0 }}>{liveWait.wait}m</span>}
                      {meta && <span style={{ fontSize:8, padding:"1px 5px", borderRadius:10, background:`${TIER_COLOR[meta.tier]}20`, color:TIER_COLOR[meta.tier], fontWeight:700, flexShrink:0 }}>{TIER_LABEL[meta.tier]}</span>}
                      <button onClick={()=>removeFav(fav.name)} style={{ background:"none", border:"none", color:"#334155", cursor:"pointer", fontSize:14, padding:"0 2px", flexShrink:0 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {[["tier1","🔴 Tier 1 — Book First"],["tier2","🟠 Tier 2 — Early Afternoon"],["tier3","🟢 Tier 3 — Available Late"],["nonLL_A","🟣 No LL · A — Before 11am"],["nonLL_B","🔵 No LL · B — Before 2pm"]].map(([tier,label])=>{
              const rides = tierData[tier];
              if (!rides||rides.length===0) return null;
              return (
                <div key={tier} style={{ marginBottom:9, background:"#0e1628", borderRadius:10, border:"1px solid rgba(255,255,255,0.05)", overflow:"hidden" }}>
                  <div style={{ padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:10, fontWeight:700, color:TIER_COLOR[tier], letterSpacing:0.3 }}>{label}</div>
                  {rides.map(ride=>{
                    const added = favNames.has(ride.name);
                    const liveWait = currentWaits?.find(w=>w.name.toLowerCase().includes(ride.name.toLowerCase().slice(0,14)));
                    const rideHist = history[ride.name]?.map(s=>s.wait);
                    return (
                      <div key={ride.name} style={{ display:"flex", alignItems:"center", padding:"7px 12px", borderBottom:"1px solid rgba(255,255,255,0.03)", gap:7, opacity:ride.closed?0.45:1 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, color:added?"#94a3b8":"#dde4f0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{ride.name}</div>
                          <div style={{ fontSize:9, color:ride.closed?"#fb923c":"#475569", marginTop:1 }}>{ride.note}</div>
                        </div>
                        {rideHist && rideHist.length >= 2 && <Sparkline data={rideHist.slice(-8)} color={liveWait?WAIT_COLOR(liveWait.wait):"#64748b"}/>}
                        {liveWait && !ride.closed && <span style={{ fontSize:11, fontWeight:700, color:WAIT_COLOR(liveWait.wait), flexShrink:0 }}>{liveWait.wait}m</span>}
                        {!ride.closed && (
                          <button onClick={()=>added?removeFav(ride.name):addFav(ride.name,activePark)} style={{ flexShrink:0, background:added?"rgba(239,68,68,0.08)":"rgba(250,204,21,0.08)", border:`1px solid ${added?"rgba(239,68,68,0.25)":"rgba(250,204,21,0.2)"}`, color:added?"#f87171":"#facc15", borderRadius:6, padding:"3px 9px", cursor:"pointer", fontSize:10, fontWeight:700, fontFamily:"'DM Sans',sans-serif" }}>
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

        {/* ── GUIDE TAB ── */}
        {tab==="tips" && (
          <div>
            <div style={{ background:"rgba(250,204,21,0.04)", border:"1px solid rgba(250,204,21,0.1)", borderRadius:9, padding:"10px 13px", marginBottom:12, fontSize:11, color:"#a16207", lineHeight:1.5 }}>
              Strategies from <strong style={{ color:"#facc15" }}>LL University</strong> by Park Hop Insider (April 2026). Tap to expand.
            </div>
            {tips.map(tip=>(
              <div key={tip.id} onClick={()=>setExpandedTip(expandedTip===tip.id?null:tip.id)}
                style={{ background:"#0e1628", borderRadius:9, border:`1px solid ${expandedTip===tip.id?"rgba(250,204,21,0.18)":"rgba(255,255,255,0.05)"}`, marginBottom:7, overflow:"hidden", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:9, padding:"11px 13px" }}>
                  <span style={{ fontSize:16 }}>{tip.icon}</span>
                  <span style={{ flex:1, fontWeight:700, fontSize:12, color:expandedTip===tip.id?"#facc15":"#dde4f0" }}>{tip.title}</span>
                  <span style={{ color:"#475569", fontSize:11, display:"inline-block", transform:expandedTip===tip.id?"rotate(90deg)":"none", transition:"transform 0.15s" }}>▶</span>
                </div>
                {expandedTip===tip.id && <div style={{ padding:"0 13px 13px", paddingTop:10, fontSize:12, color:"#94a3b8", lineHeight:1.65, borderTop:"1px solid rgba(255,255,255,0.05)" }}>{tip.body}</div>}
              </div>
            ))}
            <div style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(255,255,255,0.05)", marginTop:12, overflow:"hidden" }}>
              <div style={{ padding:"9px 13px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontWeight:700, fontSize:12, color:"#facc15" }}>📋 Your Trip — Demand Tiers</div>
              {[
                ["DL 🔴 T1","Indiana Jones · Space Mountain · Mickey & Minnie's Railway","Book FIRST — noon sellout","#f87171"],
                ["DL 🟠 T2","Matterhorn · Big Thunder · Tiana's · Haunted Mansion","Late afternoon sellout","#fb923c"],
                ["DL 🟢 T3","Smugglers Run · Star Tours","Available late day","#4ade80"],
                ["DL 🟣 No LL·A","Rise of the Resistance","Single Pass — before 11am","#c084fc"],
                ["DL 🔵 No LL·B","Jungle Cruise (Pirates ⚠️ closed)","Before 2pm","#60a5fa"],
                ["DCA 🔴 T1","Guardians BREAKOUT · Toy Story Mania","Book FIRST — early afternoon","#f87171"],
                ["DCA 🟠 T2","Soarin' · Goofy's Sky School · Incredicoaster","Late afternoon","#fb923c"],
                ["DCA 🟢 T3","Web Slingers · Little Mermaid · Monsters Inc · Grizzly","Most of day","#4ade80"],
                ["DCA 🟣 No LL·A","Radiator Springs Racers","Single Pass or before 11am","#c084fc"],
              ].map(([label,rides,note,c])=>(
                <div key={label} style={{ padding:"8px 13px", borderBottom:"1px solid rgba(255,255,255,0.03)" }}>
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

        {/* ── AI TAB ── */}
        {tab==="optimizer" && (
          <div>
            <div style={{ display:"flex", gap:5, marginBottom:12, flexWrap:"wrap" }}>
              {[[favorites.length>0,`${favorites.length} rides`],[!!(waitsDL||waitsDCA),"Waits loaded"],[pollCount>0,`${pollCount} polls · ${Math.round(pollCount*5/60*10)/10}hr trend`],[!!screenshot,"Screenshot ready"]].map(([ok,label],i)=>(
                <div key={i} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 9px", borderRadius:14, background:ok?"rgba(74,222,128,0.07)":"rgba(255,255,255,0.03)", border:`1px solid ${ok?"rgba(74,222,128,0.2)":"rgba(255,255,255,0.06)"}`, fontSize:10, color:ok?"#4ade80":"#475569" }}>
                  {ok?"✓":"○"} {label}
                </div>
              ))}
            </div>

            {pollCount === 0 && (
              <div style={{ background:"rgba(251,146,60,0.07)", border:"1px solid rgba(251,146,60,0.15)", borderRadius:8, padding:"9px 12px", marginBottom:12, fontSize:11, color:"#fb923c" }}>
                💡 Start Live Tracking on the Waits tab first — the AI uses trend data to make sharper recommendations
              </div>
            )}

            {/* Strategy */}
            <div style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(255,255,255,0.05)", marginBottom:11, overflow:"hidden" }}>
              <div style={{ padding:"8px 13px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:11, fontWeight:700, color:"#94a3b8" }}>STRATEGY</div>
              {[["bookredeem","📖 Book & Redeem","Simple — one LL at a time"],["stack","📚 Stacking","Build afternoon LL block, standby in AM"],["elite","⚡ Elite Combo","Stack AM + Book & Redeem PM — max ride count"]].map(([val,label,desc])=>(
                <div key={val} onClick={()=>setStrategy(val)} style={{ display:"flex", alignItems:"center", gap:9, padding:"9px 13px", borderBottom:"1px solid rgba(255,255,255,0.03)", cursor:"pointer", background:strategy===val?"rgba(250,204,21,0.04)":"transparent" }}>
                  <div style={{ width:14, height:14, borderRadius:"50%", border:`2px solid ${strategy===val?"#facc15":"#334155"}`, background:strategy===val?"#facc15":"transparent", flexShrink:0 }}/>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:strategy===val?"#facc15":"#dde4f0" }}>{label}</div>
                    <div style={{ fontSize:10, color:"#475569" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Screenshot */}
            <div style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(255,255,255,0.05)", marginBottom:11, overflow:"hidden" }}>
              <div style={{ padding:"8px 13px", borderBottom:"1px solid rgba(255,255,255,0.05)", fontSize:11, fontWeight:700, color:"#94a3b8" }}>📱 LL SCREENSHOT (OPTIONAL BUT RECOMMENDED)</div>
              <div style={{ padding:11 }}>
                {screenshotPreview ? (
                  <div>
                    <img src={screenshotPreview} alt="LL" style={{ width:"100%", borderRadius:7, maxHeight:260, objectFit:"contain", background:"#080b14" }}/>
                    <button onClick={()=>{setScreenshot(null);setScreenshotPreview(null);setAiResult(null);}} style={{ marginTop:7, background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.18)", color:"#f87171", borderRadius:5, padding:"4px 10px", cursor:"pointer", fontSize:10, fontFamily:"'DM Sans',sans-serif" }}>Remove</button>
                  </div>
                ) : (
                  <div onClick={()=>fileRef.current?.click()} style={{ border:"2px dashed rgba(250,204,21,0.12)", borderRadius:7, padding:"20px 14px", textAlign:"center", cursor:"pointer" }}>
                    <div style={{ fontSize:26, marginBottom:5 }}>📷</div>
                    <div style={{ fontSize:12, color:"#64748b" }}>Upload your LL return times screenshot</div>
                    <div style={{ fontSize:10, color:"#334155", marginTop:3 }}>From the Disneyland app → Lightning Lane Passes</div>
                    <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display:"none" }}/>
                  </div>
                )}
              </div>
            </div>

            <button onClick={runAnalysis} disabled={aiLoading} style={{ width:"100%", padding:"12px 0", border:"none", borderRadius:9, cursor:aiLoading?"not-allowed":"pointer", background:aiLoading?"rgba(250,204,21,0.07)":"linear-gradient(135deg,#92400e,#facc15)", color:aiLoading?"#475569":"#080b14", fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, letterSpacing:0.8, marginBottom:13 }}>
              {aiLoading?"ANALYZING…":"⚡ OPTIMIZE MY DAY"}
            </button>

            {aiResult && (
              <div style={{ background:"#0e1628", borderRadius:9, border:"1px solid rgba(250,204,21,0.14)", overflow:"hidden" }}>
                <div style={{ padding:"9px 13px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", alignItems:"center", gap:7 }}>
                  <span style={{ fontSize:15 }}>🧠</span>
                  <span style={{ fontWeight:700, fontSize:12, color:"#facc15" }}>AI RECOMMENDATION</span>
                  {pollCount > 0 && <span style={{ fontSize:9, color:"#475569", marginLeft:"auto" }}>using {Math.round(pollCount*5/60*10)/10}hr of trend data</span>}
                </div>
                <div style={{ padding:13, fontSize:12, lineHeight:1.75, color:"#94a3b8", whiteSpace:"pre-wrap" }}>{aiResult}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
