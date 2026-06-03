// 2026 World Cup Draft App State Management & Physics Coordinator

// Compute default max drafts per player dynamically (e.g. 48 / 8 = 6)
const getDefaultMaxDrafts = () => {
  const pCount = (typeof INITIAL_PLAYERS !== 'undefined') ? INITIAL_PLAYERS.length : 8;
  const tCount = (typeof INITIAL_TEAMS !== 'undefined') ? INITIAL_TEAMS.length : 48;
  return Math.ceil(tCount / pCount);
};

const HARDCODED_WORKER_URL = 'https://worldcup-draft-2026.thomasrobb5.workers.dev';

// App State
let state = {
  players: [], // Array of { name: string, maxDrafts: number }
  draftResults: [], // Array of { id: string, player: string, team: { name: string, code: string }, timestamp: number }
  gameState: 'SELECTING_PLAYER', // SELECTING_PLAYER, SPINNING_PLAYER, PLAYER_SELECTED, SPINNING_TEAM, TEAM_SELECTED, REVEAL
  selectedPlayer: null, // Name of the selected player
  selectedTeam: null, // Selected team object
  isMuted: false,
  spinDuration: 6.0, // default spin duration in seconds
  spinSpeedFactor: 1.0, // default speed multiplier
  workerUrl: HARDCODED_WORKER_URL // Hardcoded Cloudflare Worker Sync URL
};

// Web Audio API Synthesizer Fallback (for instant sound cues)
const audioSynthFallback = {
  ctx: null,
  
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Web Audio API not supported", e);
    }
  },
  
  playTick() {
    if (state.isMuted) return;
    this.init();
    if (!this.ctx) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);
    
    gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  },
  
  playWhistle() {
    if (state.isMuted) return;
    this.init();
    if (!this.ctx) return;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(2200, this.ctx.currentTime);
    osc1.frequency.linearRampToValueAtTime(2400, this.ctx.currentTime + 0.12);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2230, this.ctx.currentTime);
    osc2.frequency.linearRampToValueAtTime(2430, this.ctx.currentTime + 0.12);
    
    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc1.start();
    osc2.start();
    osc1.stop(this.ctx.currentTime + 0.2);
    osc2.stop(this.ctx.currentTime + 0.2);
  },
  
  playCheer() {
    if (state.isMuted) return;
    this.init();
    if (!this.ctx) return;
    
    // Synthesis of crowd cheering using a white noise buffer
    const bufferSize = this.ctx.sampleRate * 2.5; // 2.5 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, this.ctx.currentTime);
    filter.Q.setValueAtTime(1.2, this.ctx.currentTime);
    
    const filter2 = this.ctx.createBiquadFilter();
    filter2.type = 'lowpass';
    filter2.frequency.setValueAtTime(1600, this.ctx.currentTime);
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + 0.4); // Fade in
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 2.5); // Slow decay
    
    noise.connect(filter);
    filter.connect(filter2);
    filter2.connect(gain);
    gain.connect(this.ctx.destination);
    
    noise.start();
    noise.stop(this.ctx.currentTime + 2.5);
  }
};

// Dispatch audio calls (checks global audio.js hooks or falls back to synths)
const triggerAudio = {
  playTick(velocity = 0.1) {
    if (window.audioController && typeof window.audioController.playTick === 'function') {
      // Map velocity (typically 0.001 to 0.58) to rate factor (0.4 to 2.2)
      const rate = Math.max(0.4, Math.min(2.2, velocity * 4.0));
      window.audioController.playTick(0.12, rate);
    } else {
      audioSynthFallback.playTick();
    }
  },
  playWhistle() {
    if (window.audioController && typeof window.audioController.playWhistle === 'function') {
      window.audioController.playWhistle();
    } else {
      audioSynthFallback.playWhistle();
    }
  },
  playCheer() {
    if (window.audioController && typeof window.audioController.playCheer === 'function') {
      window.audioController.playCheer();
    } else {
      audioSynthFallback.playCheer();
    }
  }
};

// Wheel Physics & Canvas Render Class
class Wheel {
  constructor(canvasId, getItemsCallback, onTick, onLand) {
    this.canvas = document.getElementById(canvasId);
    this.getItems = getItemsCallback;
    this.onTick = onTick;
    this.onLand = onLand;
    
    this.angle = 0;
    this.angularVelocity = 0;
    this.friction = 0.988; // Deceleration rate
    this.isSpinning = false;
    this.lastTickIndex = -1;
    this.highlightedIndex = -1;
    
    window.addEventListener('resize', () => this.draw());
  }
  
