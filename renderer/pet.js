(function () {
  const canvas = document.getElementById('petCanvas');
  const ctx = canvas.getContext('2d');
  const petAreaEl = document.getElementById('petArea');
  const statusEl = document.getElementById('status');
  const statusLabelEl = document.getElementById('statusLabel');
  const statusDetailEl = document.getElementById('statusDetail');
  const statusToggleEl = document.getElementById('statusToggle');
  const api = window.petAPI;
  const { advanceFrame, shouldPreserveFrame, framePathsForMode } = window.PetAnimationLoop;
  const ASSET = './assets/race-crab/';

  /**
   * Playback behaviour per state. fps is a fallback only — loadAnimations
   * prefers the pack's own fps:
   *   fluid  → ~24fps Imagine smooth packs
   *   static → classic sprite packs (~2–10fps, working ~8–9fps)
   */
  const MOTION = {
    idle:     { fps: 3, holdMin: 0, holdMax: 0, playChance: 1.0, static: false, alwaysPlay: true },
    thinking: { fps: 2.5, holdMin: 0, holdMax: 0, playChance: 1.0, static: false, alwaysPlay: true },
    working:  { fps: 9, holdMin: 0, holdMax: 0, playChance: 1.0, static: false, alwaysPlay: true },
    done:     { fps: 6, holdMin: 0.2, holdMax: 0.4, playChance: 1.0, static: false },
    alert:    { fps: 4, holdMin: 0, holdMax: 0, playChance: 1.0, static: false, alwaysPlay: true },
    sleep:    { fps: 1.5, holdMin: 0, holdMax: 0, playChance: 1.0, static: false, alwaysPlay: true },
    wake:     { fps: 5, holdMin: 99, holdMax: 99, playChance: 1.0, static: false },
    // Local click ack (not driven by Grok hooks)
    click:    { fps: 10, holdMin: 99, holdMax: 99, playChance: 1.0, static: false },
  };

  const CLICK_MS_FALLBACK = 520;
  const DRAG_THRESHOLD_PX = 6;
  /**
   * Extra idle bob on top of baked animation motion — kept subtle so fluid
   * Imagine clips don't feel double-animated. Static packs already animate.
   */
  const IDLE_BOB_HZ = 0.4;
  const IDLE_BOB_PX = 1.8;
  const IDLE_BOB_SCALE = 0.008;

  /** @type {Record<string, {frames: HTMLImageElement[], loop: boolean, loopMode: string, fps: number}>} */
  let anims = {};
  let current = 'idle';
  let frameIndex = 0;
  let frameDirection = 1;
  let frameAcc = 0;
  let lastTs = performance.now();
  let celebrateTimer = null;
  let wakeTimer = null;
  let alertTimer = null;
  let clickTimer = null;
  const ALERT_SETTLE_MS = 4000;
  let celebrateMs = 1800;
  let wakeMs = 900;
  let dragging = false;
  let dragMoved = false;
  let overPet = false;
  /** True while pointer is over the pet body or the status chevron chrome. */
  let overChrome = false;
  let pointerDown = false;
  let statusToggleBusy = false;
  let downX = 0;
  let downY = 0;
  let downAt = 0;
  /** State to restore after local click ack (harness states still win via onState). */
  let preClickState = 'idle';
  let clickAnimGen = 0;
  let clickPulse = 0; // 0..1 bounce while acknowledging click
  /**
   * When true (dashboard manual lock), one-shot states (wake/done/click)
   * loop/hold instead of auto-returning to idle.
   */
  let stickyHold = false;
  let muted = false;
  /** Show liquid-glass status bubble under the pet (pref, default on). */
  let showStatus = true;
  /**
   * Latest activity detail from hooks (logical value).
   * Display is throttled so the line stays readable.
   */
  let lastDetail = '';
  /** Currently shown activity line (may lag lastDetail during hold). */
  let displayedDetail = '';
  /** Newest detail waiting until the hold window expires. */
  let pendingDetail = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let detailHoldTimer = null;
  /** Minimum time each activity line stays put so it can be read. */
  const DETAIL_HOLD_MS = 6000;
  /** User preference from dashboard: fluid (24fps) | static (classic ~9fps packs) */
  let animationMode = 'fluid';
  /**
   * Currently loaded frame pack mode (matches animationMode once packs load).
   * @type {'fluid' | 'static' | null}
   */
  let loadedPackMode = null;
  let packLoadGen = 0;
  /** @type {AudioContext|null} */
  let audioCtx = null;

  // Hold / occasional play machine
  let mode = 'hold'; // 'hold' | 'play'
  let holdLeft = 2;
  let playOnce = false;

  // ─── Fun SFX (Web Audio synth — no asset files; respects mute) ───
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function tone(ctx, {
    type = 'sine',
    freq = 440,
    freqEnd = null,
    start = 0,
    dur = 0.15,
    gain = 0.12,
    attack = 0.01,
    release = 0.08,
  }) {
    const t0 = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(attack + 0.02, dur - release));
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Playful ascending whoop for WEEEE click. */
  function playWeeeSound() {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    // Main whoop up
    tone(ctx, { type: 'sine', freq: 320, freqEnd: 980, start: 0, dur: 0.22, gain: 0.14, attack: 0.008, release: 0.06 });
    tone(ctx, { type: 'triangle', freq: 480, freqEnd: 1400, start: 0.02, dur: 0.18, gain: 0.06, attack: 0.01, release: 0.05 });
    // Tiny sparkle blips
    tone(ctx, { type: 'sine', freq: 1200, start: 0.12, dur: 0.06, gain: 0.05, attack: 0.005, release: 0.04 });
    tone(ctx, { type: 'sine', freq: 1600, start: 0.18, dur: 0.07, gain: 0.04, attack: 0.005, release: 0.04 });
  }

  /** Cheerful arpeggio when the model finishes (done). */
  function playDoneSound() {
    if (muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    // C5 → E5 → G5 → C6 sparkle fanfare
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      tone(ctx, {
        type: 'sine',
        freq: f,
        start: i * 0.07,
        dur: 0.18,
        gain: 0.11 - i * 0.012,
        attack: 0.008,
        release: 0.1,
      });
      tone(ctx, {
        type: 'triangle',
        freq: f * 2,
        start: i * 0.07 + 0.01,
        dur: 0.1,
        gain: 0.03,
        attack: 0.005,
        release: 0.06,
      });
    });
    // Soft landing chime
    tone(ctx, { type: 'sine', freq: 784, freqEnd: 523, start: 0.32, dur: 0.28, gain: 0.07, attack: 0.01, release: 0.14 });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('load failed: ' + src));
      img.src = src;
    });
  }

  function profile(state) {
    const base = Object.assign({}, MOTION[state] || MOTION.idle);
    const anim = anims[state];
    if (anim && typeof anim.fps === 'number' && anim.fps > 0) {
      base.fps = anim.fps;
    }
    return base;
  }

  /** Duration (ms) to play a one-shot animation once at its fps. */
  function onceDurationMs(state, fallbackMs) {
    const anim = anims[state];
    const p = profile(state);
    if (anim && anim.frames && anim.frames.length && p.fps > 0) {
      return Math.max(fallbackMs, Math.round((anim.frames.length / p.fps) * 1000));
    }
    return fallbackMs;
  }

  function scheduleHold(state) {
    const p = profile(state);
    holdLeft = p.holdMin + Math.random() * (p.holdMax - p.holdMin);
    mode = 'hold';
    frameIndex = 0;
    frameDirection = 1;
    frameAcc = 0;
  }

  async function resolveAssetSrc(rel) {
    let src = ASSET + rel;
    if (api && api.assetPath) {
      try { src = await api.assetPath(rel); } catch (_) { src = ASSET + rel; }
    }
    return src;
  }

  /** Active pack mode from the dashboard toggle (not overridden by manual lock). */
  function desiredPackMode() {
    return animationMode === 'static' ? 'static' : 'fluid';
  }

  /**
   * Load frame packs for the selected animation mode.
   * fluid  → animations.json + frames/ (24fps smooth)
   * static → animations-static.json + frames-static/ (classic low-fps sprites)
   * @param {'fluid' | 'static'} [mode]
   */
  async function loadAnimations(mode = desiredPackMode()) {
    const packMode = mode === 'static' ? 'static' : 'fluid';
    let meta = null;
    if (api && api.getAnimations) {
      meta = await api.getAnimations(packMode);
    }
    if (!meta) {
      const file =
        packMode === 'static' ? 'animations-static.json' : 'animations.json';
      try {
        const res = await fetch(ASSET + file);
        if (res.ok) meta = await res.json();
      } catch (_) { /* try fluid fallback below */ }
      if (!meta && packMode === 'static') {
        const res = await fetch(ASSET + 'animations.json');
        if (!res.ok) throw new Error('animations.json missing');
        meta = await res.json();
      } else if (!meta) {
        throw new Error('animations.json missing');
      }
    }
    const defaultFps =
      typeof meta.fpsDefault === 'number'
        ? meta.fpsDefault
        : packMode === 'static'
          ? 8
          : 24;
    const out = {};
    for (const [state, def] of Object.entries(meta.animations || {})) {
      // Manifest already points at frames/ or frames-static/; use as-is.
      const list = framePathsForMode(state, def.frames, packMode, def.frames);
      if (!list.length) continue;
      const frames = await Promise.all(
        list.map(async (rel) => loadImage(await resolveAssetSrc(rel)))
      );
      const fps = typeof def.fps === 'number' && def.fps > 0
        ? def.fps
        : (MOTION[state] && MOTION[state].fps) || defaultFps;
      out[state] = {
        frames,
        loop: def.loop !== false,
        // Classic static packs are short pose cycles — restart reads well;
        // fluid packs prefer ping-pong for seamless long loops.
        loopMode:
          def.loopMode ||
          (packMode === 'static'
            ? 'restart'
            : def.loop !== false
              ? 'pingpong'
              : 'restart'),
        fps,
      };
    }
    if (!out.wake && out.idle) {
      out.wake = { frames: out.idle.frames.slice(), loop: false, loopMode: 'restart', fps: out.idle.fps };
    }
    if (!out.idle && out.thinking) out.idle = out.thinking;
    // Click ack: reuse alert/wake/idle frames if theme has no dedicated click anim
    if (!out.click) {
      const frames = [];
      if (out.alert && out.alert.frames[0]) frames.push(out.alert.frames[0]);
      if (out.alert && out.alert.frames[1]) frames.push(out.alert.frames[1]);
      if (out.wake && out.wake.frames[0]) frames.push(out.wake.frames[0]);
      if (out.idle && out.idle.frames[0]) frames.push(out.idle.frames[0]);
      if (frames.length) {
        out.click = {
          frames,
          loop: false,
          loopMode: 'restart',
          fps: (MOTION.click && MOTION.click.fps) || 10,
        };
      }
    }
    return out;
  }

  /**
   * Ensure loaded packs match the fluid/static preference.
   * @returns {Promise<boolean>} true if packs were reloaded
   */
  async function ensureAnimationPacks() {
    const want = desiredPackMode();
    if (loadedPackMode === want && anims && Object.keys(anims).length) {
      return false;
    }
    const gen = ++packLoadGen;
    const next = await loadAnimations(want);
    if (gen !== packLoadGen) return false;
    anims = next;
    loadedPackMode = want;
    return true;
  }

  const STATUS_LABELS = {
    click: 'WEEEE',
  };

  function applyShowStatus(visible) {
    showStatus = !!visible;
    if (statusEl) statusEl.classList.toggle('hidden', !showStatus);
    if (statusToggleEl) {
      statusToggleEl.classList.toggle('status-on', showStatus);
      statusToggleEl.setAttribute('aria-pressed', showStatus ? 'true' : 'false');
      statusToggleEl.setAttribute(
        'aria-label',
        showStatus ? 'Hide status bubble' : 'Show status bubble'
      );
      statusToggleEl.title = showStatus ? 'Hide status' : 'Show status';
    }
  }

  function setStatusToggleVisible(visible) {
    if (!statusToggleEl) return;
    statusToggleEl.classList.toggle('visible', !!visible);
  }

  /**
   * Hit-test the hover chevron (with a little padding for easy targeting).
   * @param {number} clientX
   * @param {number} clientY
   */
  function hitTestToggle(clientX, clientY) {
    if (!statusToggleEl) return false;
    const r = statusToggleEl.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const pad = 6;
    return (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    );
  }

  /**
   * Hit-test the liquid-glass status bubble when it is visible.
   * @param {number} clientX
   * @param {number} clientY
   */
  function hitTestStatus(clientX, clientY) {
    if (!showStatus || !statusEl || statusEl.classList.contains('hidden')) return false;
    const r = statusEl.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const pad = 6;
    return (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    );
  }

  /**
   * Soft corridor from the lower pet area down through the chevron to the
   * status bubble — keeps chrome hot while moving between them.
   * @param {number} clientX
   * @param {number} clientY
   */
  function hitTestStatusBridge(clientX, clientY) {
    if (!showStatus || !statusEl || statusEl.classList.contains('hidden')) return false;
    if (!petAreaEl) return hitTestStatus(clientX, clientY);
    const petR = petAreaEl.getBoundingClientRect();
    const stR = statusEl.getBoundingClientRect();
    if (petR.width < 1 || stR.width < 1) return false;
    const top = petR.top + petR.height * 0.52;
    const bottom = Math.max(stR.bottom, petR.bottom) + 6;
    const left = Math.min(petR.left + petR.width * 0.22, stR.left - 8);
    const right = Math.max(petR.right - petR.width * 0.22, stR.right + 8);
    return (
      clientX >= left &&
      clientX <= right &&
      clientY >= top &&
      clientY <= bottom
    );
  }

  async function toggleStatusBubble() {
    if (statusToggleBusy) return;
    statusToggleBusy = true;
    const next = !showStatus;
    // Optimistic UI — window height catches up via prefs IPC
    applyShowStatus(next);
    setStatus(current || 'idle', lastDetail);
    try {
      if (api && api.setShowStatus) {
        const result = await api.setShowStatus(next);
        if (result && typeof result.showStatus === 'boolean') {
          applyShowStatus(result.showStatus);
          setStatus(current || 'idle', lastDetail);
        }
      }
    } catch (err) {
      console.warn('[status toggle]', err);
      applyShowStatus(!next);
      setStatus(current || 'idle', lastDetail);
    } finally {
      statusToggleBusy = false;
    }
  }

  const STATE_DETAIL_DEFAULTS = {
    thinking: 'Thinking it through…',
    working: 'Getting things done…',
    done: 'All done!',
    alert: 'Needs your attention',
  };

  function paintDetailLine(text) {
    displayedDetail = text || '';
    if (!statusDetailEl) return;
    if (displayedDetail) {
      statusDetailEl.textContent = displayedDetail;
      statusDetailEl.classList.add('has-detail');
    } else {
      statusDetailEl.textContent = '';
      statusDetailEl.classList.remove('has-detail');
    }
  }

  function clearDetailHoldTimer() {
    if (detailHoldTimer) {
      clearTimeout(detailHoldTimer);
      detailHoldTimer = null;
    }
  }

  function armDetailHold() {
    clearDetailHoldTimer();
    detailHoldTimer = setTimeout(() => {
      detailHoldTimer = null;
      // Promote the newest queued line (or keep current if none pending)
      if (pendingDetail !== null) {
        const next = pendingDetail;
        pendingDetail = null;
        if (next !== displayedDetail) {
          paintDetailLine(next);
          lastDetail = next;
          if (next) armDetailHold();
          return;
        }
      }
      // Hold window finished with no newer line — keep showing current text
      // until a state transition clears it (idle/sleep) or a new detail arrives.
    }, DETAIL_HOLD_MS);
  }

  /**
   * Show an activity line, holding each one long enough to read.
   * Rapid tool churn is coalesced: only the latest line wins after the hold.
   * @param {string} detail
   * @param {{ force?: boolean }} [opts] force bypasses hold (idle clear, done, etc.)
   */
  function presentDetail(detail, opts = {}) {
    const next = String(detail || '').trim();
    const force = !!opts.force;

    if (force) {
      clearDetailHoldTimer();
      pendingDetail = null;
      lastDetail = next;
      paintDetailLine(next);
      // Done / alert still get a readable hold before idle clears them
      if (next) armDetailHold();
      return;
    }

    // Empty updates during an active agent turn shouldn't wipe a good line
    if (!next) {
      if (displayedDetail) return;
      lastDetail = '';
      paintDetailLine('');
      return;
    }

    lastDetail = next;
    if (!displayedDetail || displayedDetail === next) {
      if (displayedDetail !== next) paintDetailLine(next);
      if (!detailHoldTimer) armDetailHold();
      return;
    }

    // Hold still active — queue and keep the current readable line
    if (detailHoldTimer) {
      pendingDetail = next;
      return;
    }
    paintDetailLine(next);
    armDetailHold();
  }

  /**
   * Update the liquid-glass status bubble.
   * @param {string} text state name
   * @param {string} [detail] optional activity line
   */
  function setStatus(text, detail) {
    if (!statusEl) return;
    const key = String(text || '').toLowerCase();
    const label = STATUS_LABELS[key] || text;
    if (statusLabelEl) statusLabelEl.textContent = label;
    else statusEl.textContent = label;

    const settleStates = key === 'idle' || key === 'sleep' || key === 'wake' || key === 'click';
    const forceStates = settleStates || key === 'done' || key === 'alert';

    if (typeof detail === 'string') {
      const trimmed = detail.trim();
      if (settleStates) {
        presentDetail('', { force: true });
      } else if (trimmed) {
        presentDetail(trimmed, { force: forceStates && (key === 'done' || key === 'alert') });
      } else if (STATE_DETAIL_DEFAULTS[key]) {
        presentDetail(STATE_DETAIL_DEFAULTS[key], { force: key === 'done' || key === 'alert' });
      } else if (!settleStates) {
        // Keep held line during empty working/thinking posts
        presentDetail(displayedDetail || lastDetail || STATE_DETAIL_DEFAULTS[key] || '');
      }
    } else if (settleStates) {
      presentDetail('', { force: true });
    } else if (STATE_DETAIL_DEFAULTS[key] && !displayedDetail && !lastDetail) {
      presentDetail(STATE_DETAIL_DEFAULTS[key]);
    }

    statusEl.className = 'st-' + key + (showStatus ? '' : ' hidden');
    // Only flash the chip on state label changes, not every detail refresh
    statusEl.classList.add('flash');
    void statusEl.offsetWidth;
    setTimeout(() => statusEl.classList.remove('flash'), 200);
  }

  function setState(next, options = {}) {
    if (!next) return;
    next = String(next).toLowerCase();
    // sticky: true from dashboard manual lock; sticky: false clears it.
    // Omit sticky (hook / internal transitions) to leave the flag alone unless
    // this is a normal auto payload that should exit sticky — handled by
    // releaseStickyHold() and by explicit sticky:false.
    if (typeof options.sticky === 'boolean') {
      stickyHold = options.sticky;
    }

    // Detail can update even when the animation frame is preserved (held in setStatus)
    if (Object.prototype.hasOwnProperty.call(options, 'detail')) {
      lastDetail = options.detail == null ? '' : String(options.detail).trim();
    } else if (STATE_DETAIL_DEFAULTS[next] && !lastDetail) {
      lastDetail = STATE_DETAIL_DEFAULTS[next];
    }

    // If fluid/static packs are still loading (mode toggle), wait then re-apply.
    if (desiredPackMode() !== loadedPackMode) {
      const pending = { next, options: Object.assign({}, options, { sticky: stickyHold, force: true }) };
      ensureAnimationPacks()
        .then(() => setState(pending.next, pending.options))
        .catch((err) => console.error('[anim packs]', err));
      return;
    }

    // Repeated hook events for a continuous state are status updates, not
    // animation restarts. Preserve the current frame and playback direction
    // (ping-pong smoothing). Only force a restart for one-shot manual locks
    // so WEEEE / done SFX can replay — never for continuous loops.
    const activeAnim = anims[next];
    const oneShot =
      next === 'wake' || next === 'done' || next === 'click';
    const alreadyPlaying = shouldPreserveFrame({
      force: options.force || (options.sticky === true && oneShot),
      next,
      current,
      loop: activeAnim && activeAnim.loop,
      alwaysPlay: profile(next).alwaysPlay || (stickyHold && !oneShot),
      mode,
      playOnce,
    });
    if (alreadyPlaying) {
      // Still refresh the glass bubble so tool churn shows up mid-working.
      setStatus(next, lastDetail);
      return;
    }

    // Harness / external states cancel a local click ack
    if (next !== 'click') {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      clickPulse = 0;
    }

    if (celebrateTimer) { clearTimeout(celebrateTimer); celebrateTimer = null; }
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
    if (alertTimer) { clearTimeout(alertTimer); alertTimer = null; }

    if (next === 'wake') {
      applyState('wake');
      if (stickyHold) {
        // Dashboard manual: keep looping the wake stretch
        mode = 'play';
        playOnce = false;
        return;
      }
      const ms = onceDurationMs('wake', wakeMs);
      wakeTimer = setTimeout(() => setState('idle'), ms);
      return;
    }
    if (next === 'done') {
      applyState('done');
      playDoneSound();
      if (stickyHold) {
        mode = 'play';
        playOnce = false;
        return;
      }
      // Play celebrate frames once, then settle — no perpetual jumping
      mode = 'play';
      playOnce = true;
      const ms = onceDurationMs('done', celebrateMs);
      celebrateTimer = setTimeout(() => setState('idle'), ms);
      return;
    }
    if (next === 'alert') {
      applyState('alert');
      if (stickyHold) {
        mode = 'play';
        playOnce = false;
        return;
      }
      // Brief attention flash, then idle — never stick on alert forever
      // (Grok Notification / PostToolUseFailure must not block sleep).
      mode = 'play';
      playOnce = false;
      alertTimer = setTimeout(() => setState('idle'), ALERT_SETTLE_MS);
      return;
    }
    if (next === 'click') {
      if (stickyHold) {
        // Dashboard WEEEE: loop the bounce instead of restoring prior state
        if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
        clickPulse = 1;
        playWeeeSound();
        applyState('click');
        mode = 'play';
        playOnce = false;
        return;
      }
      playClickAck();
      return;
    }
    applyState(next);
  }

  /**
   * Leave sticky lock when the dashboard switches back to Auto.
   * Always return to idle — a manual lock is not proof the agent is mid-turn.
   * Real hooks will re-drive thinking/working if a turn is actually running.
   */
  function releaseStickyHold() {
    stickyHold = false;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    if (celebrateTimer) { clearTimeout(celebrateTimer); celebrateTimer = null; }
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
    if (alertTimer) { clearTimeout(alertTimer); alertTimer = null; }
    clickPulse = 0;
    lastDetail = '';
    presentDetail('', { force: true });

    const settle = () => {
      // Force a clean baseline for every locked pose (working/thinking/alert/
      // wake/done/click/sleep/…). Keeping continuous agent poses here left the
      // pet stuck on "working" forever after Auto with no live hooks.
      setState('idle', { sticky: false, force: true });
    };

    if (desiredPackMode() !== loadedPackMode) {
      ensureAnimationPacks()
        .then(settle)
        .catch((err) => console.error('[anim packs]', err));
      return;
    }
    settle();
  }

  /**
   * Short local "you clicked me" animation, then restore prior state.
   * Does not go through the Grok state server.
   */
  function playClickAck() {
    if (current !== 'click') {
      preClickState =
        current === 'sleep' || current === 'wake' || current === 'done'
          ? 'idle'
          : current || 'idle';
    }
    const gen = ++clickAnimGen;
    if (clickTimer) clearTimeout(clickTimer);
    clickPulse = 1;
    playWeeeSound();
    applyState('click');
    mode = 'play';
    playOnce = true;
    const clickMs = onceDurationMs('click', CLICK_MS_FALLBACK);
    clickTimer = setTimeout(() => {
      if (gen !== clickAnimGen) return;
      clickTimer = null;
      clickPulse = 0;
      if (current === 'click') {
        applyState(preClickState && preClickState !== 'click' ? preClickState : 'idle');
      }
    }, clickMs);
  }

  function applyState(name) {
    if (!anims[name] && anims.idle) name = 'idle';
    current = name;
    // Always snap to this state's primary frame immediately so harness
    // transitions are visible.
    frameIndex = 0;
    frameDirection = 1;
    frameAcc = 0;
    const p = profile(name);
    if (p.static) {
      // Fully frozen pose (idle / sleep)
      mode = 'hold';
      holdLeft = 1e9;
      playOnce = false;
    } else if (name === 'wake' || name === 'done' || name === 'click') {
      mode = 'play';
      // Sticky manual locks loop; normal auto mode plays once
      playOnce = !stickyHold;
    } else if (p.alwaysPlay || stickyHold) {
      // Continuous loop (working / laptop typing) or dashboard hold
      mode = 'play';
      playOnce = false;
    } else {
      scheduleHold(name);
    }
    // Idle-ish poses drop the activity line (forced); agent poses keep / hold detail.
    if (name === 'idle' || name === 'sleep' || name === 'wake' || name === 'click') {
      setStatus(name, '');
    } else if (name === 'done') {
      setStatus(name, lastDetail || STATE_DETAIL_DEFAULTS.done);
    } else {
      setStatus(name, lastDetail || STATE_DETAIL_DEFAULTS[name] || '');
    }
    console.log('[pet] applied state', name, 'frames=', (anims[name] && anims[name].frames.length) || 0, 'sticky=', stickyHold, 'detail=', lastDetail || '-');
  }

  function draw(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    if (clickPulse > 0) {
      clickPulse = Math.max(0, clickPulse - dt * 2.4);
    }

    const anim = anims[current] || anims.idle;
    const p = profile(current);

    if (anim && anim.frames.length) {
      if (!p.static && mode === 'hold') {
        holdLeft -= dt;
        if (holdLeft <= 0) {
          if (p.playChance > 0 && Math.random() < p.playChance && anim.frames.length > 1) {
            mode = 'play';
            frameIndex = 0;
            frameDirection = 1;
            frameAcc = 0;
            playOnce = true;
          } else {
            scheduleHold(current);
          }
        }
      } else if (!p.static && mode === 'play') {
        // Continuous loop when alwaysPlay / sticky. Honor pack loopMode:
        // fluid packs use pingpong; classic static packs use restart (~9fps).
        // Sticky one-shots promote to the pack's loop style so locks keep moving.
        frameAcc += dt * p.fps;
        while (frameAcc >= 1) {
          frameAcc -= 1;
          const repeat = stickyHold || p.alwaysPlay || (anim.loop && !playOnce);
          const loopMode = anim.loopMode || 'restart';
          const nextFrame = advanceFrame(
            frameIndex,
            frameDirection,
            anim.frames.length,
            repeat,
            loopMode
          );
          frameIndex = nextFrame.frameIndex;
          frameDirection = nextFrame.direction;
          if (nextFrame.completed) {
            if (stickyHold) {
              // advanceFrame(repeat=true) should not complete; keep playing
              // and leave frameIndex/direction as returned (no hard reset).
              mode = 'play';
              playOnce = false;
            } else if (current === 'click') {
              // hold last click frame until click timer restores prior state
              mode = 'hold';
              holdLeft = 1e9;
            } else {
              frameIndex = 0;
              scheduleHold(current);
            }
            break;
          }
        }
      } else {
        // static: always frame 0
        frameIndex = 0;
      }

      const img = anim.frames[Math.min(frameIndex, anim.frames.length - 1)];
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Click bounce: quick squash/stretch
      const bounce =
        current === 'click' || clickPulse > 0
          ? 1 + 0.12 * Math.sin((1 - clickPulse) * Math.PI) * Math.max(clickPulse, current === 'click' ? 0.35 : 0)
          : 1;

      // Idle: soft continuous bob (subtle breathe / bounce)
      let bobY = 0;
      let idleScale = 1;
      if (current === 'idle' && clickPulse <= 0) {
        const phase = (ts / 1000) * IDLE_BOB_HZ * Math.PI * 2;
        bobY = Math.sin(phase) * IDLE_BOB_PX;
        idleScale = 1 + Math.sin(phase) * IDLE_BOB_SCALE;
      }

      // Ground shadow stays planted; shrinks slightly when pet rises
      const lift = Math.max(0, -bobY); // positive when above rest
      const shadowScale = 1 - lift * 0.025;
      ctx.save();
      ctx.fillStyle = 'rgba(10,20,40,0.16)';
      ctx.beginPath();
      ctx.ellipse(128, 238, 68 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Pet transforms: pivot near feet so bob feels grounded
      const scaleX = bounce * idleScale;
      const scaleY = (2 - bounce) * idleScale;
      ctx.save();
      ctx.translate(128, 200 + bobY);
      ctx.scale(scaleX, scaleY);
      ctx.translate(-128, -200);
      ctx.drawImage(img, 0, 0, 256, 256);
      ctx.restore();
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    requestAnimationFrame(draw);
  }

  function hitTest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height * 0.55;
    const rx = rect.width * 0.36;
    const ry = rect.height * 0.40;
    const dx = (clientX - cx) / rx;
    const dy = (clientY - cy) / ry;
    return dx * dx + dy * dy <= 1.15;
  }

  function updateIgnore(x, y) {
    if (pointerDown || dragging) return;
    const onPet = hitTest(x, y);
    const onStatus = hitTestStatus(x, y);
    const onBridge = hitTestStatusBridge(x, y);
    // Chevron stays hittable while chrome is hot, or when arriving via pet /
    // status / bridge (so hover over the bubble also reveals the arrow).
    const onToggle =
      hitTestToggle(x, y) &&
      (overChrome ||
        onPet ||
        onStatus ||
        onBridge ||
        (statusToggleEl && statusToggleEl.classList.contains('visible')));
    const hit = onPet || onToggle || onStatus || onBridge;
    overPet = onPet;
    if (hit !== overChrome) {
      overChrome = hit;
      setStatusToggleVisible(hit);
      if (petAreaEl) petAreaEl.classList.toggle('hot', hit);
      if (api) api.setIgnoreMouse(!hit);
    } else if (hit) {
      // Stay hot; refresh toggle visibility (e.g. after status on/off reflow)
      setStatusToggleVisible(true);
    }
    if (onPet && current === 'sleep') {
      if (api) api.wakeFromIdle();
      else setState('idle');
    }
  }

  function beginPotentialDrag(clientX, clientY) {
    pointerDown = true;
    dragMoved = false;
    dragging = false;
    downX = clientX;
    downY = clientY;
    downAt = performance.now();
    overPet = true;
    overChrome = true;
    setStatusToggleVisible(true);
    if (api) api.setIgnoreMouse(false);
  }

  function onPointerMove(clientX, clientY) {
    if (!pointerDown) return;
    const dx = clientX - downX;
    const dy = clientY - downY;
    if (!dragMoved && dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      dragMoved = true;
      dragging = true;
      if (api) api.dragStart();
    }
    if (dragging && api) api.dragMove();
  }

  function onPointerUp() {
    if (!pointerDown) return;
    const wasDrag = dragMoved;
    pointerDown = false;
    dragging = false;
    if (wasDrag) {
      if (api) api.dragEnd();
      return;
    }
    // True click: bounce + focus Grok terminal tab
    playClickAck();
    if (api && api.focusGrokTerminal) {
      api.focusGrokTerminal()
        .then((result) => {
          if (result && result.ok) console.log('[focus]', result.reason || 'ok');
          else console.warn('[focus]', (result && result.reason) || 'not-found');
        })
        .catch((err) => console.warn('[focus]', err));
    }
  }

  window.addEventListener('mousemove', (e) => {
    updateIgnore(e.clientX, e.clientY);
    onPointerMove(e.clientX, e.clientY);
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Chevron owns its click — don't start drag / focus-terminal
    if (hitTestToggle(e.clientX, e.clientY)) {
      e.preventDefault();
      return;
    }
    if (!hitTest(e.clientX, e.clientY)) return;
    beginPotentialDrag(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    onPointerUp();
  });
  window.addEventListener('contextmenu', (e) => {
    if (hitTestToggle(e.clientX, e.clientY)) {
      e.preventDefault();
      return;
    }
    if (!hitTest(e.clientX, e.clientY)) return;
    e.preventDefault();
    pointerDown = false;
    dragging = false;
    dragMoved = false;
    if (api) { api.setIgnoreMouse(false); api.showContextMenu(); }
  });
  document.addEventListener('mouseleave', () => {
    if (!pointerDown && !dragging && api) {
      overPet = false;
      overChrome = false;
      setStatusToggleVisible(false);
      if (petAreaEl) petAreaEl.classList.remove('hot');
      api.setIgnoreMouse(true);
    }
  });

  if (statusToggleEl) {
    statusToggleEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (api) api.setIgnoreMouse(false);
    });
    statusToggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleStatusBubble();
    });
  }

  async function init() {
    if (api) {
      try {
        const initialPrefs = await api.getPrefs();
        if (initialPrefs && typeof initialPrefs.mute === 'boolean') muted = initialPrefs.mute;
        if (initialPrefs && typeof initialPrefs.showStatus === 'boolean') {
          applyShowStatus(initialPrefs.showStatus);
        } else {
          applyShowStatus(true);
        }
        if (initialPrefs && initialPrefs.animationMode === 'static') animationMode = 'static';
      } catch (_) {
        applyShowStatus(true);
      }
    } else {
      applyShowStatus(true);
    }

    try {
      await ensureAnimationPacks();
      setState('idle');
    } catch (err) {
      console.error(err);
      setStatus('asset error');
    }
    requestAnimationFrame(draw);

    if (!api) return;

    try {
      const theme = await api.getTheme();
      if (theme?.celebrateMs) celebrateMs = theme.celebrateMs;
      if (theme?.wakeMs) wakeMs = theme.wakeMs;
    } catch (_) { /* ignore */ }

    api.onState((s, opts) => setState(s, opts || {}));
    if (api.onStateControl) {
      api.onStateControl((payload) => {
        if (payload && payload.mode === 'auto') {
          releaseStickyHold();
        }
      });
    }
    api.setIgnoreMouse(true);

    if (api.onThemeChanged) {
      api.onThemeChanged(async (theme) => {
        try {
          if (theme?.celebrateMs) celebrateMs = theme.celebrateMs;
          if (theme?.wakeMs) wakeMs = theme.wakeMs;
          loadedPackMode = null;
          await ensureAnimationPacks();
          setState(current || 'idle', { force: true, sticky: stickyHold });
        } catch (err) {
          console.error('[theme reload]', err);
        }
      });
    }
    if (api.onPrefs) {
      api.onPrefs(async (p) => {
        if (p && typeof p.mute === 'boolean') muted = p.mute;
        if (p && typeof p.showStatus === 'boolean') {
          applyShowStatus(p.showStatus);
          // Re-paint status classes after toggle
          setStatus(current || 'idle', lastDetail);
        }
        const nextMode = p && p.animationMode === 'static' ? 'static' : 'fluid';
        if (nextMode !== animationMode) {
          animationMode = nextMode;
          try {
            // Sticky locks keep fluid packs; Auto respects the new preference
            await ensureAnimationPacks();
            setState(current || 'idle', { force: true, sticky: stickyHold });
          } catch (err) {
            console.error('[animation mode reload]', err);
          }
        }
      });
    }
  }

  init();
})();
  