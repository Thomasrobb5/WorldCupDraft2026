/**
 * World Cup Draft 2026 - Cloudflare Worker Backend & Live Tournament Dashboard
 * 
 * API Endpoints:
 * - OPTIONS : CORS Preflight
 * - GET /api/draft : Returns current draft state (JSON)
 * - POST /api/draft : Saves draft state (JSON)
 * - POST /api/fetch-scores : Automatively pulls matches & scores from openfootball on GitHub
 * - POST /api/matches : Manually updates individual match score (admin override)
 * - POST /api/settings : Configures custom point values for leaderboard
 * - GET / : Serves the live-polling, premium tabbed tournament dashboard
 */

// Global in-memory state fallback (resets when worker restarts)
let memoryState = {
  players: [
    { name: "Ross", maxDrafts: 6 },
    { name: "Brad", maxDrafts: 6 },
    { name: "Tav", maxDrafts: 6 },
    { name: "Saunders", maxDrafts: 6 },
    { name: "Matt", maxDrafts: 6 },
    { name: "Albury", maxDrafts: 6 },
    { name: "Mook", maxDrafts: 6 },
    { name: "Boob", maxDrafts: 6 }
  ],
  draftResults: [],
  gameState: 'SELECTING_PLAYER',
  selectedPlayer: null,
  selectedTeam: null,
  isMuted: false,
  spinDuration: 6.0,
  spinSpeedFactor: 1.0,
  matches: [],
  scoringSettings: {
    groupWin: 3,
    groupDraw: 1,
    advanceR32: 2,
    advanceR16: 4,
    advanceQF: 6,
    advanceSF: 8,
    advanceFinal: 10,
    winTournament: 12
  },
  lastScoresFetch: 0
};

const TEAM_NAME_MAPPINGS = {
  "Bosnia & Herzegovina": "Bosnia and Herzegovina",
  "Curaçao": "Curacao",
  "Czech Republic": "Czechia",
  "Turkey": "Turkiye"
};

function mapJsonTeamToLocal(name) {
  if (!name) return name;
  if (TEAM_NAME_MAPPINGS[name]) {
    return TEAM_NAME_MAPPINGS[name];
  }
  return name;
}