  spin() {
    if (this.isSpinning) return;
    const items = this.getItems();
    if (items.length === 0) return;
    
    this.isSpinning = true;
    this.highlightedIndex = -1;
    
    // Unpredictable initial velocity scaled by custom spin speed factor
    const baseVelocity = Math.random() * 0.2 + 0.38;
    this.angularVelocity = baseVelocity * state.spinSpeedFactor;
    
    // Compute deceleration friction dynamically so the spin lasts exactly state.spinDuration seconds (assuming 60 FPS)
    // Formula: friction = exp( ln(0.001 / V_initial) / (60 * duration) )
    const targetDurationFrames = 60 * state.spinDuration;
    const ratio = 0.001 / this.angularVelocity;
    this.friction = Math.exp(Math.log(ratio) / targetDurationFrames);
    
    this.lastTickIndex = this.getSliceIndexUnderPointer();
    this.animate();
  }
  
  getSliceIndexUnderPointer() {
    const items = this.getItems();
    if (items.length === 0) return -1;
    
    const sliceAngle = (2 * Math.PI) / items.length;
    // Indicator needle is fixed at the top (1.5 * Math.PI)
    let localAngle = (1.5 * Math.PI - this.angle) % (2 * Math.PI);
    if (localAngle < 0) localAngle += 2 * Math.PI;
    
    return Math.floor(localAngle / sliceAngle) % items.length;
  }
  
  animate() {
    if (!this.isSpinning) return;
    
    this.angle += this.angularVelocity;
    this.angularVelocity *= this.friction;
    
    const currentTickIndex = this.getSliceIndexUnderPointer();
    if (currentTickIndex !== this.lastTickIndex && currentTickIndex !== -1) {
      this.lastTickIndex = currentTickIndex;
      if (this.onTick) this.onTick(this.angularVelocity);
    }
    
    this.draw();
    
    if (this.angularVelocity < 0.001) {
      this.isSpinning = false;
      this.angularVelocity = 0;
      this.highlightedIndex = this.getSliceIndexUnderPointer();
      this.draw();
      if (this.onLand) this.onLand(this.highlightedIndex);
    } else {
      requestAnimationFrame(() => this.animate());
    }
  }
  
  draw() {
    const canvas = this.canvas;
    const slices = this.getItems();
    const currentAngle = this.angle;
    const highlightedIndex = this.highlightedIndex;
    
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Use clientWidth and clientHeight directly to avoid scale-transform box distortions
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      const rect = canvas.getBoundingClientRect();
      width = rect.width || 280;
      height = rect.height || 280;
    }
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 12;
    
    ctx.clearRect(0, 0, width, height);
    
    if (slices.length === 0) {
      // Empty/Draft Complete State
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4;
      ctx.stroke();
      
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 13px "Montserrat", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('NO ITEMS AVAILABLE', cx, cy);
      return;
    }
    
    const sliceAngle = (2 * Math.PI) / slices.length;
    
    // Premium contrasting dark theme color palette
    const sliceColors = [
      '#1e293b', // Deep Slate
      '#0d5c3a', // Dark Emerald
      '#2e1065', // Dark Violet
      '#7f1d1d', // Maroon
      '#111827', // Blackish gray
      '#1e3a8a', // Deep Blue
      '#065f46', // Teal
      '#172554', // Navy
    ];
    
    for (let i = 0; i < slices.length; i++) {
      const startAngle = currentAngle + i * sliceAngle;
      const endAngle = startAngle + sliceAngle;
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      
      let fillColor;
      if (highlightedIndex === i) {
        fillColor = '#d4af37'; // Highlight landing in Gold
      } else {
        fillColor = sliceColors[i % sliceColors.length];
        // Odd number color matching patch
        if (i === slices.length - 1 && slices.length % sliceColors.length === 1) {
          fillColor = sliceColors[(i + 1) % sliceColors.length];
        }
      }
      
      ctx.fillStyle = fillColor;
      ctx.fill();
      
      // Slice lines
      ctx.strokeStyle = '#05070c';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Text labels
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(startAngle + sliceAngle / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      
      ctx.fillStyle = (highlightedIndex === i) ? '#0b0f19' : '#ffffff';
      
      // Legible dynamic font size scaling with wheel size (prevents tiny blur on 440px wheels)
      const fontSize = Math.max(10, Math.min(14, Math.floor(width / 32)));
      ctx.font = `bold ${fontSize}px "Montserrat", sans-serif`;
      
      let text = slices[i];
      if (text.length > 15) text = text.substring(0, 13) + '..';
      ctx.fillText(text, radius - 18, 0);
      ctx.restore();
    }
    
    // Outer golden trim
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Center cap hub
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, 2 * Math.PI);
    ctx.fillStyle = '#05070c';
    ctx.fill();
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 9px "Rajdhani", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DRAFT', cx, cy - 2);
    ctx.fillStyle = '#d4af37';
    ctx.fillText('2026', cx, cy + 8);
    
