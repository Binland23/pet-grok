(function () {
  const api = window.dashboardAPI;
  if (!api) {
    document.getElementById('statusRow').innerHTML =
      '<span class="pill bad"><span class="dot"></span> Dashboard API unavailable</span>';
    return;
  }

  /** @type {any} */
  let snap = null;

  /**
   * Control buttons: Auto (hooks) first, then every pose including WEEEE (click).
   * @type {{ id: string, label: string, kind: 'auto' | 'state' }[]}
   */
  const PET_STATE_BUTTONS = [
    { id: 'auto', label: 'Auto', kind: 'auto' },
    { id: 'idle', label: 'idle', kind: 'state' },
    { id: 'wake', label: 'wake', kind: 'state' },
    { id: 'thinking', label: 'thinking', kind: 'state' },
    { id: 'working', label: 'working', kind: 'state' },
    { id: 'done', label: 'done', kind: 'state' },
    { id: 'alert', label: 'alert', kind: 'state' },
    { id: 'sleep', label: 'sleep', kind: 'state' },
    { id: 'click', label: 'WEEEE', kind: 'state' },
  ];

  /** @type {boolean} */
  let settingState = false;
  let petsSignature = '';
  let trayIconsSignature = '';

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function renderStatus() {
    const row = document.getElementById('statusRow');
    if (!snap) return;
    const serverOk = !!snap.serverOk;
    const last = snap.lastState || '—';
    const displayState = last === 'click' ? 'WEEEE' : last;
    const detail = (snap.lastDetail && String(snap.lastDetail).trim()) || '';
    const hooksOk = !!snap.hooksInstalled;
    const visible = snap.visible !== false;
    const showStatus = snap.showStatus !== false;
    const manual = (snap.stateControlMode || 'auto') === 'manual';
    const pills = [
      `<span class="pill ${serverOk ? 'ok' : 'bad'}"><span class="dot"></span> Server ${serverOk ? 'online' : 'offline'}</span>`,
      `<span class="pill"><span class="dot"></span> State <span class="mono">${escapeHtml(displayState)}</span></span>`,
    ];
    if (detail) {
      pills.push(
        `<span class="pill"><span class="dot"></span> Activity <span class="mono">${escapeHtml(detail)}</span></span>`
      );
    }
    pills.push(
      `<span class="pill ${manual ? 'warn' : 'ok'}"><span class="dot"></span> ${manual ? 'Manual lock' : 'Auto'}</span>`,
      `<span class="pill ${hooksOk ? 'ok' : 'warn'}"><span class="dot"></span> Hooks ${hooksOk ? 'installed' : 'missing'}</span>`,
      `<span class="pill ${visible ? 'ok' : 'warn'}"><span class="dot"></span> Pet ${visible ? 'shown' : 'hidden'}</span>`,
      `<span class="pill ${showStatus ? 'ok' : 'warn'}"><span class="dot"></span> Status ${showStatus ? 'on' : 'off'}</span>`
    );
    row.innerHTML = pills.join('');
  }

  function stateButtonActive(btnDef, mode, current) {
    if (btnDef.kind === 'auto') return mode === 'auto';
    return mode === 'manual' && btnDef.id === current;
  }

  async function withStateBusy(root, work) {
    if (settingState) return;
    settingState = true;
    root.querySelectorAll('.state-btn').forEach((b) => {
      b.disabled = true;
    });
    try {
      await work();
    } finally {
      settingState = false;
      root.querySelectorAll('.state-btn').forEach((b) => {
        b.disabled = false;
      });
      // Re-sync active styles after unlock
      renderStateGrid();
    }
  }

  function renderStateGrid() {
    const root = document.getElementById('stateGrid');
    if (!root) return;
    const current = String((snap && snap.lastState) || 'idle').toLowerCase();
    const mode = (snap && snap.stateControlMode) || 'auto';
    const needsBuild = root.childElementCount !== PET_STATE_BUTTONS.length;
    if (needsBuild) {
      root.innerHTML = PET_STATE_BUTTONS.map((btn) => {
        const active = stateButtonActive(btn, mode, current) ? 'active' : '';
        const extra =
          btn.kind === 'auto' ? 'mode-auto' : btn.id === 'click' ? 'weee' : '';
        const attr =
          btn.kind === 'auto'
            ? 'data-mode="auto"'
            : `data-state="${escapeHtml(btn.id)}"`;
        return `<button type="button" class="state-btn ${extra} ${active}" ${attr} aria-pressed="${stateButtonActive(btn, mode, current) ? 'true' : 'false'}">${escapeHtml(btn.label)}</button>`;
      }).join('');

      root.querySelectorAll('[data-mode="auto"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          withStateBusy(root, async () => {
            if (!api.setStateMode) {
              toast('Auto mode unavailable');
              return;
            }
            try {
              const result = await api.setStateMode('auto');
              if (result && result.ok === false) {
                toast(result.error || 'Could not set Auto');
                return;
              }
              snap = result;
              renderAll();
              toast('Auto — hooks drive the pet');
            } catch (e) {
              toast('Could not set Auto');
            }
          });
        });
      });

      root.querySelectorAll('[data-state]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const state = btn.getAttribute('data-state');
          if (!state || !api.setState) return;
          withStateBusy(root, async () => {
            try {
              const result = await api.setState(state);
              if (result && result.ok === false) {
                toast(result.error || 'Could not set state');
                return;
              }
              snap = result;
              renderAll();
              const label = state === 'click' ? 'WEEEE' : state;
              toast('Locked → ' + label);
            } catch (e) {
              toast('Could not set state');
            }
          });
        });
      });
    } else {
      root.querySelectorAll('.state-btn').forEach((btn) => {
        const isAuto = btn.getAttribute('data-mode') === 'auto';
        const state = btn.getAttribute('data-state');
        const isActive = isAuto
          ? mode === 'auto'
          : mode === 'manual' && state === current;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        btn.disabled = settingState;
      });
    }

    const hint = document.getElementById('stateHint');
    if (hint) {
      if (mode === 'manual') {
        const label = current === 'click' ? 'WEEEE' : current;
        hint.innerHTML =
          'Manual lock on <span class="mono">' +
          escapeHtml(label) +
          '</span> — Grok hooks are ignored. Press <strong>Auto</strong> for normal use.';
      } else {
        hint.innerHTML =
          '<strong>Auto</strong> lets Grok hooks drive the pet. Pick any pose to lock it (loops in the current Fluid / Static style) until you return to Auto.';
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPets() {
    const root = document.getElementById('pets');
    const themes = (snap && snap.themes) || [];
    const current = (snap && snap.themeId) || 'race-crab';
    if (!themes.length) {
      root.innerHTML = '<p class="hint">No themes found under themes/.</p>';
      petsSignature = '';
      return;
    }
    const signature = JSON.stringify(
      themes.map((t) => [t.id, t.name, t.description || '', t.previewUrl || ''])
    );
    if (signature !== petsSignature) {
      petsSignature = signature;
      root.innerHTML = themes
        .map((t) => {
          const img = t.previewUrl
            ? `<img src="${escapeHtml(t.previewUrl)}" alt="" />`
            : '<span style="color:#8fa3bb;font-size:11px">No preview</span>';
          return `
            <button type="button" class="pet-card" data-theme="${escapeHtml(t.id)}" aria-selected="false">
              <span class="badge" hidden>Active</span>
              <div class="thumb">${img}</div>
              <div class="name">${escapeHtml(t.name)}</div>
              <div class="desc">${escapeHtml(t.description || t.id)}</div>
            </button>`;
        })
        .join('');

      root.querySelectorAll('[data-theme]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-theme');
          try {
            snap = await api.setTheme(id);
            renderAll();
            toast('Pet updated');
          } catch (e) {
            toast('Could not switch pet');
          }
        });
      });
    }
    root.querySelectorAll('[data-theme]').forEach((btn) => {
      const selected = btn.getAttribute('data-theme') === current;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      const badge = btn.querySelector('.badge');
      if (badge) badge.hidden = !selected;
    });
  }

  function renderSettings() {
    if (!snap) return;
    document.querySelectorAll('#sizeSeg [data-size]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-size') === snap.size);
    });
    document.querySelectorAll('#animationSeg [data-animation-mode]').forEach((btn) => {
      const active = btn.getAttribute('data-animation-mode') === (snap.animationMode || 'fluid');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('toggleVisible').checked = snap.visible !== false;
    document.getElementById('toggleMute').checked = !!snap.mute;
    const showStatusEl = document.getElementById('toggleShowStatus');
    if (showStatusEl) showStatusEl.checked = snap.showStatus !== false;
    document.getElementById('hooksSub').textContent = snap.hooksInstalled
      ? (snap.hooksPath || 'Installed')
      : 'Not installed — Grok TUI won’t drive the pet';
    const btn = document.getElementById('btnHooks');
    btn.textContent = snap.hooksInstalled ? 'Uninstall' : 'Install';
    document.getElementById('footerLeft').textContent =
      (snap.themeName || 'Pet Grok') + ' · port 7788';
    document.getElementById('footerRight').textContent = snap.version || 'v1';
  }

  function renderTrayIcons() {
    const root = document.getElementById('trayIcons');
    if (!root) return;
    const options = (snap && snap.trayIcons) || [];
    const current = (snap && snap.trayIconId) || 'grok';
    if (!options.length) {
      root.innerHTML = '<p class="hint">No tray icons available.</p>';
      trayIconsSignature = '';
      return;
    }
    const signature = JSON.stringify(
      options.map((opt) => [
        opt.id,
        opt.name,
        opt.description || '',
        opt.previewUrl || '',
        opt.kind || 'pet',
      ])
    );
    if (signature !== trayIconsSignature) {
      trayIconsSignature = signature;
      root.innerHTML = options
      .map((opt) => {
        const selected = opt.id === current ? 'selected' : '';
        const badge = '<span class="badge" hidden>Active</span>';
        const kind = opt.kind || 'pet';
        const img = opt.previewUrl
          ? `<img src="${escapeHtml(opt.previewUrl)}" alt="" />`
          : '<span style="color:#8fa3bb;font-size:10px">—</span>';
        return `
          <button type="button" class="tray-card ${selected}" data-tray="${escapeHtml(opt.id)}" data-kind="${escapeHtml(kind)}" role="option" aria-selected="${opt.id === current}">
            ${badge}
            <div class="thumb">${img}</div>
            <div class="name">${escapeHtml(opt.name)}</div>
            <div class="desc">${escapeHtml(opt.description || '')}</div>
          </button>`;
      })
      .join('');

      root.querySelectorAll('[data-tray]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-tray');
          try {
            snap = await api.applySettings({ trayIconId: id });
            renderAll();
            toast('Tray icon updated');
          } catch (e) {
            toast('Could not update tray icon');
          }
        });
      });
    }
    root.querySelectorAll('[data-tray]').forEach((btn) => {
      const selected = btn.getAttribute('data-tray') === current;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      const badge = btn.querySelector('.badge');
      if (badge) badge.hidden = !selected;
    });
  }

  function renderAll() {
    renderStatus();
    renderStateGrid();
    renderPets();
    renderTrayIcons();
    renderSettings();
  }

  async function refresh() {
    snap = await api.getSnapshot();
    renderAll();
  }

  async function patch(p, msg) {
    snap = await api.applySettings(p);
    renderAll();
    if (msg) toast(msg);
  }

  document.getElementById('btnClose').addEventListener('click', () => api.close());
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    await refresh();
    toast('Refreshed');
  });

  document.querySelectorAll('#sizeSeg [data-size]').forEach((btn) => {
    btn.addEventListener('click', () => patch({ size: btn.getAttribute('data-size') }, 'Size updated'));
  });
  document.querySelectorAll('#animationSeg [data-animation-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-animation-mode');
      patch(
        { animationMode: mode },
        mode === 'static' ? 'Static sprites enabled' : 'Fluid animation enabled'
      );
    });
  });

  document.getElementById('toggleVisible').addEventListener('change', (e) => {
    patch({ visible: e.target.checked }, e.target.checked ? 'Pet shown' : 'Pet hidden');
  });
  document.getElementById('toggleMute').addEventListener('change', (e) => {
    patch({ mute: e.target.checked }, e.target.checked ? 'Muted' : 'Unmuted');
  });
  const toggleShowStatus = document.getElementById('toggleShowStatus');
  if (toggleShowStatus) {
    toggleShowStatus.addEventListener('change', (e) => {
      patch(
        { showStatus: e.target.checked },
        e.target.checked ? 'Status bubble shown' : 'Status bubble hidden'
      );
    });
  }

  document.getElementById('btnHooks').addEventListener('click', async () => {
    if (snap && snap.hooksInstalled) {
      snap = await api.uninstallHooks();
      toast('Hooks removed');
    } else {
      snap = await api.installHooks();
      toast('Hooks installed');
    }
    renderAll();
  });

  document.getElementById('btnRefreshHooks').addEventListener('click', async () => {
    snap = await api.installHooks();
    renderAll();
    toast('Hooks refreshed');
  });

  document.getElementById('btnShowPet').addEventListener('click', () => {
    patch({ visible: true }, 'Pet shown');
  });

  document.getElementById('btnHealth').addEventListener('click', async () => {
    const h = await api.openHealth();
    if (h && h.ok) toast('Server ok · ' + (h.lastState || '?'));
    else toast('Server offline');
    await refresh();
  });

  api.onSnapshot((s) => {
    snap = s;
    renderAll();
  });

  refresh().catch((err) => {
    document.getElementById('statusRow').innerHTML =
      '<span class="pill bad"><span class="dot"></span> ' + escapeHtml(err.message || 'Load failed') + '</span>';
  });
})();