function syncScoresWithOpenFootball(state, openFootballData) {
  if (!state.matches) state.matches = [];
  
  const jsonMatches = openFootballData.matches || [];
  
  jsonMatches.forEach((m, index) => {
    let localMatch = state.matches[index];
    
    // Determine status and scores
    let status = 'scheduled';
    let homeScore = null;
    let awayScore = null;
    let scoreObj = null;

    if (m.score) {
      status = 'finished';
      homeScore = m.score.ft ? m.score.ft[0] : null;
      awayScore = m.score.ft ? m.score.ft[1] : null;
      scoreObj = m.score;
    }

    const homeTeam = mapJsonTeamToLocal(m.team1);
    const awayTeam = mapJsonTeamToLocal(m.team2);

    if (!localMatch) {
      localMatch = {
        id: `match_${index}`,
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        homeScore: homeScore,
        awayScore: awayScore,
        score: scoreObj,
        status: status,
        date: m.date,
        time: m.time,
        group: m.group || '',
        round: m.round,
        ground: m.ground || '',
        isManual: false
      };
      state.matches.push(localMatch);
    } else {
      // If manually overridden, do not overwrite scores but update details
      if (localMatch.isManual) {
        localMatch.homeTeam = homeTeam;
        localMatch.awayTeam = awayTeam;
        localMatch.date = m.date;
        localMatch.time = m.time;
        localMatch.group = m.group || '';
        localMatch.round = m.round;
        localMatch.ground = m.ground || '';
      } else {
        localMatch.homeTeam = homeTeam;
        localMatch.awayTeam = awayTeam;
        localMatch.homeScore = homeScore;
        localMatch.awayScore = awayScore;
        localMatch.score = scoreObj;
        localMatch.status = status;
        localMatch.date = m.date;
        localMatch.time = m.time;
        localMatch.group = m.group || '';
        localMatch.round = m.round;
        localMatch.ground = m.ground || '';
      }
    }
  });

  state.lastScoresFetch = Date.now();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS Headers for SPA compatibility
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Draft-Password',
      'Access-Control-Max-Age': '86400',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Load State from KV or memory helper
    const loadStateHelper = async () => {
      let state = memoryState;
      if (env.DRAFT_KV) {
        const value = await env.DRAFT_KV.get('draft_state');
        if (value) {
          try {
            state = JSON.parse(value);
            // Schema migration checks
            if (!state.matches) state.matches = [];
            if (!state.scoringSettings) {
              state.scoringSettings = {
                groupWin: 3,
                groupDraw: 1,
                advanceR32: 2,
                advanceR16: 4,
                advanceQF: 6,
                advanceSF: 8,
                advanceFinal: 10,
                winTournament: 12
              };
            }
            if (state.lastScoresFetch === undefined) state.lastScoresFetch = 0;
          } catch (e) {}
        }
      }
      return state;
    };

    // Save State helper
    const saveStateHelper = async (state) => {
      if (env.DRAFT_KV) {
        await env.DRAFT_KV.put('draft_state', JSON.stringify(state));
      } else {
        memoryState = state;
      }
    };

    // 1. POST /api/draft - Save draft state
    if (path === '/api/draft' && method === 'POST') {
      try {
        const password = request.headers.get('X-Draft-Password');
        if (password !== 'Tavoo') {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            status: 401
          });
        }
        
        const body = await request.json();
        
        if (body && Array.isArray(body.players) && Array.isArray(body.draftResults)) {
          const state = await loadStateHelper();
          
          state.players = body.players;
          state.draftResults = body.draftResults;
          state.gameState = body.gameState || 'SELECTING_PLAYER';
          state.selectedPlayer = body.selectedPlayer || null;
          state.selectedTeam = body.selectedTeam || null;
          state.isMuted = body.isMuted || false;
          state.spinDuration = body.spinDuration !== undefined ? body.spinDuration : 6.0;
          state.spinSpeedFactor = body.spinSpeedFactor !== undefined ? body.spinSpeedFactor : 1.0;
          
          if (Array.isArray(body.matches)) state.matches = body.matches;
          if (body.scoringSettings) state.scoringSettings = body.scoringSettings;
          if (body.lastScoresFetch !== undefined) state.lastScoresFetch = body.lastScoresFetch;

          await saveStateHelper(state);

          return new Response(JSON.stringify({ success: true, storage: env.DRAFT_KV ? 'KV' : 'Memory' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            status: 200
          });
        }

        return new Response(JSON.stringify({ error: 'Invalid schema' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 400
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 500
        });
      }
    }

    // 2. GET /api/draft - Get draft state
    if (path === '/api/draft' && method === 'GET') {
      const state = await loadStateHelper();
      return new Response(JSON.stringify(state), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 3. POST /api/fetch-scores - Pull from openfootball GitHub
    if (path === '/api/fetch-scores' && method === 'POST') {
      try {
        const password = request.headers.get('X-Draft-Password');
        if (password !== 'Tavoo') {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            status: 401
          });
        }
        
        const state = await loadStateHelper();
        
        // Fetch fresh schedule & score JSON from openfootball
        const res = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
        if (!res.ok) {
          throw new Error(`Openfootball GitHub API offline: ${res.statusText}`);
        }
        const openFootballData = await res.json();
        
        syncScoresWithOpenFootball(state, openFootballData);
        await saveStateHelper(state);
        
        return new Response(JSON.stringify({ success: true, matches: state.matches, lastScoresFetch: state.lastScoresFetch }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 500
        });
      }
    }

    // 4. POST /api/matches - Manual score update
    if (path === '/api/matches' && method === 'POST') {
      try {
        const password = request.headers.get('X-Draft-Password');
        if (password !== 'Tavoo') {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            status: 401
          });
        }
        
        const body = await request.json();
        const { matchId, homeScore, awayScore, status, isManual } = body;
        
        const state = await loadStateHelper();
        const localMatch = state.matches.find(m => m.id === matchId);
        
        if (localMatch) {
          localMatch.homeScore = homeScore !== undefined && homeScore !== "" ? parseInt(homeScore) : null;
          localMatch.awayScore = awayScore !== undefined && awayScore !== "" ? parseInt(awayScore) : null;
          localMatch.status = status || localMatch.status;
          localMatch.isManual = isManual !== undefined ? isManual : true;
          
          if (localMatch.homeScore !== null && localMatch.awayScore !== null) {
            localMatch.score = localMatch.score || {};
            localMatch.score.ft = [localMatch.homeScore, localMatch.awayScore];
          } else {
            localMatch.score = null;
            localMatch.status = 'scheduled';
          }
          
          await saveStateHelper(state);
          return new Response(JSON.stringify({ success: true, match: localMatch }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        return new Response(JSON.stringify({ error: 'Match not found' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 404
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 500
        });
      }
    }

    // 5. POST /api/settings - Update scoring configuration
    if (path === '/api/settings' && method === 'POST') {
      try {
        const password = request.headers.get('X-Draft-Password');
        if (password !== 'Tavoo') {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
            status: 401
          });
        }
        
        const body = await request.json();
        const { scoringSettings } = body;
        
        if (scoringSettings) {
          const state = await loadStateHelper();
          
          state.scoringSettings = {
            groupWin: scoringSettings.groupWin !== undefined ? parseInt(scoringSettings.groupWin) : 3,
            groupDraw: scoringSettings.groupDraw !== undefined ? parseInt(scoringSettings.groupDraw) : 1,
            advanceR32: scoringSettings.advanceR32 !== undefined ? parseInt(scoringSettings.advanceR32) : 2,
            advanceR16: scoringSettings.advanceR16 !== undefined ? parseInt(scoringSettings.advanceR16) : 4,
            advanceQF: scoringSettings.advanceQF !== undefined ? parseInt(scoringSettings.advanceQF) : 6,
            advanceSF: scoringSettings.advanceSF !== undefined ? parseInt(scoringSettings.advanceSF) : 8,
            advanceFinal: scoringSettings.advanceFinal !== undefined ? parseInt(scoringSettings.advanceFinal) : 10,
            winTournament: scoringSettings.winTournament !== undefined ? parseInt(scoringSettings.winTournament) : 12
          };
          
          await saveStateHelper(state);
          return new Response(JSON.stringify({ success: true, scoringSettings: state.scoringSettings }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        
        return new Response(JSON.stringify({ error: 'Invalid config' }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 400
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
          status: 500
        });
      }
    }

    // 6. GET / or GET /summary - Serves the Premium Live Dashboard
    if ((path === '/' || path === '/summary') && method === 'GET') {
      return new Response(getSummaryHTML(), {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Serves a highly-tailored premium, live-polling World Cup 2026 Tracker.
 * Contains Standings leaderboards, Live/Recent results, group/knockout filters,
 * head-to-head draft wrappers, and a password-protected admin center.
 */
function getSummaryHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>World Cup 2026 Live Dashboard & Tournament Tracker</title>
  <!-- self-contained SVG favicon -->
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚽</text></svg>">
  <!-- Montserrat and Rajdhani Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Rajdhani:wght@500;600;700;800&display=swap" rel="stylesheet">
  <!-- FontAwesome Iconography -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <style>
    :root {
      --color-bg-start: #041a0f;
      --color-bg-end: #070a14;
      --color-card-bg: rgba(15, 23, 42, 0.75);
      --color-gold: #d4af37;
      --color-gold-light: #f3e5ab;
      --color-gold-glow: rgba(212, 175, 55, 0.25);
      --color-green-glow: rgba(16, 185, 129, 0.15);
      --color-emerald: #10b981;
      --color-emerald-dark: #064e3b;
      --color-danger: #ef4444;
      --color-slate-gray: #334155;
      --border-gold: 1.5px solid rgba(212, 175, 55, 0.2);
      --glass-blur: blur(14px);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Montserrat', sans-serif;
      background: radial-gradient(circle at top, var(--color-bg-start) 0%, var(--color-bg-end) 100%);
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding-bottom: 20px;
    }
    
    /* Header layout */
    header {
      background: rgba(7, 10, 20, 0.8);
      backdrop-filter: var(--glass-blur);
      -webkit-backdrop-filter: var(--glass-blur);
      border-bottom: 1.5px solid rgba(212, 175, 55, 0.25);
      padding: 16px 24px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
    }

    .header-content {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    
    .logo-area {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .trophy-logo {
      color: var(--color-gold);
      font-size: 28px;
      filter: drop-shadow(0 0 8px var(--color-gold-glow));
      animation: pulseTrophy 2.5s infinite alternate;
    }
    
    @keyframes pulseTrophy {
      0% { transform: scale(1); }
      100% { transform: scale(1.08); }
    }
    
    .title-wrapper {
      display: flex;
      flex-direction: column;
    }
    
    .main-title {
      font-family: 'Rajdhani', sans-serif;
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      background: linear-gradient(135deg, var(--color-gold-light) 0%, var(--color-gold) 60%, #ffffff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    .sub-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 3px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 600;
    }
    
    /* Navigation Tabs */
    .tabs-nav {
      display: flex;
      gap: 8px;
    }
    
    .tab-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(248, 250, 252, 0.8);
      padding: 10px 18px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .tab-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
    
    .tab-btn.active {
      background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(212, 175, 55, 0.05) 100%);
      border: 1px solid var(--color-gold);
      color: var(--color-gold-light);
      box-shadow: 0 0 10px rgba(212, 175, 55, 0.15);
    }
    
    /* Main Layout */
    main {
      max-width: 1200px;
      width: 100%;
      margin: 24px auto 0;
      padding: 0 20px;
      flex-grow: 1;
    }
    
    .tab-content {
      display: none;
      animation: fadeIn 0.4s ease-out forwards;
    }
    
    .tab-content.active {
      display: block;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    /* Standings Leaderboard */
    .standings-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .player-rank-card {
      background: var(--color-card-bg);
      border: var(--border-gold);
      border-radius: 16px;
      padding: 18px 24px;
      backdrop-filter: var(--glass-blur);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      gap: 14px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    
    .player-rank-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 36px var(--color-gold-glow);
    }
    
    .player-rank-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 12px;
      flex-wrap: wrap;
      gap: 12px;
    }
    
    .rank-and-name {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    
    .rank-number {
      font-family: 'Rajdhani', sans-serif;
      font-size: 24px;
      font-weight: 800;
      width: 38px;
      height: 38px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .rank-1 .rank-number {
      background: linear-gradient(135deg, var(--color-gold-light) 0%, var(--color-gold) 100%);
      color: #070a14;
      border: 1px solid var(--color-gold-light);
      box-shadow: 0 0 10px var(--color-gold-glow);
    }
    
    .rank-2 .rank-number {
      background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%);
      color: #070a14;
      border: 1px solid #e2e8f0;
    }
    
    .rank-3 .rank-number {
      background: linear-gradient(135deg, #b45309 0%, #78350f 100%);
      color: #ffffff;
      border: 1px solid #b45309;
    }
    
    .player-profile-name {
      font-size: 20px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .score-summary-pills {
      display: flex;
      gap: 10px;
    }
    
    .stat-pill {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 60px;
    }
    
    .stat-pill .val {
      font-family: 'Rajdhani', sans-serif;
      font-size: 18px;
      font-weight: 700;
      color: var(--color-gold-light);
    }
    
    .stat-pill.points-pill {
      background: rgba(212, 175, 55, 0.08);
      border: 1px solid rgba(212, 175, 55, 0.25);
    }
    
    .stat-pill.points-pill .val {
      color: var(--color-gold);
      font-size: 20px;
      font-weight: 800;
    }
    
    .player-drafted-teams-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    
    .team-badge-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      padding: 8px 12px;
      border-radius: 10px;
      transition: all 0.2s;
    }
    
    .team-badge-card:hover {
      background: rgba(255, 255, 255, 0.05);
    }
    
    .team-badge-card.eliminated {
      opacity: 0.45;
      background: rgba(239, 68, 68, 0.02);
      border: 1px solid rgba(239, 68, 68, 0.1);
    }
    
    .team-badge-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    
    .dashboard-flag {
      width: 28px;
      height: 18px;
      object-fit: cover;
      border-radius: 2px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    
    .dashboard-team-name {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .team-badge-right {
      font-family: 'Rajdhani', sans-serif;
      font-size: 14px;
      font-weight: 700;
      color: var(--color-gold);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .eliminated-tag {
      font-size: 9px;
      color: var(--color-danger);
      background: rgba(239, 68, 68, 0.15);
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 700;
    }
    
    /* Matches & Fixtures */
    .filters-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 14px;
    }
    
    .filter-pills {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    
    .filter-btn {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.06);
      color: rgba(248, 250, 252, 0.7);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .filter-btn:hover {
      background: rgba(255,255,255,0.08);
      color: #ffffff;
    }
    
    .filter-btn.active {
      background: var(--color-gold);
      color: #070a14;
      border-color: var(--color-gold-light);
    }
    
    .select-player-dropdown {
      background: #0f172a;
      border: 1px solid var(--color-gold);
      color: var(--color-gold-light);
      padding: 6px 12px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      outline: none;
    }
    
    .matches-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 16px;
    }
    
    .match-card {
      background: var(--color-card-bg);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    }
    
    .match-card.finished {
      border: 1px solid rgba(16, 185, 129, 0.15);
      background: linear-gradient(180deg, var(--color-card-bg) 0%, rgba(16, 185, 129, 0.02) 100%);
    }

    .match-card.live-state {
      border: 1.5px solid var(--color-emerald) !important;
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.3) !important;
      animation: pulseLiveBorder 2s infinite alternate;
    }

    @keyframes pulseLiveBorder {
      0% { border-color: rgba(16, 185, 129, 0.4); }
      100% { border-color: var(--color-emerald); }
    }
    
    .match-top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      font-weight: 700;
      color: rgba(255,255,255,0.4);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stage-badge {
      background: rgba(255,255,255,0.06);
      padding: 2px 6px;
      border-radius: 4px;
      color: rgba(255,255,255,0.8);
    }
    
    .h2h-pill {
      font-size: 9px;
      font-weight: 900;
      padding: 3px 8px;
      border-radius: 20px;
      display: flex;
      align-items: center;
      gap: 4px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    
    .h2h-pill.h2h-clash {
      background: linear-gradient(135deg, #b45309 0%, var(--color-gold) 100%);
      color: #070a14;
      border: 1px solid var(--color-gold-light);
    }
    
    .h2h-pill.h2h-friendly {
      background: rgba(212, 175, 55, 0.1);
      border: 1px solid rgba(212, 175, 55, 0.4);
      color: var(--color-gold-light);
    }
    
    .h2h-pill.h2h-cpu {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.6);
    }
    
    .match-teams-score-area {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
    }
    
    .match-team {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 40%;
      text-align: center;
      gap: 8px;
      min-width: 0;
    }
    
    .match-team-flag-large {
      width: 48px;
      height: 30px;
      object-fit: cover;
      border-radius: 4px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.15);
    }
    
    .match-team-name-label {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .match-team-owner-label {
      font-size: 10px;
      font-weight: 600;
      color: var(--color-gold-light);
      margin-top: -4px;
    }
    
    .match-score-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 20%;
    }
    
    .match-score-digits {
      font-family: 'Rajdhani', sans-serif;
      font-size: 28px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 2px;
      display: flex;
      gap: 6px;
      align-items: center;
    }
    
    .match-score-digits.no-score {
      font-size: 11px;
      font-weight: 700;
      color: rgba(255,255,255,0.25);
      font-family: 'Montserrat', sans-serif;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    
    .match-time-ticker {
      font-size: 9px;
      background: rgba(16, 185, 129, 0.15);
      color: var(--color-emerald);
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 700;
      animation: blink 1s infinite alternate;
      margin-top: 4px;
    }

    @keyframes blink {
      0% { opacity: 0.4; }
      100% { opacity: 1; }
    }
    
    .match-bottom-details {
      display: flex;
      justify-content: space-between;
      font-size: 9px;
      color: rgba(255,255,255,0.3);
      font-weight: 600;
      border-top: 1px solid rgba(255,255,255,0.04);
      padding-top: 8px;
    }

    /* Admin Console */
    .admin-card {
      background: var(--color-card-bg);
      border: var(--border-gold);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: var(--glass-blur);
      box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    
    .admin-form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .admin-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--color-gold-light);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .admin-input {
      background: rgba(15,23,42,0.9);
      border: 1px solid rgba(212,175,55,0.3);
      color: #ffffff;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .admin-input:focus {
      border-color: var(--color-gold);
    }
    
    .btn-submit {
      background: linear-gradient(135deg, var(--color-gold) 0%, #b45309 100%);
      color: #070a14;
      border: 1px solid var(--color-gold-light);
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 14px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 1px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .btn-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 15px var(--color-gold-glow);
    }
    
    .admin-grid-two-cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    
    @media (max-width: 768px) {
      .admin-grid-two-cols {
        grid-template-columns: 1fr;
      }
      .header-content {
        flex-direction: column;
        text-align: center;
      }
    }
    
    .admin-action-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .btn-action-outline {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      color: #ffffff;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    
    .btn-action-outline:hover {
      background: rgba(255,255,255,0.08);
      border-color: rgba(255,255,255,0.2);
    }
    
    .admin-matches-editor-list {
      max-height: 400px;
      overflow-y: auto;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      background: rgba(0,0,0,0.2);
      padding: 10px;
    }
    
    .admin-match-row-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255,255,255,0.05);
      padding: 10px 6px;
      gap: 10px;
    }
    
    .admin-match-teams-label {
      font-size: 12px;
      font-weight: 700;
      min-width: 150px;
    }
    
    .admin-match-inputs {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .admin-score-input {
      width: 44px;
      background: #0f172a;
      border: 1px solid rgba(255,255,255,0.15);
      color: #ffffff;
      text-align: center;
      padding: 4px;
      border-radius: 4px;
      font-family: 'Rajdhani', sans-serif;
      font-weight: 700;
      font-size: 16px;
    }
    
    .admin-match-select {
      background: #0f172a;
      border: 1px solid rgba(255,255,255,0.15);
      color: #ffffff;
      padding: 4px;
      font-size: 11px;
      border-radius: 4px;
    }
    
    .btn-save-match {
      background: var(--color-emerald);
      color: #000;
      border: none;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 4px;
      cursor: pointer;
    }
    
    .btn-save-match:hover {
      background: #34d399;
    }
    
    /* Loading States */
    .loading-block {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 200px;
      color: var(--color-gold);
      font-size: 18px;
      font-weight: 600;
      gap: 12px;
    }
    
    .spinner {
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      100% { transform: rotate(360deg); }
    }
    
    .empty-message {
      color: rgba(255,255,255,0.3);
      font-style: italic;
      font-size: 13px;
      text-align: center;
      padding: 40px 0;
    }
  </style>
</head>
<body>

  <header>
    <div class="header-content">
      <div class="logo-area">
        <i class="fa-solid fa-trophy trophy-logo"></i>
        <div class="title-wrapper">
          <h1 class="main-title">World Cup 2026</h1>
          <span class="sub-title">Live Tournament Tracker</span>
        </div>
      </div>
      
      <nav class="tabs-nav">
        <button class="tab-btn active" onclick="switchTab('standings')">
          <i class="fa-solid fa-ranking-star"></i> Standings
        </button>
        <button class="tab-btn" onclick="switchTab('fixtures')">
          <i class="fa-solid fa-calendar-days"></i> Fixtures
        </button>
        <button class="tab-btn" onclick="switchTab('draft')">
          <i class="fa-solid fa-users"></i> Draft Board
        </button>
        <button class="tab-btn" onclick="switchTab('admin')">
          <i class="fa-solid fa-lock"></i> Admin
        </button>
      </nav>
    </div>
  </header>

  <main>
    <!-- 1. STANDINGS TAB -->
    <section id="tab-standings" class="tab-content active">
      <div id="standings-content">
        <div class="loading-block">
          <i class="fa-solid fa-circle-notch spinner"></i> Computing standings...
        </div>
      </div>
    </section>

    <!-- 2. FIXTURES TAB -->
    <section id="tab-fixtures" class="tab-content">
      <div class="filters-bar">
        <div class="filter-pills">
          <button class="filter-btn active" onclick="filterMatches('all', this)">All</button>
          <button class="filter-btn" onclick="filterMatches('live-results', this)">Results / Live</button>
          <button class="filter-btn" onclick="filterMatches('group', this)">Group Stage</button>
          <button class="filter-btn" onclick="filterMatches('knockout', this)">Knockouts</button>
        </div>
        
        <div>
          <select id="player-filter" class="select-player-dropdown" onchange="onPlayerFilterChange(this.value)">
            <option value="all">Filter by Player (All)</option>
          </select>
        </div>
      </div>

      <div id="fixtures-content" class="matches-grid">
        <!-- Rendered matches -->
      </div>
    </section>

    <!-- 3. DRAFT SUMMARY TAB -->
    <section id="tab-draft" class="tab-content">
      <div id="draft-content">
        <!-- Renders player grid with gold cards -->
      </div>
    </section>

    <!-- 4. ADMIN CONSOLE TAB -->
    <section id="tab-admin" class="tab-content">
      <div id="admin-lock-screen" class="admin-card" style="max-width: 480px; margin: 40px auto;">
        <h2 class="main-title" style="text-align: center; margin-bottom: 8px;">ADMIN AUTHENTICATION</h2>
        <div class="admin-form-group">
          <input type="password" id="admin-password" class="admin-input" placeholder="Enter admin password..." />
        </div>
        <button class="btn-submit" onclick="unlockAdminConsole()">Unlock Console</button>
        <p id="admin-error" style="color: var(--color-danger); font-size: 12px; display: none; text-align: center;">Incorrect password.</p>
      </div>

      <div id="admin-main-console" class="admin-card" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
          <h2 class="main-title">Admin Management</h2>
          <button class="btn-action-outline" onclick="lockAdminConsole()"><i class="fa-solid fa-lock"></i> Lock Console</button>
        </div>

        <div class="admin-grid-two-cols">
          <!-- Col 1: Auto Sync & Point settings -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);">
              <h3 class="admin-label" style="margin-bottom: 10px;">Automated Score Collection</h3>
              <p style="font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 12px;">
                Fetch matches, stages, and latest scores in real-time directly from the public openfootball API on GitHub.
              </p>
              <div class="admin-action-row">
                <button class="btn-submit" id="btn-auto-sync" onclick="triggerAutoSync()">
                  <i class="fa-solid fa-rotate"></i> Sync GitHub Scores
                </button>
                <button class="btn-action-outline" onclick="triggerMockSimulation()">
                  <i class="fa-solid fa-flask"></i> Simulate Matchday Goals
                </button>
              </div>
              <p id="sync-time-label" style="font-size: 11px; margin-top: 8px; color: rgba(255,255,255,0.4);">
                Last synced: Never
              </p>
            </div>

            <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);">
              <h3 class="admin-label" style="margin-bottom: 10px;">Point Value Configurations</h3>
              <form id="settings-form" onsubmit="savePointSettings(event)" style="display: flex; flex-direction: column; gap: 10px;">
                <div class="admin-grid-two-cols">
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Group Win</label>
                    <input type="number" id="set-groupWin" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Group Draw</label>
                    <input type="number" id="set-groupDraw" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Reach R32</label>
                    <input type="number" id="set-advanceR32" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Reach R16</label>
                    <input type="number" id="set-advanceR16" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Reach QF</label>
                    <input type="number" id="set-advanceQF" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Reach SF</label>
                    <input type="number" id="set-advanceSF" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Reach Final</label>
                    <input type="number" id="set-advanceFinal" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                  <div class="admin-form-group">
                    <label class="admin-label" style="font-size: 10px;">Champion</label>
                    <input type="number" id="set-winTournament" class="admin-input" style="padding: 6px 12px;" required />
                  </div>
                </div>
                <button type="submit" class="btn-submit" style="margin-top: 10px; padding: 8px 16px; font-size: 12px;">Save Scoring System</button>
              </form>
            </div>
          </div>

          <!-- Col 2: Manual Match Override -->
          <div style="background: rgba(0,0,0,0.2); padding: 16px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05); display: flex; flex-direction: column;">
            <h3 class="admin-label" style="margin-bottom: 8px;">Manual Match Override</h3>
            <input type="text" id="admin-match-search" class="admin-input" placeholder="Search matches to edit (e.g. England)..." style="padding: 6px 12px; margin-bottom: 10px; font-size: 12px;" oninput="onAdminSearchMatches(this.value)" />
            
            <div id="admin-matches-list" class="admin-matches-editor-list">
              <!-- Dynamically populated matches -->
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <script>
    let globalState = null;
    let currentMatchFilter = 'all';
    let currentPlayerFilter = 'all';

    async function loadData() {
      try {
        const res = await fetch('/api/draft');
        if (!res.ok) throw new Error('Failed to load API');
        globalState = await res.json();
        
        renderStandings();
        renderFixtures();
        renderDraftBoard();
        updateAdminForm();
        updatePlayerDropdown();
        
        if (globalState.lastScoresFetch) {
          const dt = new Date(globalState.lastScoresFetch);
          document.getElementById('sync-time-label').innerText = 'Last synced: ' + dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString();
        }
      } catch (err) {
        console.error('Data pull error:', err);
      }
    }

    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      const targetBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(tabId));
      if (targetBtn) targetBtn.classList.add('active');
      
      const targetContent = document.getElementById('tab-' + tabId);
      if (targetContent) targetContent.classList.add('active');
      
      // Auto unlock check if opening admin tab
      if (tabId === 'admin') {
        const psw = localStorage.getItem('wc_draft_admin_pw');
        if (psw === 'Tavoo') {
          document.getElementById('admin-lock-screen').style.display = 'none';
          document.getElementById('admin-main-console').style.display = 'flex';
          renderAdminMatchesList();
        } else {
          document.getElementById('admin-lock-screen').style.display = 'flex';
          document.getElementById('admin-main-console').style.display = 'none';
        }
      }
    }

    // Leaderboard Renderer
    function renderStandings() {
      const container = document.getElementById('standings-content');
      if (!globalState || !globalState.draftResults || globalState.draftResults.length === 0) {
        container.innerHTML = '<div class="empty-message">No draft outcomes found. Relaunch/complete the draft first!</div>';
        return;
      }
      
      const computed = calculatePlayerStandings(globalState);
      
      let html = '<div class="standings-list">';
      computed.forEach((p, idx) => {
        const rank = idx + 1;
        html += \`
          <div class="player-rank-card rank-\${rank}">
            <div class="player-rank-header">
              <div class="rank-and-name">
                <span class="rank-number">\${rank}</span>
                <span class="player-profile-name">\${p.name}</span>
              </div>
              
              <div class="score-summary-pills">
                <div class="stat-pill">
                  <span>Wins</span>
                  <span class="val">\${p.wins}</span>
                </div>
                <div class="stat-pill">
                  <span>Active</span>
                  <span class="val">\${p.activeTeamsCount}</span>
                </div>
                <div class="stat-pill points-pill">
                  <span>Points</span>
                  <span class="val">\${p.points}</span>
                </div>
              </div>
            </div>
            
            <div class="player-drafted-teams-grid">
        \`;
        
        p.teams.forEach(t => {
          html += \`
            <div class="team-badge-card \${t.isEliminated ? 'eliminated' : ''}">
              <div class="team-badge-left">
                <img src="https://flagcdn.com/w40/\${t.code}.png" class="dashboard-flag" alt="\${t.name}" />
                <span class="dashboard-team-name">\${t.name}</span>
              </div>
              <div class="team-badge-right">
                <span>\${t.points} pts</span>
                \${t.isEliminated ? '<span class="eliminated-tag">OUT</span>' : ''}
              </div>
            </div>
          \`;
        });
        
        html += \`
            </div>
          </div>
        \`;
      });
      html += '</div>';
      container.innerHTML = html;
    }

    // Fixtures Renderer
    function renderFixtures() {
      const container = document.getElementById('fixtures-content');
      if (!globalState || !globalState.matches || globalState.matches.length === 0) {
        container.innerHTML = '<div class="empty-message" style="grid-column: 1 / -1;">No tournament schedule populated. Use the Admin panel to sync fixtures from GitHub!</div>';
        return;
      }
      
      let html = '';
      const knockoutRounds = ['Round of 32', 'Round of 16', 'Quarter-final', 'Quarter-finals', 'Semi-final', 'Semi-finals', 'Final'];
      
      // Filter list
      let filtered = globalState.matches;
      
      if (currentMatchFilter === 'live-results') {
        filtered = filtered.filter(m => m.status === 'finished' || m.status === 'live');
      } else if (currentMatchFilter === 'group') {
        filtered = filtered.filter(m => m.round.startsWith('Matchday'));
      } else if (currentMatchFilter === 'knockout') {
        filtered = filtered.filter(m => knockoutRounds.some(kr => m.round.includes(kr)));
      }
      
      if (currentPlayerFilter !== 'all') {
        const playerTeams = globalState.draftResults
          .filter(r => r.player === currentPlayerFilter)
          .map(r => r.team.name);
          
        filtered = filtered.filter(m => playerTeams.includes(m.homeTeam) || playerTeams.includes(m.awayTeam));
      }
      
      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-message" style="grid-column: 1 / -1;">No matches found matching these filters.</div>';
        return;
      }
      
      filtered.forEach(m => {
        const owner1 = globalState.draftResults.find(r => r.team.name === m.homeTeam)?.player || null;
        const owner2 = globalState.draftResults.find(r => r.team.name === m.awayTeam)?.player || null;
        const code1 = globalState.draftResults.find(r => r.team.name === m.homeTeam)?.team.code || getStaticTeamCode(m.homeTeam);
        const code2 = globalState.draftResults.find(r => r.team.name === m.awayTeam)?.team.code || getStaticTeamCode(m.awayTeam);
        
        let h2hHtml = '';
        if (owner1 && owner2) {
          if (owner1 === owner2) {
            h2hHtml = \`<span class="h2h-pill h2h-friendly"><i class="fa-solid fa-handshake"></i> \${owner1} Clash</span>\`;
          } else {
            h2hHtml = \`<span class="h2h-pill h2h-clash"><i class="fa-solid fa-fire"></i> \${owner1} vs \${owner2}</span>\`;
          }
        } else if (owner1 || owner2) {
          h2hHtml = \`<span class="h2h-pill h2h-cpu"><i class="fa-solid fa-shield"></i> \${owner1 || owner2} vs CPU</span>\`;
        }
        
        const isLive = m.status === 'live';
        const isFinished = m.status === 'finished';
        
        html += \`
          <div class="match-card \${isFinished ? 'finished' : ''} \${isLive ? 'live-state' : ''}">
            <div class="match-top-row">
              <span class="stage-badge">\${m.round} \${m.group ? '• ' + m.group : ''}</span>
              \${h2hHtml}
            </div>
            
            <div class="match-teams-score-area">
              <!-- Home -->
              <div class="match-team">
                \${code1 ? \`<img src="https://flagcdn.com/w80/\${code1}.png" class="match-team-flag-large" alt="\${m.homeTeam}" onerror="this.style.display='none'" />\` : '<div class="match-team-flag-large" style="background:#0f172a; display:flex; align-items:center; justify-content:center; font-size:10px; color:#aaa;">TBD</div>'}
                <span class="match-team-name-label">\${m.homeTeam}</span>
                \${owner1 ? \`<span class="match-team-owner-label">(\${owner1})</span>\` : ''}
              </div>
              
              <!-- Center Score -->
              <div class="match-score-center">
                \${isFinished || isLive ? \`
                  <div class="match-score-digits">
                    <span>\${m.homeScore}</span>
                    <span>-</span>
                    <span>\${m.awayScore}</span>
                  </div>
                \` : \`
                  <div class="match-score-digits no-score">
                    <span>VS</span>
                  </div>
                \`}
                \${isLive ? '<span class="match-time-ticker">LIVE</span>' : ''}
              </div>
              
              <!-- Away -->
              <div class="match-team">
                \${code2 ? \`<img src="https://flagcdn.com/w80/\${code2}.png" class="match-team-flag-large" alt="\${m.awayTeam}" onerror="this.style.display='none'" />\` : '<div class="match-team-flag-large" style="background:#0f172a; display:flex; align-items:center; justify-content:center; font-size:10px; color:#aaa;">TBD</div>'}
                <span class="match-team-name-label">\${m.awayTeam}</span>
                \${owner2 ? \`<span class="match-team-owner-label">(\${owner2})</span>\` : ''}
              </div>
            </div>
            
            <div class="match-bottom-details">
              <span>\${m.ground || 'Venue TBD'}</span>
              <span>\${m.date} \${m.time || ''}</span>
            </div>
          </div>
        \`;
      });
      container.innerHTML = html;
    }

    // Static code fallback map in case they haven't been drafted yet
    function getStaticTeamCode(name) {
      const match = [
        { name: "Mexico", code: "mx" }, { name: "South Korea", code: "kr" }, { name: "South Africa", code: "za" },
        { name: "Czechia", code: "cz" }, { name: "Canada", code: "ca" }, { name: "Switzerland", code: "ch" },
        { name: "Qatar", code: "qa" }, { name: "Bosnia and Herzegovina", code: "ba" }, { name: "Brazil", code: "br" },
        { name: "Morocco", code: "ma" }, { name: "Scotland", code: "gb-sct" }, { name: "Haiti", code: "ht" },
        { name: "USA", code: "us" }, { name: "Australia", code: "au" }, { name: "Paraguay", code: "py" },
        { name: "Turkiye", code: "tr" }, { name: "Germany", code: "de" }, { name: "Ecuador", code: "ec" },
        { name: "Ivory Coast", code: "ci" }, { name: "Curacao", code: "cw" }, { name: "Netherlands", code: "nl" },
        { name: "Japan", code: "jp" }, { name: "Tunisia", code: "tn" }, { name: "Sweden", code: "se" },
        { name: "Belgium", code: "be" }, { name: "Iran", code: "ir" }, { name: "Egypt", code: "eg" },
        { name: "New Zealand", code: "nz" }, { name: "Spain", code: "es" }, { name: "Uruguay", code: "uy" },
        { name: "Saudi Arabia", code: "sa" }, { name: "Cape Verde", code: "cv" }, { name: "France", code: "fr" },
        { name: "Senegal", code: "sn" }, { name: "Norway", code: "no" }, { name: "Iraq", code: "iq" },
        { name: "Argentina", code: "ar" }, { name: "Austria", code: "at" }, { name: "Algeria", code: "dz" },
        { name: "Jordan", code: "jo" }, { name: "Portugal", code: "pt" }, { name: "Colombia", code: "co" },
        { name: "Uzbekistan", code: "uz" }, { name: "DR Congo", code: "cd" }, { name: "England", code: "gb-eng" },
        { name: "Croatia", code: "hr" }, { name: "Panama", code: "pa" }, { name: "Ghana", code: "gh" }
      ].find(t => t.name === name);
      return match ? match.code : null;
    }

    // Filters handler
    function filterMatches(type, btn) {
      currentMatchFilter = type;
      document.querySelectorAll('.filter-pills .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFixtures();
    }

    function onPlayerFilterChange(val) {
      currentPlayerFilter = val;
      renderFixtures();
    }

    function updatePlayerDropdown() {
      const dropdown = document.getElementById('player-filter');
      dropdown.innerHTML = '<option value="all">Filter by Player (All)</option>';
      if (globalState && globalState.players) {
        globalState.players.forEach(p => {
          dropdown.innerHTML += \`<option value="\${p.name}">\${p.name}</option>\`;
        });
      }
      dropdown.value = currentPlayerFilter;
    }

    // Draft Summary Board Renderer (Original summary HTML format with beautiful design)
    function renderDraftBoard() {
      const container = document.getElementById('draft-content');
      if (!globalState || !globalState.players || globalState.players.length === 0) {
        container.innerHTML = '<div class="empty-message">No players registered.</div>';
        return;
      }
      
      const totalMax = globalState.players.reduce((sum, p) => sum + p.maxDrafts, 0);
      const isComplete = globalState.draftResults.length > 0 && globalState.draftResults.length === totalMax;
      
      let html = '';
      if (isComplete) {
        html += \`
          <div class="championship-banner" style="background: linear-gradient(135deg, rgba(212, 175, 55, 0.1) 0%, rgba(13, 61, 34, 0.4) 100%); border: 2px solid var(--color-gold); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px; box-shadow: 0 8px 32px var(--color-gold-glow); display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <i class="fa-solid fa-trophy" style="font-size: 38px; color: var(--color-gold); filter: drop-shadow(0 0 8px rgba(212, 175, 55, 0.6));"></i>
            <h2 style="font-family: 'Rajdhani', sans-serif; font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: var(--color-gold-light);">DRAFT COMPLETED</h2>
            <p style="font-size: 12px; color: rgba(255,255,255,0.7); max-width: 500px;">All 48 World Cup teams have been assigned. Standings and matches are now live below!</p>
          </div>
        \`;
      }
      
      html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;">';
      
      globalState.players.forEach(player => {
        const playerResults = globalState.draftResults.filter(r => r.player === player.name);
        const quotaMet = playerResults.length >= player.maxDrafts;
        
        html += \`
          <div class="player-rank-card \${quotaMet ? 'player-card-complete' : ''}" style="\${quotaMet ? 'border: 2px solid var(--color-gold);' : ''}">
            <div class="player-rank-header" style="border: none; padding-bottom: 0;">
              <h3 style="font-size: 16px; font-weight: 800; text-transform: uppercase; color: #fff;">\${player.name}</h3>
              <span style="font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700; color: var(--color-gold);">\${playerResults.length} / \${player.maxDrafts}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 10px;">
        \`;
        
        if (playerResults.length === 0) {
          html += '<div class="empty-message" style="padding: 10px 0;">No teams drafted yet</div>';
        } else {
          playerResults.forEach(res => {
            html += \`
              <div style="display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); padding: 8px 10px; border-radius: 10px;">
                <img src="https://flagcdn.com/w40/\${res.team.code}.png" style="width: 32px; height: 20px; object-fit: cover; border-radius: 3px;" alt="\${res.team.name}" />
                <span style="font-size: 12px; font-weight: 700; text-transform: uppercase;">\${res.team.name}</span>
              </div>
            \`;
          });
        }
        
        html += \`
            </div>
          </div>
        \`;
      });
      html += '</div>';
      container.innerHTML = html;
    }

    // Admin Console Lock / Unlock
    function unlockAdminConsole() {
      const psw = document.getElementById('admin-password').value;
      if (psw === 'Tavoo') {
        localStorage.setItem('wc_draft_admin_pw', psw);
        document.getElementById('admin-lock-screen').style.display = 'none';
        document.getElementById('admin-main-console').style.display = 'block';
        document.getElementById('admin-error').style.display = 'none';
        renderAdminMatchesList();
      } else {
        document.getElementById('admin-error').style.display = 'block';
      }
    }

    function lockAdminConsole() {
      localStorage.removeItem('wc_draft_admin_pw');
      document.getElementById('admin-lock-screen').style.display = 'flex';
      document.getElementById('admin-main-console').style.display = 'none';
      document.getElementById('admin-password').value = '';
    }

    function updateAdminForm() {
      if (!globalState || !globalState.scoringSettings) return;
      const s = globalState.scoringSettings;
      document.getElementById('set-groupWin').value = s.groupWin;
      document.getElementById('set-groupDraw').value = s.groupDraw;
      document.getElementById('set-advanceR32').value = s.advanceR32;
      document.getElementById('set-advanceR16').value = s.advanceR16;
      document.getElementById('set-advanceQF').value = s.advanceQF;
      document.getElementById('set-advanceSF').value = s.advanceSF;
      document.getElementById('set-advanceFinal').value = s.advanceFinal;
      document.getElementById('set-winTournament').value = s.winTournament;
    }

    // Save Point Settings
    async function savePointSettings(e) {
      e.preventDefault();
      const psw = localStorage.getItem('wc_draft_admin_pw');
      
      const payload = {
        scoringSettings: {
          groupWin: document.getElementById('set-groupWin').value,
          groupDraw: document.getElementById('set-groupDraw').value,
          advanceR32: document.getElementById('set-advanceR32').value,
          advanceR16: document.getElementById('set-advanceR16').value,
          advanceQF: document.getElementById('set-advanceQF').value,
          advanceSF: document.getElementById('set-advanceSF').value,
          advanceFinal: document.getElementById('set-advanceFinal').value,
          winTournament: document.getElementById('set-winTournament').value
        }
      };

      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Draft-Password': psw
          },
          body: JSON.stringify(payload)
        });
        
        if (res.ok) {
          alert('Scoring system updated successfully!');
          loadData();
        } else {
          alert('Failed to update scoring settings.');
        }
      } catch (err) {
        alert('Network error updating settings: ' + err.message);
      }
    }

    // Trigger openfootball automated scores collection
    async function triggerAutoSync() {
      const psw = localStorage.getItem('wc_draft_admin_pw');
      const btn = document.getElementById('btn-auto-sync');
      
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch spinner"></i> Fetching...';
      
      try {
        const res = await fetch('/api/fetch-scores', {
          method: 'POST',
          headers: { 'X-Draft-Password': psw }
        });
        
        if (res.ok) {
          alert('Scores synced from openfootball API successfully!');
          await loadData();
          renderAdminMatchesList();
        } else {
          const body = await res.json();
          alert('Sync failed: ' + (body.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Sync network error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync GitHub Scores';
      }
    }

    // Mock Simulation Mode (For testing Standings and Match timelines before actual tournament starts)
    async function triggerMockSimulation() {
      if (!confirm('This will simulate randomized match scores for current scheduled games for test display. Proceed?')) return;
      const psw = localStorage.getItem('wc_draft_admin_pw');
      
      // We will loop through the scheduled group matches and mock up scores
      if (!globalState || !globalState.matches) return;
      
      try {
        let count = 0;
        for (let m of globalState.matches) {
          // Simulate group stage matches that are not played yet
          if (m.round.startsWith('Matchday') && m.status === 'scheduled') {
            const h = Math.floor(Math.random() * 4); // 0-3 goals
            const a = Math.floor(Math.random() * 4);
            
            await fetch('/api/matches', {
              method: 'POST',
              headers: { 
                'Content-Type': 'application/json',
                'X-Draft-Password': psw
              },
              body: JSON.stringify({
                matchId: m.id,
                homeScore: h,
                awayScore: a,
                status: 'finished',
                isManual: false // Keep as non-manual so sync can rewrite it later
              })
            });
            count++;
            
            // Limit mock size for speed
            if (count >= 24) break;
          }
        }
        
        alert(\`Successfully simulated \${count} matches! Leaderboard updated.\`);
        await loadData();
        renderAdminMatchesList();
      } catch (err) {
        alert('Simulation failed: ' + err.message);
      }
    }

    // Manual Matches editor list
    let adminSearchQuery = '';
    function onAdminSearchMatches(val) {
      adminSearchQuery = val.toLowerCase();
      renderAdminMatchesList();
    }

    function renderAdminMatchesList() {
      const container = document.getElementById('admin-matches-list');
      if (!globalState || !globalState.matches || globalState.matches.length === 0) {
        container.innerHTML = '<div class="empty-message">No matches to display.</div>';
        return;
      }
      
      let filtered = globalState.matches;
      if (adminSearchQuery) {
        filtered = filtered.filter(m => 
          m.homeTeam.toLowerCase().includes(adminSearchQuery) || 
          m.awayTeam.toLowerCase().includes(adminSearchQuery) ||
          m.round.toLowerCase().includes(adminSearchQuery)
        );
      }
      
      let html = '';
      filtered.slice(0, 50).forEach(m => {
        const homeScoreVal = m.homeScore !== null ? m.homeScore : '';
        const awayScoreVal = m.awayScore !== null ? m.awayScore : '';
        
        html += \`
          <div class="admin-match-row-item">
            <div style="display:flex; flex-direction:column; min-width: 0;">
              <span class="admin-match-teams-label" style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                \${m.homeTeam} vs \${m.awayTeam}
              </span>
              <span style="font-size:9px; color:rgba(255,255,255,0.4);">\${m.round}</span>
            </div>
            
            <div class="admin-match-inputs">
              <input type="number" min="0" max="20" placeholder="H" value="\${homeScoreVal}" class="admin-score-input" id="admin-h-\${m.id}" />
              <span>-</span>
              <input type="number" min="0" max="20" placeholder="A" value="\${awayScoreVal}" class="admin-score-input" id="admin-a-\${m.id}" />
              
              <select class="admin-match-select" id="admin-s-\${m.id}">
                <option value="scheduled" \${m.status === 'scheduled' ? 'selected' : ''}>Sch</option>
                <option value="finished" \${m.status === 'finished' ? 'selected' : ''}>Fin</option>
                <option value="live" \${m.status === 'live' ? 'selected' : ''}>Live</option>
              </select>
              
              <button class="btn-save-match" onclick="saveManualMatchScore('\${m.id}')">Save</button>
            </div>
          </div>
        \`;
      });
      
      if (filtered.length > 50) {
        html += \`<div style="text-align:center; font-size:10px; color:rgba(255,255,255,0.3); padding-top:8px;">Showing first 50 results (Total: \${filtered.length})</div>\`;
      }
      
      container.innerHTML = html;
    }

    async function saveManualMatchScore(matchId) {
      const psw = localStorage.getItem('wc_draft_admin_pw');
      const hInput = document.getElementById('admin-h-' + matchId).value;
      const aInput = document.getElementById('admin-a-' + matchId).value;
      const sSelect = document.getElementById('admin-s-' + matchId).value;
      
      const payload = {
        matchId: matchId,
        homeScore: hInput,
        awayScore: aInput,
        status: sSelect,
        isManual: true // Set isManual to true to protect from auto-fetches
      };
      
      try {
        const res = await fetch('/api/matches', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Draft-Password': psw
          },
          body: JSON.stringify(payload)
        });
        
        if (res.ok) {
          // Success flash
          await loadData();
          renderAdminMatchesList();
        } else {
          alert('Failed to save score.');
        }
      } catch (err) {
        alert('Override error: ' + err.message);
      }
    }

    // Helper client-side Standings calculator (re-calculates standings instantly on data loads)
    function calculatePlayerStandings(state) {
      const settings = state.scoringSettings || defaultSettings;
      const matches = state.matches || [];
      
      const standings = {};
      state.players.forEach(p => {
        standings[p.name] = {
          name: p.name,
          points: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          activeTeamsCount: 0,
          teams: []
        };
      });

      const knockoutRounds = ['Round of 32', 'Round of 16', 'Quarter-final', 'Quarter-finals', 'Semi-final', 'Semi-finals', 'Final'];

      state.draftResults.forEach(res => {
        const pName = res.player;
        const tName = res.team.name;
        const tCode = res.team.code;
        
        if (!standings[pName]) return;
        
        let teamPoints = 0;
        let teamWins = 0;
        let teamDraws = 0;
        let teamLosses = 0;
        let teamGoals = 0;
        
        const awardedKnockouts = { R32: false, R16: false, QF: false, SF: false, Final: false, Winner: false };

        matches.forEach(m => {
          const isHome = m.homeTeam === tName;
          const isAway = m.awayTeam === tName;
          if (!isHome && !isAway) return;
          
          const isGroup = m.round.startsWith('Matchday');
          
          if (m.homeScore !== null && m.awayScore !== null) {
            teamGoals += isHome ? m.homeScore : m.awayScore;
          }
          
          if (m.status === 'finished') {
            const outcome = getMatchWinnerLoser(m);
            if (outcome.draw) {
              if (isGroup) {
                teamPoints += settings.groupDraw;
                teamDraws++;
              }
            } else if (outcome.winner === tName) {
              if (isGroup) {
                teamPoints += settings.groupWin;
                teamWins++;
              }
            } else {
              if (isGroup) {
                teamLosses++;
              }
            }
          }
          
          const r = m.round;
          if (r === 'Round of 32' && !awardedKnockouts.R32) {
            teamPoints += settings.advanceR32;
            awardedKnockouts.R32 = true;
          } else if (r === 'Round of 16' && !awardedKnockouts.R16) {
            teamPoints += settings.advanceR16;
            awardedKnockouts.R16 = true;
          } else if ((r === 'Quarter-final' || r === 'Quarter-finals') && !awardedKnockouts.QF) {
            teamPoints += settings.advanceQF;
            awardedKnockouts.QF = true;
          } else if ((r === 'Semi-final' || r === 'Semi-finals') && !awardedKnockouts.SF) {
            teamPoints += settings.advanceSF;
            awardedKnockouts.SF = true;
          } else if (r === 'Final' && !awardedKnockouts.Final) {
            teamPoints += settings.advanceFinal;
            awardedKnockouts.Final = true;
            
            if (m.status === 'finished') {
              const outcome = getMatchWinnerLoser(m);
              if (outcome.winner === tName && !awardedKnockouts.Winner) {
                teamPoints += settings.winTournament;
                awardedKnockouts.Winner = true;
              }
            }
          }
        });

        // Elim check
        let isEliminated = false;
        for (const m of matches) {
          if (m.status === 'finished' && knockoutRounds.some(kr => m.round.includes(kr))) {
            const outcome = getMatchWinnerLoser(m);
            if (outcome.loser === tName) {
              isEliminated = true;
              break;
            }
          }
        }
        
        standings[pName].points += teamPoints;
        standings[pName].wins += teamWins;
        standings[pName].draws += teamDraws;
        standings[pName].losses += teamLosses;
        standings[pName].goalsFor += teamGoals;
        if (!isEliminated) {
          standings[pName].activeTeamsCount++;
        }
        
        standings[pName].teams.push({
          name: tName,
          code: tCode,
          points: teamPoints,
          goalsFor: teamGoals,
          isEliminated: isEliminated
        });
      });

      return Object.values(standings).sort((a, b) => b.points - a.points || b.activeTeamsCount - a.activeTeamsCount || b.wins - a.wins || b.goalsFor - a.goalsFor);
    }

    // Startup initialization
    loadData();
    setInterval(loadData, 5000); // Poll dashboard state updates every 5 seconds
  </script>
</body>
</html>`;
}