    // Draw top clicker pointer pin
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius + 5);
    ctx.lineTo(cx - 10, cy - radius - 10);
    ctx.lineTo(cx + 10, cy - radius - 10);
    ctx.closePath();
    ctx.fillStyle = '#d4af37';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Instantiate Wheels
let playerWheel;
let teamWheel;

// Helper State Computations
function getPlayerDraftCount(playerName) {
  return state.draftResults.filter(r => r.player === playerName).length;
}

function getAvailablePlayers() {
  return state.players.filter(p => getPlayerDraftCount(p.name) < p.maxDrafts);
}

function getRemainingTeams() {
  const draftedTeamNames = state.draftResults.map(r => r.team.name);
  const defaultTeams = (typeof INITIAL_TEAMS !== 'undefined') ? INITIAL_TEAMS : [];
  return defaultTeams.filter(t => !draftedTeamNames.includes(t.name));
}

// Cloudflare Worker Sync Functions
async function pushToCloud() {
  const url = HARDCODED_WORKER_URL;
  
  updateSyncStatusUI('syncing');
  try {
    const res = await fetch(`${url}/api/draft`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Draft-Password': 'Tavoo'
      },
      body: JSON.stringify(state)
    });
    if (res.ok) {
      updateSyncStatusUI('synced');
    } else {
      updateSyncStatusUI('offline');
    }
  } catch (err) {
    console.error("Cloud push failed:", err);
    updateSyncStatusUI('offline');
  }
}

async function fetchFromCloud(forceLoad = false) {
  const url = HARDCODED_WORKER_URL;
  
  updateSyncStatusUI('syncing');
  try {
    const res = await fetch(`${url}/api/draft`);
    if (res.ok) {
      const cloudState = await res.json();
      
      // If the cloud state is completely uninitialized, push our local state to it
      if (!cloudState.players || cloudState.players.length === 0) {
        pushToCloud();
        updateSyncStatusUI('synced');
        return;
      }

      // If forceLoad is true or cloud has more draft results, apply cloud state
      if (forceLoad || (cloudState.draftResults && cloudState.draftResults.length > state.draftResults.length) || !state.draftResults || state.draftResults.length === 0) {
        state = {
          players: (cloudState.players && cloudState.players.length > 0) ? cloudState.players : state.players,
          draftResults: cloudState.draftResults || [],
          gameState: cloudState.gameState || 'SELECTING_PLAYER',
          selectedPlayer: cloudState.selectedPlayer || null,
          selectedTeam: cloudState.selectedTeam || null,
          isMuted: cloudState.isMuted || false,
          spinDuration: cloudState.spinDuration || state.spinDuration || 6.0,
          spinSpeedFactor: cloudState.spinSpeedFactor || state.spinSpeedFactor || 1.0,
          workerUrl: url
        };
        saveState(false); // save locally without triggering another push to prevent loop
        initApp();
      }
      updateSyncStatusUI('synced');
    } else {
      updateSyncStatusUI('offline');
    }
  } catch (err) {
    console.error("Cloud fetch failed:", err);
    updateSyncStatusUI('offline');
  }
}

function updateSyncStatusUI(status) {
  const badge = document.getElementById('sync-status');
  if (!badge) return;
  
  if (status === 'local') {
    badge.className = 'sync-badge local-mode';
    badge.innerText = 'Local Only';
  } else if (status === 'syncing') {
    badge.className = 'sync-badge syncing-mode';
    badge.innerText = 'Syncing...';
  } else if (status === 'synced') {
    badge.className = 'sync-badge synced-mode';
    badge.innerText = 'Synced';
  } else if (status === 'offline') {
    badge.className = 'sync-badge offline-mode';
    badge.innerText = 'Offline';
  }
}

// Initial Sync & LocalStorage handling
function loadState() {
  const saved = localStorage.getItem('wc_draft_state');
  const defaultPlayersList = (typeof INITIAL_PLAYERS !== 'undefined') ? INITIAL_PLAYERS : ["Ross", "Brad", "Tav", "Saunders", "Matt", "Albury", "Mook", "Boob"];
  
  if (saved) {
    try {
      state = JSON.parse(saved);
      // Ensure all fields exist
      if (!state.players || state.players.length === 0) {
        state.players = defaultPlayersList.map(name => ({ name, maxDrafts: getDefaultMaxDrafts() }));
      }
      if (!state.draftResults) state.draftResults = [];
      if (!state.gameState) state.gameState = 'SELECTING_PLAYER';
      if (state.spinDuration === undefined) state.spinDuration = 6.0;
      if (state.spinSpeedFactor === undefined) state.spinSpeedFactor = 1.0;
      state.workerUrl = HARDCODED_WORKER_URL; // Enforce hardcoded endpoint
    } catch (e) {
      console.error("Failed to parse local storage state. Reverting to default.", e);
      state.players = defaultPlayersList.map(name => ({ name, maxDrafts: getDefaultMaxDrafts() }));
      state.draftResults = [];
      state.gameState = 'SELECTING_PLAYER';
      state.workerUrl = HARDCODED_WORKER_URL; // Enforce hardcoded endpoint
    }
  } else {
    state.players = defaultPlayersList.map(name => ({ name, maxDrafts: getDefaultMaxDrafts() }));
    state.draftResults = [];
    state.gameState = 'SELECTING_PLAYER';
    state.workerUrl = HARDCODED_WORKER_URL; // Enforce hardcoded endpoint
  }
  
  updateMuteStateUI();
  
  // Try to sync with Cloud Worker on startup (force pull cloud state)
  setTimeout(() => {
    fetchFromCloud(true);
  }, 100);
}

