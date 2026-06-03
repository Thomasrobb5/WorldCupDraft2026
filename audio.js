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
function playTick(volume = 0.5, rate = 1.0) {
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
 * Synthesizes a realistic referee pea whistle.
 * Uses two high-frequency oscillators at 2000Hz and 2200Hz,
 * modulated with a low-frequency tremolo and vibrato.
 */
function playWhistle() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  try {
    const now = ctx.currentTime;
    
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const oscGain1 = ctx.createGain();
    const oscGain2 = ctx.createGain();
    const mainGain = ctx.createGain();
    
    // LFO (Low-Frequency Oscillator) to simulate the pea flutter
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(24, now); // ~24Hz flutter
    lfoGain.gain.setValueAtTime(0.3, now);  // depth of tremolo amplitude modulation
    
    // Connect LFO to modulate oscillator gains (tremolo)
    lfo.connect(lfoGain);
    lfoGain.connect(oscGain1.gain);
    lfoGain.connect(oscGain2.gain);
    
    // Connect LFO to modulate oscillator frequencies (vibrato) for realism
    const lfoFreqGain = ctx.createGain();
    lfoFreqGain.gain.setValueAtTime(50, now); // ±50Hz frequency wobble
    lfo.connect(lfoFreqGain);
    lfoFreqGain.connect(osc1.frequency);
    lfoFreqGain.connect(osc2.frequency);
    
    // Tone 1: 2000Hz
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(2000, now);
    oscGain1.gain.setValueAtTime(0.4, now);
    
    // Tone 2: 2200Hz
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2200, now);
    oscGain2.gain.setValueAtTime(0.4, now);
    
    // Connections
    osc1.connect(oscGain1);
    osc2.connect(oscGain2);
    
    oscGain1.connect(mainGain);
    oscGain2.connect(mainGain);
    
    // Highpass filter to remove low-frequency rumble and LFO bleed
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1000, now);
    
    mainGain.connect(filter);
    filter.connect(ctx.destination);
    
    // Volume Envelope: short, punchy decay
    const duration = 0.6; // total duration
    mainGain.gain.setValueAtTime(0.0, now);
    mainGain.gain.linearRampToValueAtTime(0.8, now + 0.015); // Fast attack
    mainGain.gain.setValueAtTime(0.8, now + 0.15); // Brief sustain
    mainGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    
    // Start and stop all active sound sources
    lfo.start(now);
    osc1.start(now);
    osc2.start(now);
    
    lfo.stop(now + duration);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  } catch (e) {
    console.error("Error playing whistle sound:", e);
  }
}

/**
 * Synthesizes a stadium crowd cheer.
 * Generates brown and white noise, passes them through parallel dynamic bandpass filters 
 * with center frequencies that sweep upwards to mimic a swell of excitement, and fades out.
 */
function playCheer() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state === 'suspended') return;

  try {
    const now = ctx.currentTime;
    const duration = 3.0; // 3 seconds crowd cheer
    const sampleRate = ctx.sampleRate;
    const bufferSize = sampleRate * duration;
    
    // 1. Generate Brown Noise for rumble/roar
    const brownBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const brownData = brownBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      brownData[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = brownData[i];
      brownData[i] *= 3.5; // Compensate for volume loss
    }
    
    // 2. Generate White Noise for high-frequency excitement
    const whiteBuffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const whiteData = whiteBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      whiteData[i] = Math.random() * 2 - 1;
    }
    
    // 3. Create buffer sources
    const brownSource = ctx.createBufferSource();
    brownSource.buffer = brownBuffer;
    
    const whiteSource = ctx.createBufferSource();
    whiteSource.buffer = whiteBuffer;
    
    // 4. Dynamic bandpass filters for brown noise (low-mid roar)
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.Q.setValueAtTime(1.5, now);
    bp1.frequency.setValueAtTime(250, now);
    bp1.frequency.exponentialRampToValueAtTime(550, now + 0.6); // swell
    bp1.frequency.exponentialRampToValueAtTime(200, now + duration); // decay
    
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.setValueAtTime(2.0, now);
    bp2.frequency.setValueAtTime(400, now);
    bp2.frequency.exponentialRampToValueAtTime(900, now + 0.5); // swell
    bp2.frequency.exponentialRampToValueAtTime(300, now + duration); // decay
    
    // 5. Dynamic bandpass filters for white noise (high cheer/screaming/sibilance)
    const bp3 = ctx.createBiquadFilter();
    bp3.type = 'bandpass';
    bp3.Q.setValueAtTime(1.0, now);
    bp3.frequency.setValueAtTime(800, now);
    bp3.frequency.exponentialRampToValueAtTime(2000, now + 0.7); // swell
    bp3.frequency.exponentialRampToValueAtTime(700, now + duration); // decay
    
    const bp4 = ctx.createBiquadFilter();
    bp4.type = 'bandpass';
    bp4.Q.setValueAtTime(1.2, now);
    bp4.frequency.setValueAtTime(1200, now);
    bp4.frequency.exponentialRampToValueAtTime(2800, now + 0.6); // swell
    bp4.frequency.exponentialRampToValueAtTime(900, now + duration); // decay
    
    // 6. Sub-gains for mixing
    const brownGain = ctx.createGain();
    brownGain.gain.setValueAtTime(0.7, now);
    
    const whiteGain = ctx.createGain();
    whiteGain.gain.setValueAtTime(0.25, now);
    
    // Connections: source -> filter -> mix gains
    brownSource.connect(bp1);
    brownSource.connect(bp2);
    whiteSource.connect(bp3);
    whiteSource.connect(bp4);
    
    bp1.connect(brownGain);
    bp2.connect(brownGain);
    bp3.connect(whiteGain);
    bp4.connect(whiteGain);
    
    // 7. Mix gains -> Main output gain
    const mainGain = ctx.createGain();
    brownGain.connect(mainGain);
    whiteGain.connect(mainGain);
    mainGain.connect(ctx.destination);
    
    // Main swell and fade envelope
    mainGain.gain.setValueAtTime(0.0, now);
    mainGain.gain.linearRampToValueAtTime(0.9, now + 0.7); // Swell
    mainGain.gain.setValueAtTime(0.9, now + 1.0); // Sustain
    mainGain.gain.exponentialRampToValueAtTime(0.0001, now + duration); // Fade
    
    // Start and stop sources
    brownSource.start(now);
    whiteSource.start(now);
    
    brownSource.stop(now + duration);
    whiteSource.stop(now + duration);
  } catch (e) {
    console.error("Error playing crowd cheer sound:", e);
  }
}

// Global browser script registration to align with app.js trigger structure
window.audioController = {
  initAudio,
  playTick,
  playWhistle,
  playCheer
};
