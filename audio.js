/**
 * World Cup Draft Wheel - Audio Synthesis Module
 * 
 * Synthesizes premium sound effects using the browser's Web Audio API.
 * No external file assets are required.
 */

let audioCtx = null;

/**
 * Initializes or resumes the Web Audio API AudioContext.
 * Must be triggered by a user interaction (click, touch) to bypass browser autoplay restrictions.
 * @returns {AudioContext|null} The active AudioContext, or null if unsupported.
 */
function initAudio() {
  if (typeof window === 'undefined') return null;

  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("Web Audio API is not supported in this browser.");
      return null;
    }
    try {
      audioCtx = new AudioContextClass();
    } catch (e) {
      console.error("Failed to initialize AudioContext:", e);
      return null;
    }
  }

  // Attempt to resume if suspended (standard browser security posture)
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(e => {
      console.warn("Failed to resume AudioContext:", e);
    });
  }

  return audioCtx;
}

/**
 * Safely retrieves the AudioContext and ensures it's initialized.
 * @returns {AudioContext|null}
 */
function getAudioContext() {
  if (!audioCtx) {
    initAudio();
  }
  return audioCtx;
}

/**
 * Synthesizes a wood-block or plastic-card click sound.
 * Pitch and volume are modulated based on the wheel's spin speed.
 * 
 * @param {number} volume - Output volume (0.0 to 1.0).
 * @param {number} rate - Speed/rate factor determining frequency scale and decay (0.2 to 3.0).
 */
function playTick(volume = 0.15, rate = 1.0) {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  try {
    const now = ctx.currentTime;
    
    // Clamp inputs for safety
    const vol = Math.max(0, Math.min(1, volume));
    const pitchFactor = Math.max(0.2, Math.min(3.0, rate));
    
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    // Base frequency for wood-block/plastic peg click
    const baseFreq = 800; 
    const targetFreq = baseFreq * pitchFactor;
    
    osc.type = 'triangle';
    
    // Downward pitch sweep creates a sharper click transient
    osc.frequency.setValueAtTime(targetFreq * 2.0, now);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.015);
    
    // Add bandpass filter to give hollow, resonant wood-block qualities
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(targetFreq, now);
    filter.Q.setValueAtTime(4.0, now);
    
    // Dynamic decay: faster spinning (higher rate) = shorter click
    const decayDuration = 0.04 / pitchFactor;
    const clampedDecay = Math.max(0.01, Math.min(0.08, decayDuration));
    
    gainNode.gain.setValueAtTime(vol, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + clampedDecay);
    
    // Connections: Osc -> Filter -> Gain -> Destination
    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + clampedDecay + 0.01);
  } catch (e) {
    console.error("Error playing tick sound:", e);
  }
}

/**
 * Synthesizes a clean, subtle chime sound.
 * Plays when the wheel lands on an item (replaces the harsh referee whistle).
 */
function playWhistle() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    // High-quality sine wave chime ping
    osc.type = 'sine';
    osc.frequency.setValueAtTime(987.77, now); // B5 note (clean ring)
    osc.frequency.exponentialRampToValueAtTime(493.88, now + 0.15); // soft pitch slide to B4
    
    // Volume Envelope: very soft, quick attack, smooth decay
    gainNode.gain.setValueAtTime(0.0, now);
    gainNode.gain.linearRampToValueAtTime(0.12, now + 0.005); // Attack
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.25); // Decay
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.26);
  } catch (e) {
    console.error("Error playing landing chime:", e);
  }
}

/**
 * Synthesizes a warm, rising Major 7th chord arpeggio chime.
 * Plays when the picked team is revealed in the modal (replaces the loud crowd cheer).
 */
function playCheer() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  try {
    const now = ctx.currentTime;
    // F Major 7th chord arpeggio: F5 (698.46Hz), A5 (880.00Hz), C6 (1046.50Hz), E6 (1318.51Hz)
    const notes = [698.46, 880.00, 1046.50, 1318.51];
    
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06); // 60ms stagger for arpeggio arpeggiation
      
      // Volume Envelope: very quiet peak volume, clean decay
      gainNode.gain.setValueAtTime(0.0, now + idx * 0.06);
      gainNode.gain.linearRampToValueAtTime(0.06, now + idx * 0.06 + 0.015); // Quiet peak (0.06 gain)
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.06 + 0.7); // 700ms decay
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.75);
    });
  } catch (e) {
    console.error("Error playing success chime arpeggio:", e);
  }
}

// Global browser script registration to align with app.js trigger structure
window.audioController = {
  initAudio,
  playTick,
  playWhistle,
  playCheer
};