function saveState(pushCloud = true) {
  localStorage.setItem('wc_draft_state', JSON.stringify(state));
  if (pushCloud) {
    pushToCloud();
  }
}

function updateMuteStateUI() {
  const muteIcon = document.getElementById('mute-icon');
  const muteBtnSpan = document.querySelector('#btn-mute span');
  if (state.isMuted) {
    muteIcon.className = "fa-solid fa-volume-xmark mute-icon-muted";
    muteBtnSpan.innerText = "Unmute Sound";
  } else {
    muteIcon.className = "fa-solid fa-volume-high mute-icon-gold";
    muteBtnSpan.innerText = "Mute Sound";
  }
}

// App Logic Initialization
function initApp() {
  renderPlayers();
  renderDraftHistory();
  renderRemainingTeams();
  updateDraftProgress();
  updateTicker();
  updateUIForState();
  
  playerWheel.draw();
  teamWheel.draw();
}

// Render dynamic players list with manual adjustments
function renderPlayers() {
  const container = document.getElementById('players-list');
  container.innerHTML = '';
  
  state.players.forEach((player, index) => {
    const draftCount = getPlayerDraftCount(player.name);
    const quotaMet = draftCount >= player.maxDrafts;
    
    const row = document.createElement('div');
    row.className = `player-row ${quotaMet ? 'player-quota-met' : 'player-active'}`;
    
    row.innerHTML = `
      <div class="player-info">
        <span class="player-name ${quotaMet ? 'player-name-full' : ''}">${player.name}</span>
        ${quotaMet ? '<span class="badge-full">Full</span>' : ''}
      </div>
      <div class="player-actions">
        <span class="player-drafts ${quotaMet ? 'drafts-full' : 'drafts-active'}">
          ${draftCount} /
        </span>
        <input type="number" min="${draftCount}" max="48" value="${player.maxDrafts}" 
          class="player-limit-input"
          data-player-index="${index}" />
      </div>
    `;
    
    container.appendChild(row);
  });
  
  // Attach input listener
  container.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.playerIndex);
      const val = parseInt(e.target.value) || 0;
      state.players[idx].maxDrafts = val;
      saveState();
      updateDraftProgress();
      playerWheel.draw();
    });
  });
}

// Render team status cards in the grid
function renderRemainingTeams() {
  const grid = document.getElementById('teams-grid');
  const searchInput = document.getElementById('search-teams');
  const filter = searchInput.value.toLowerCase();
  
  grid.innerHTML = '';
  const defaultTeams = (typeof INITIAL_TEAMS !== 'undefined') ? INITIAL_TEAMS : [];
  
  defaultTeams.forEach(team => {
    const isDrafted = state.draftResults.some(r => r.team.name === team.name);
    const draftRecord = state.draftResults.find(r => r.team.name === team.name);
    
    if (filter && !team.name.toLowerCase().includes(filter)) {
      return;
    }
    
    const card = document.createElement('div');
    if (isDrafted) {
      card.className = "team-card team-card-drafted";
      card.innerHTML = `
        <img src="https://flagcdn.com/w40/${team.code}.png" alt="${team.name}" class="team-flag team-flag-drafted" />
        <div class="team-details">
          <p class="team-name team-name-drafted">${team.name}</p>
          <p class="team-draft-owner">By ${draftRecord.player}</p>
        </div>
      `;
    } else {
      card.className = "team-card team-card-available";
      card.innerHTML = `
        <img src="https://flagcdn.com/w40/${team.code}.png" alt="${team.name}" class="team-flag team-flag-available" />
        <div class="team-details">
          <p class="team-name team-name-available">${team.name}</p>
          <span class="badge-available">Available</span>
        </div>
      `;
    }
    grid.appendChild(card);
  });
}

