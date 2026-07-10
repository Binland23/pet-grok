(function () {
  const canvas = document.getElementById('petCanvas');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
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
  /** Manifest definitions remain lightweight; image frames are decoded on demand. */
  let animationDefs = {};
  let assetBaseUrl = ASSET;
  let stateLoadPromises = {};
  let current = 'idle';
  let frameIndex = 0;
  let frameDirection = 1;
  let frameAcc = 0;
  let lastTs = performance.now();
  let renderTimer = null;
  let renderRaf = null;
  let renderStarted = false;
  let renderDirty = true;
  let celebrateTimer = null;
  let wakeTimer = null;
  let clickTimer = null;
  let celebrateMs = 1800;
  let wakeMs = 900;
  let dragging = false;
  let dragMoved = false;
  let overPet = false;
  let pointerDown = false;
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
  /** User preference from dashboard: fluid (24fps) | static (classic ~9fps packs) */
  let animationMode = 'fluid';
  /**
   * Currently loaded frame pack mode (matches animationMode once packs load).
   * @type {'fluid' | 'static' | null}
   */
  let loadedPackMode = null;
  let packLoadGen = 0;
  let stateRequestGen = 0;
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

  function resolveAssetSrc(rel) {
    try {
      return new URL(String(rel || '').replace(/^\/+/, ''), assetBaseUrl).href;
    } catch (_) {
      return ASSET + rel;
    }
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
  async function loadAnimationManifest(mode = desiredPackMode()) {
    const packMode = mode === 'static' ? 'static' : 'fluid';
    let meta = null;
    let base = ASSET;
    if (api) {
      const [manifestResult, baseResult] = await Promise.all([
        api.getAnimations ? api.getAnimations(packMode) : Promise.resolve(null),
        api.assetBase ? api.assetBase() : Promise.resolve(ASSET),
      ]);
      meta = manifestResult;
      if (baseResult) base = baseResult;
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
    const defs = {};
    for (const [state, def] of Object.entries(meta.animations || {})) {
      // Manifest already points at frames/ or frames-static/; use as-is.
      const list = framePathsForMode(state, def.frames, packMode, def.frames);
      if (!list.length) continue;
      const fps = typeof def.fps === 'number' && def.fps > 0
        ? def.fps
        : (MOTION[state] && MOTION[state].fps) || defaultFps;
      defs[state] = {
        paths: list.slice(),
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
    if (!defs.wake && defs.idle) {
      defs.wake = { ...defs.idle, paths: defs.idle.paths.slice(), loop: false, loopMode: 'restart' };
    }
    if (!defs.idle && defs.thinking) defs.idle = { ...defs.thinking, paths: defs.thinking.paths.slice() };
    return { defs, base };
  }

  /** Decode one state's frames the first time that state is requested. */
  async function ensureStateAnimation(state) {
    if (anims[state]) return anims[state];
    if (stateLoadPromises[state]) return stateLoadPromises[state];
    const gen = packLoadGen;
    const def = animationDefs[state];
    const promise = (async () => {
      if (def) {
        const frames = await Promise.all(def.paths.map((rel) => loadImage(resolveAssetSrc(rel))));
        if (gen !== packLoadGen) return null;
        const loaded = {
          frames,
          loop: def.loop,
          loopMode: def.loopMode,
          fps: def.fps,
        };
        anims[state] = loaded;
        return loaded;
      }

      // Click ack has no manifest entry in most themes. Decode only the small
      // set of source states it borrows from, and retain those shared images.
      if (state === 'click') {
        await Promise.all(['alert', 'wake', 'idle'].map((name) => ensureStateAnimation(name)));
        if (gen !== packLoadGen) return null;
        const out = anims;
        const frames = [];
        if (out.alert && out.alert.frames[0]) frames.push(out.alert.frames[0]);
        if (out.alert && out.alert.frames[1]) frames.push(out.alert.frames[1]);
        if (out.wake && out.wake.frames[0]) frames.push(out.wake.frames[0]);
        if (out.idle && out.idle.frames[0]) frames.push(out.idle.frames[0]);
        if (frames.length) {
          const loaded = {
            frames,
            loop: false,
            loopMode: 'restart',
            fps: (MOTION.click && MOTION.click.fps) || 10,
          };
          anims.click = loaded;
          return loaded;
        }
      }
      return null;
    })();
    stateLoadPromises[state] = promise;
    try {
      return await promise;
    } finally {
      if (stateLoadPromises[state] === promise) delete stateLoadPromises[state];
    }
  }

  /**
   * Ensure loaded packs match the fluid/static preference.
   * @returns {Promise<boolean>} true if packs were reloaded
   */
  async function ensureAnimationPacks() {
    const want = desiredPackMode();
    if (loadedPackMode === want && Object.keys(animationDefs).length && anims.idle) {
      return false;
    }
    const gen = ++packLoadGen;
    // Release decoded images from the previous theme/mode before loading more.
    anims = {};
    animationDefs = {};
    stateLoadPromises = {};
    assetBaseUrl = ASSET;
    loadedPackMode = null;
    const next = await loadAnimationManifest(want);
    if (gen !== packLoadGen) return false;
    animationDefs = next.defs;
    assetBaseUrl = next.base || ASSET;
    loadedPackMode = want;
    await ensureStateAnimation('idle');
    if (gen !== packLoadGen) return false;
    return true;
  }

  const STATUS_LABELS = {
    click: 'WEEEE',
  };

  function setStatus(text) {
    const key = String(text || '').toLowerCase();
    statusEl.textContent = STATUS_LABELS[key] || text;
    statusEl.className = 'st-' + key;
    statusEl.classList.add('flash');
    void statusEl.offsetWidth;
    setTimeout(() => statusEl.classList.remove('flash'), 200);
  }

  function setState(next, options = {}) {
    if (!next) return;
    next = String(next).toLowerCase();
    const requestGen = options._requestGen || ++stateRequestGen;
    // sticky: true from dashboard manual lock; sticky: false clears it.
    // Omit sticky (hook / internal transitions) to leave the flag alone unless
    // this is a normal auto payload that should exit sticky — handled by
    // releaseStickyHold() and by explicit sticky:false.
    if (typeof options.sticky === 'boolean') {
      stickyHold = options.sticky;
    }

    // If fluid/static packs are still loading (mode toggle), wait then re-apply.
    if (desiredPackMode() !== loadedPackMode) {
      const pending = {
        next,
        options: Object.assign({}, options, {
          _requestGen: requestGen,
          sticky: stickyHold,
          force: true,
        }),
      };
      ensureAnimationPacks()
        .then(() => {
          if (requestGen === stateRequestGen) setState(pending.next, pending.options);
        })
        .catch((err) => console.error('[anim packs]', err));
      return;
    }

    if (!anims[next]) {
      ensureStateAnimation(next)
        .then((loaded) => {
          if (requestGen !== stateRequestGen) return;
          setState(loaded ? next : 'idle', {
            ...options,
            _requestGen: requestGen,
            sticky: stickyHold,
            force: true,
          });
        })
        .catch((err) => console.error('[state frames]', next, err));
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
    if (alreadyPlaying) return;

    // Harness / external states cancel a local click ack
    if (next !== 'click') {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      clickPulse = 0;
    }

    if (celebrateTimer) { clearTimeout(celebrateTimer); celebrateTimer = null; }
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }

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

  /** Leave sticky lock when the dashboard switches back to Auto. */
  function releaseStickyHold() {
    stickyHold = false;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    if (celebrateTimer) { clearTimeout(celebrateTimer); celebrateTimer = null; }
    if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
    clickPulse = 0;

    const settle = () => {
      // One-shot poses don't make sense as permanent auto states — settle to idle
      if (current === 'wake' || current === 'done' || current === 'click') {
        applyState('idle');
      } else if (current === 'thinking' || current === 'working' || current === 'alert') {
        // Keep continuous agent poses; re-apply so static packs take effect if needed
        applyState(current);
      } else {
        applyState(current || 'idle');
      }
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
    setStatus(name);
    markDirty();
    console.log('[pet] applied state', name, 'frames=', (anims[name] && anims[name].frames.length) || 0, 'sticky=', stickyHold);
  }

  function stopRenderLoop() {
    if (renderTimer != null) clearTimeout(renderTimer);
    if (renderRaf != null) cancelAnimationFrame(renderRaf);
    renderTimer = null;
    renderRaf = null;
  }

  function scheduleDraw(delayMs = 0) {
    if (!renderStarted || document.hidden || renderTimer != null || renderRaf != null) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (document.hidden) return;
      renderRaf = requestAnimationFrame(draw);
    }, Math.max(0, delayMs));
  }

  function markDirty() {
    renderDirty = true;
    if (!renderStarted || document.hidden) return;
    if (renderTimer != null) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    scheduleDraw(0);
  }

  function nextDrawDelay(p, anim) {
    if (!anim || !anim.frames.length) return 500;
    // Transform effects are intentionally capped below display refresh rate.
    if (current === 'idle' || current === 'click' || clickPulse > 0) return 1000 / 30;
    if (!p.static && mode === 'play') return Math.max(16, 1000 / Math.max(1, p.fps));
    if (!p.static && mode === 'hold' && Number.isFinite(holdLeft) && holdLeft < 1e8) {
      return Math.max(16, Math.min(250, holdLeft * 1000));
    }
    return 500;
  }

  function draw(ts) {
    renderRaf = null;
    // Low-fps states (notably sleep at 1.5fps) are timer-paced, so preserve
    // their elapsed interval instead of applying the old per-vsync 50ms cap.
    const dt = Math.min(1, (ts - lastTs) / 1000);
    lastTs = ts;
    const previousFrame = frameIndex;
    const previousMode = mode;
    const previousPulse = clickPulse;

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

      const visualMotion = current === 'idle' || current === 'click' || clickPulse > 0;
      const shouldRender =
        renderDirty ||
        visualMotion ||
        frameIndex !== previousFrame ||
        mode !== previousMode ||
        clickPulse !== previousPulse;
      if (shouldRender) {
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
        const lift = Math.max(0, -bobY);
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
      }
    } else if (renderDirty) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    renderDirty = false;
    scheduleDraw(nextDrawDelay(p, anim));
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
    const hit = hitTest(x, y);
    if (hit !== overPet) {
      overPet = hit;
      if (api) api.setIgnoreMouse(!hit);
    }
    if (hit && current === 'sleep') {
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
    if (!hitTest(e.clientX, e.clientY) || e.button !== 0) return;
    beginPotentialDrag(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    onPointerUp();
  });
  window.addEventListener('contextmenu', (e) => {
    if (!hitTest(e.clientX, e.clientY)) return;
    e.preventDefault();
    pointerDown = false;
    dragging = false;
    dragMoved = false;
    if (api) { api.setIgnoreMouse(false); api.showContextMenu(); }
  });
  document.addEventListener('mouseleave', () => {
    if (!pointerDown && !dragging && api) { overPet = false; api.setIgnoreMouse(true); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopRenderLoop();
      return;
    }
    lastTs = performance.now();
    markDirty();
  });

  async function init() {
    if (api) {
      try {
        const initialPrefs = await api.getPrefs();
        if (initialPrefs && typeof initialPrefs.mute === 'boolean') muted = initialPrefs.mute;
        if (initialPrefs && initialPrefs.animationMode === 'static') animationMode = 'static';
      } catch (_) { /* use defaults */ }
    }

    try {
      await ensureAnimationPacks();
      setState('idle');
    } catch (err) {
      console.error(err);
      setStatus('asset error');
    }
    renderStarted = true;
    lastTs = performance.now();
    markDirty();

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