// Render dynamic draft list in sidebar
function renderDraftHistory() {
  const container = document.getElementById('draft-results');
  if (state.draftResults.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder">
        No teams drafted yet. Let's spin!
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  const history = [...state.draftResults].reverse();
  
  history.forEach(draft => {
    const item = document.createElement('div');
    item.className = "history-item";
    
    const timeString = new Date(draft.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    item.innerHTML = `
      <div class="history-item-left">
        <img src="https://flagcdn.com/w40/${draft.team.code}.png" alt="${draft.team.name}" class="history-item-flag" />
        <div class="history-item-details">
          <p class="history-item-text"><span class="history-item-player">${draft.player}</span> got</p>
          <h4 class="history-item-team">${draft.team.name}</h4>
        </div>
      </div>
      <div class="history-item-right">
        <span class="history-item-time">${timeString}</span>
        <button class="btn-delete-draft" data-draft-id="${draft.id}">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    
    container.appendChild(item);
  });
  
  // Attach single log delete
  container.querySelectorAll('.btn-delete-draft').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const draftId = e.currentTarget.dataset.draftId;
      if (confirm("Are you sure you want to delete this specific draft pick? The team will return to the pool.")) {
        state.draftResults = state.draftResults.filter(r => r.id !== draftId);
        // If team was deleted, reset selection state to avoid conflict
        state.gameState = 'SELECTING_PLAYER';
        state.selectedPlayer = null;
        state.selectedTeam = null;
        saveState();
        initApp();
      }
    });
  });
}

// Update remaining count tracker
function updateDraftProgress() {
  const tracker = document.getElementById('global-drafts-tracker');
  const count = state.draftResults.length;
  const totalMax = state.players.reduce((sum, p) => sum + p.maxDrafts, 0);
  tracker.innerText = `Drafted: ${count}/${totalMax}`;
}

// Live scroll updates
function updateTicker() {
  const tickerContent = document.getElementById('ticker-content');
  if (state.draftResults.length === 0) {
    const playerCount = state.players ? state.players.length : 8;
    tickerContent.innerHTML = `WELCOME TO THE 2026 WORLD CUP DRAFT! • SPIN THE PLAYER WHEEL TO START THE DRAFT • 48 TEAMS, ${playerCount} PLAYERS, ONE ULTIMATE WINNER • DRAFT LIVE! •`;
    return;
  }
  
  let news = "DRAFT UPDATES: ";
  const recentDrafts = [...state.draftResults].reverse();
  recentDrafts.forEach((draft) => {
    const timeString = new Date(draft.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    news += `${draft.player} drafted ${draft.team.name.toUpperCase()} at ${timeString} • `;
  });
  
  tickerContent.innerHTML = news + " 2026 WORLD CUP DRAFT LIVE •";
}

// Handle layout transitions & disable states
function updateUIForState() {
  const pContainer = document.getElementById('player-wheel-container');
  const tContainer = document.getElementById('team-wheel-container');
  const btnSpinPlayer = document.getElementById('btn-spin-player');
  const btnSpinTeam = document.getElementById('btn-spin-team');
  const statusText = document.getElementById('draft-status-text');
  
  const pDisplay = document.getElementById('player-selected-display');
  const tDisplay = document.getElementById('team-selected-display');
  
  if (state.gameState === 'SELECTING_PLAYER') {
    pContainer.classList.remove('disabled-state');
    tContainer.classList.add('disabled-state');
    
    btnSpinPlayer.disabled = false;
    btnSpinTeam.disabled = true;
    
    statusText.innerText = 'STEP 1: SPIN THE PLAYER WHEEL';
    pDisplay.innerHTML = '<span class="status-ready animate-pulse">Ready to spin</span>';
    tDisplay.innerText = 'Waiting for player selection...';
  } 
  else if (state.gameState === 'SPINNING_PLAYER') {
    pContainer.classList.remove('disabled-state');
    tContainer.classList.add('disabled-state');
    
    btnSpinPlayer.disabled = true;
    btnSpinTeam.disabled = true;
    
    statusText.innerText = 'SELECTING A DRAFT PLAYER...';
    pDisplay.innerText = 'Selecting...';
    tDisplay.innerText = 'Waiting...';
  } 
  else if (state.gameState === 'PLAYER_SELECTED') {
    pContainer.classList.add('disabled-state');
    tContainer.classList.remove('disabled-state');
    
    btnSpinPlayer.disabled = true;
    btnSpinTeam.disabled = false;
    
    statusText.innerText = `STEP 2: SPIN TEAM WHEEL FOR ${state.selectedPlayer.toUpperCase()}!`;
    pDisplay.innerHTML = `Drafting: <strong class="highlight-player-selected">${state.selectedPlayer}</strong>`;
    tDisplay.innerHTML = '<span class="status-ready animate-pulse">Ready to spin</span>';
  } 
  else if (state.gameState === 'SPINNING_TEAM') {
    pContainer.classList.add('disabled-state');
    tContainer.classList.remove('disabled-state');
    
    btnSpinPlayer.disabled = true;
    btnSpinTeam.disabled = true;
    
    statusText.innerText = `SPINNING TEAM FOR ${state.selectedPlayer.toUpperCase()}...`;
    pDisplay.innerHTML = `Drafting: <strong class="highlight-player-selected">${state.selectedPlayer}</strong>`;
    tDisplay.innerText = 'Selecting team...';
  }
}

// FUT-style Reveal Overlay triggering
function showRevealModal(player, team) {
  const modal = document.getElementById('reveal-modal');
  const cardContainer = document.getElementById('reveal-card-container');
  const flagImg = document.getElementById('reveal-team-flag');
  const teamNameText = document.getElementById('reveal-team-name');
  const playerNameText = document.getElementById('reveal-player-name');
  
  flagImg.src = `https://flagcdn.com/w160/${team.code}.png`;
  teamNameText.innerText = team.name;
  playerNameText.innerText = player;
  
  modal.classList.remove('opacity-0', 'pointer-events-none');
  cardContainer.classList.remove('scale-50');
  cardContainer.classList.add('scale-100');
  
  triggerAudio.playCheer();
  createConfetti();
}

function createConfetti() {
  const container = document.getElementById('modal-particles');
  container.innerHTML = '';
  
  const colors = ['#d4af37', '#e5c060', '#3b82f6', '#10b981', '#ef4444', '#ec4899'];
  for (let i = 0; i < 60; i++) {
    const particle = document.createElement('div');
    // CSS-handled animate styles
    particle.className = 'absolute rounded-full pointer-events-none opacity-80 confetti-piece';
    
    const size = Math.random() * 8 + 4;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `-20px`;
    
    const delay = Math.random() * 1.5;
    const duration = Math.random() * 2.5 + 1.8;
    particle.style.animation = `confettiFall ${duration}s linear ${delay}s infinite`;
    
    container.appendChild(particle);
  }
}

function showSummaryModal() {
  const modal = document.getElementById('summary-modal');
  const cardContainer = document.getElementById('summary-modal-container');
  const grid = document.getElementById('summary-players-grid');
  
  if (!modal || !cardContainer || !grid) return;
  
  grid.innerHTML = '';
  
  state.players.forEach(player => {
    const playerResults = state.draftResults.filter(r => r.player === player.name);
    const card = document.createElement('div');
    card.className = 'summary-player-card';
    
    let teamsHtml = '';
    if (playerResults.length === 0) {
      teamsHtml = '<div class="no-teams">No teams drafted yet</div>';
    } else {
      playerResults.forEach(res => {
        teamsHtml += `
          <div class="summary-team-item">
            <img src="https://flagcdn.com/w40/${res.team.code}.png" class="summary-team-flag" alt="${res.team.name}" />
            <span class="summary-team-name">${res.team.name}</span>
          </div>
        `;
      });
    }
    
    card.innerHTML = `
      <div class="summary-player-header">
        <h3 class="summary-player-name">${player.name}</h3>
        <span class="summary-player-quota">${playerResults.length}/${player.maxDrafts}</span>
      </div>
      <div class="summary-teams-list">
        ${teamsHtml}
      </div>
    `;
    grid.appendChild(card);
  });
  
  modal.classList.remove('opacity-0', 'pointer-events-none');
  cardContainer.classList.remove('scale-50');
  cardContainer.classList.add('scale-100');
  
  const draftedCount = state.draftResults.length;
  const totalMax = state.players.reduce((sum, p) => sum + p.maxDrafts, 0);
  if (draftedCount > 0 && draftedCount === totalMax) {
    triggerAudio.playCheer();
    createSummaryConfetti();
  }
}

function closeSummaryModal() {
  const modal = document.getElementById('summary-modal');
  const cardContainer = document.getElementById('summary-modal-container');
  if (!modal || !cardContainer) return;
  modal.classList.add('opacity-0', 'pointer-events-none');
  cardContainer.classList.remove('scale-100');
  cardContainer.classList.add('scale-50');
}

function createSummaryConfetti() {
  const container = document.getElementById('summary-particles');
  if (!container) return;
  container.innerHTML = '';
  
  const colors = ['#d4af37', '#e5c060', '#3b82f6', '#10b981', '#ef4444', '#ec4899'];
  for (let i = 0; i < 70; i++) {
    const particle = document.createElement('div');
    particle.className = 'absolute rounded-full pointer-events-none opacity-80 confetti-piece';
    
    const size = Math.random() * 8 + 4;
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    particle.style.left = `${Math.random() * 100}%`;
    particle.style.top = `-20px`;
    
    const delay = Math.random() * 1.8;
    const duration = Math.random() * 2.5 + 2.0;
    particle.style.animation = `confettiFall ${duration}s linear ${delay}s infinite`;
    
    container.appendChild(particle);
  }
}

// Initialize Logic
window.addEventListener('DOMContentLoaded', () => {
  const isUnlocked = sessionStorage.getItem('draft_unlocked') === 'true';
  const lockScreen = document.getElementById('lock-screen');
  
  if (isUnlocked) {
    if (lockScreen) lockScreen.classList.add('fade-out');
    loadState();
  } else {
    if (lockScreen) lockScreen.classList.remove('fade-out');
    
    const lockForm = document.getElementById('lock-form');
    const lockInput = document.getElementById('lock-password');
    const lockError = document.getElementById('lock-error');
    
    if (lockForm) {
      lockForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pwd = lockInput ? lockInput.value.trim() : '';
        if (pwd === 'Tavoo') {
          sessionStorage.setItem('draft_unlocked', 'true');
          if (lockScreen) lockScreen.classList.add('fade-out');
          loadState();
        } else {
          if (lockError) {
            lockError.classList.remove('hidden-input');
            lockError.style.animation = 'none';
            lockError.offsetHeight; // trigger reflow
            lockError.style.animation = '';
          }
          if (lockInput) {
            lockInput.value = '';
            lockInput.focus();
          }
        }
      });
    }
  }
  
  // Audio Context Autoplay Resume Listener
  const initAudioOnGesture = () => {
    if (window.audioController && typeof window.audioController.initAudio === 'function') {
      window.audioController.initAudio();
    }
  };
  window.addEventListener('click', initAudioOnGesture, { once: true });
  window.addEventListener('touchstart', initAudioOnGesture, { once: true });
  
  // Set up wheels callbacks
  playerWheel = new Wheel(
    'player-wheel',
    () => getAvailablePlayers().map(p => p.name),
    (vel) => triggerAudio.playTick(vel),
    (landedIdx) => {
      const available = getAvailablePlayers();
      if (available.length > 0 && landedIdx >= 0) {
        state.selectedPlayer = available[landedIdx].name;
        state.gameState = 'PLAYER_SELECTED';
        triggerAudio.playWhistle();
        saveState();
        updateUIForState();
      }
    }
  );
  
  teamWheel = new Wheel(
    'team-wheel',
    () => getRemainingTeams().map(t => t.name),
    (vel) => triggerAudio.playTick(vel),
    (landedIdx) => {
      const remaining = getRemainingTeams();
      if (remaining.length > 0 && landedIdx >= 0) {
        state.selectedTeam = remaining[landedIdx];
        state.gameState = 'TEAM_SELECTED';
        triggerAudio.playWhistle();
        saveState();
        
        // Open the dramatic FUT Modal reveal after a slight delay
        setTimeout(() => {
          showRevealModal(state.selectedPlayer, state.selectedTeam);
        }, 300);
      }
    }
  );
  
  // Bind Action Buttons
  const btnSpinPlayer = document.getElementById('btn-spin-player');
  btnSpinPlayer.addEventListener('click', () => {
    if (getAvailablePlayers().length === 0) {
      alert("All draft quotas filled!");
      return;
    }
    state.gameState = 'SPINNING_PLAYER';
    updateUIForState();
    playerWheel.spin();
  });
  
  const btnSpinTeam = document.getElementById('btn-spin-team');
  btnSpinTeam.addEventListener('click', () => {
    if (getRemainingTeams().length === 0) {
      alert("No remaining teams in the draft pool!");
      return;
    }
    state.gameState = 'SPINNING_TEAM';
    updateUIForState();
    teamWheel.spin();
  });
  
  // Canvas Click To Spin support
  document.getElementById('player-wheel').addEventListener('click', () => {
    if (state.gameState === 'SELECTING_PLAYER') {
      btnSpinPlayer.click();
    }
  });
  
  document.getElementById('team-wheel').addEventListener('click', () => {
    if (state.gameState === 'PLAYER_SELECTED') {
      btnSpinTeam.click();
    }
  });
  
  // Add Player handling
  const addPlayerForm = document.getElementById('add-player-form');
  addPlayerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('new-player-name');
    const name = nameInput.value.trim();
    if (!name) return;
    
    if (state.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert("Player already exists!");
      return;
    }
    
    state.players.push({ name, maxDrafts: getDefaultMaxDrafts() });
    nameInput.value = '';
    saveState();
    initApp();
  });
  
  // Reset Draft handling
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm("Reset the World Cup Draft? This clears all assignments!")) {
      const defaultPlayersList = (typeof INITIAL_PLAYERS !== 'undefined') ? INITIAL_PLAYERS : ["Ross", "Brad", "Tav", "Saunders", "Matt", "Albury", "Mook", "Boob"];
      state.players = defaultPlayersList.map(name => ({ name, maxDrafts: getDefaultMaxDrafts() }));
      state.draftResults = [];
      state.gameState = 'SELECTING_PLAYER';
      state.selectedPlayer = null;
      state.selectedTeam = null;
      saveState();
      initApp();
    }
  });
  
  // Mute Toggle handling
  document.getElementById('btn-mute').addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    saveState();
    updateMuteStateUI();
  });
  
  // Export JSON
  document.getElementById('btn-export').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", "wc_2026_draft_results.json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
  });
  
  // Import JSON
  const btnImportTrigger = document.getElementById('btn-import-trigger');
  const btnImport = document.getElementById('btn-import');
  btnImportTrigger.addEventListener('click', () => btnImport.click());
  btnImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported && Array.isArray(imported.players) && Array.isArray(imported.draftResults)) {
          state = {
            players: imported.players,
            draftResults: imported.draftResults,
            gameState: imported.gameState || 'SELECTING_PLAYER',
            selectedPlayer: imported.selectedPlayer || null,
            selectedTeam: imported.selectedTeam || null,
            isMuted: imported.isMuted || false,
            spinDuration: imported.spinDuration !== undefined ? imported.spinDuration : 6.0,
            spinSpeedFactor: imported.spinSpeedFactor !== undefined ? imported.spinSpeedFactor : 1.0
          };
          saveState();
          updateMuteStateUI();
          initApp();
          alert("Import successful!");
        } else {
          alert("JSON format is incorrect!");
        }
      } catch (err) {
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
  });
  
  // Claim Reveal draft pick
  document.getElementById('btn-reveal-claim').addEventListener('click', () => {
    const draftId = 'draft_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    state.draftResults.push({
      id: draftId,
      player: state.selectedPlayer,
      team: state.selectedTeam,
      timestamp: Date.now()
    });
    
    // Animate Modal close
    const modal = document.getElementById('reveal-modal');
    const cardContainer = document.getElementById('reveal-card-container');
    modal.classList.add('opacity-0', 'pointer-events-none');
    cardContainer.classList.remove('scale-100');
    cardContainer.classList.add('scale-50');
    
    state.gameState = 'SELECTING_PLAYER';
    state.selectedPlayer = null;
    state.selectedTeam = null;
    
    saveState();
    initApp();

    // Auto-show summary board when the last team is claimed
    const draftedCount = state.draftResults.length;
    const totalMax = state.players.reduce((sum, p) => sum + p.maxDrafts, 0);
    if (draftedCount > 0 && draftedCount === totalMax) {
      setTimeout(() => {
        showSummaryModal();
      }, 800);
    }
  });
  
  // Search Filter Grid typing
  document.getElementById('search-teams').addEventListener('input', () => {
    renderRemainingTeams();
  });
  
  // Bind Spin Settings range sliders
  const sliderDuration = document.getElementById('spin-duration');
  const sliderSpeed = document.getElementById('spin-speed');
  const valDuration = document.getElementById('duration-val');
  const valSpeed = document.getElementById('speed-val');
  
  if (sliderDuration && sliderSpeed) {
    sliderDuration.value = state.spinDuration;
    valDuration.innerText = state.spinDuration.toFixed(1) + 's';
    
    sliderSpeed.value = state.spinSpeedFactor;
    valSpeed.innerText = state.spinSpeedFactor.toFixed(1) + 'x';
    
    sliderDuration.addEventListener('input', (e) => {
      state.spinDuration = parseFloat(e.target.value);
      valDuration.innerText = state.spinDuration.toFixed(1) + 's';
      saveState();
    });
    
    sliderSpeed.addEventListener('input', (e) => {
      state.spinSpeedFactor = parseFloat(e.target.value);
      valSpeed.innerText = state.spinSpeedFactor.toFixed(1) + 'x';
      saveState();
    });
  }

  // Bind Worker Sync controls
  const btnSyncNow = document.getElementById('btn-sync-now');
  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', () => {
      pushToCloud(); // Push local state to cloud database
    });
  }

  // Bind Summary Modal controls
  const btnSummaryTrigger = document.getElementById('btn-summary-trigger');
  const btnSummaryClose = document.getElementById('btn-summary-close');
  const btnSummaryExport = document.getElementById('btn-summary-export');
  const btnSummaryReset = document.getElementById('btn-summary-reset');

  if (btnSummaryTrigger) {
    btnSummaryTrigger.addEventListener('click', () => {
      showSummaryModal();
    });
  }

  if (btnSummaryClose) {
    btnSummaryClose.addEventListener('click', () => {
      closeSummaryModal();
    });
  }

  if (btnSummaryExport) {
    btnSummaryExport.addEventListener('click', () => {
      document.getElementById('btn-export').click();
    });
  }

  if (btnSummaryReset) {
    btnSummaryReset.addEventListener('click', () => {
      document.getElementById('btn-reset').click();
    });
  }
  
  // Run Main Initializer
  initApp();
});
