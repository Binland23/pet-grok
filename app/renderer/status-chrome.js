'use strict';

/**
 * Pure status-bubble helpers (label mapping, chevron visibility, layout reserve).
 * Used by the pet renderer and main-process window sizing; unit-tested directly.
 */
(function exposeStatusChrome(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PetStatusChrome = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStatusChrome() {
  /** Aliases that mean the local WEEEE / click ack pose. */
  const CLICK_ALIASES = new Set(['click', 'weee', 'whee', 'wooo', 'wheee']);

  /** Human phase names for the bubble headline when no tool verb is known. */
  const PHASE_LABELS = {
    idle: 'Ready',
    thinking: 'Thinking',
    working: 'Working',
    done: 'Done',
    alert: 'Needs you',
    sleep: 'Asleep',
    wake: 'Hello',
    click: 'WEEEE',
  };

  /**
   * Activity-line prefixes produced by activity-summary.js.
   * Longer / more specific patterns first so "Reading" wins over "Read ".
   * `display` is the short headline (CSS uppercases it).
   */
  const ACTIVITY_PREFIXES = [
    { display: 'Edited', re: /^Edited\s+/i },
    { display: 'Edit', re: /^Editing\s+/i },
    { display: 'Wrote', re: /^Wrote\s+/i },
    { display: 'Write', re: /^Writing\s+/i },
    { display: 'Read', re: /^Reading\s+/i },
    { display: 'Read', re: /^Read\s+/i },
    { display: 'Ran', re: /^Ran\s+/i },
    { display: 'Run', re: /^Running\s+/i },
    { display: 'Search', re: /^Searched(?:\s+for)?\s+/i },
    { display: 'Search', re: /^Searching(?:\s+for)?\s+/i },
    { display: 'Find', re: /^Found\s+/i },
    { display: 'Find', re: /^Finding\s+/i },
    { display: 'Browse', re: /^Browsed\s+/i },
    { display: 'Browse', re: /^Browsing\s+/i },
    { display: 'Fetch', re: /^Fetched\s+/i },
    { display: 'Fetch', re: /^Fetching\s+/i },
    { display: 'Web', re: /^Web search:\s+/i },
    { display: 'Helper', re: /^Helper:\s+/i },
    { display: 'Helper', re: /^Starting\s+/i },
    { display: 'Use', re: /^Using\s+/i },
    { display: 'Tasks', re: /^Updating\s+/i },
    { display: 'Draw', re: /^Drawing\s+/i },
    { display: 'Watch', re: /^Watching\s+/i },
    { display: 'Failed', re: /^Failed:\s+/i },
    { display: 'Waiting', re: /^Waiting\s+/i },
    { display: 'Plan', re: /^Planning\s+/i },
    { display: 'Workflow', re: /^Workflow:\s+/i },
  ];

  /**
   * Extra window height (px) reserved under the square pet for the glass bubble.
   * Sized for primary label + up to two detail lines + padding/margins.
   */
  const STATUS_EXTRA_H = 80;

  /** Layout constants mirrored by index.html status chrome. */
  const LAYOUT = {
    statusMarginTop: 2,
    statusPaddingY: 13, // 6 top + 7 bottom
    labelLineHeight: 12, // ~10px font * 1.2
    detailMarginTop: 3,
    detailLineHeight: 15, // ~11px font * 1.3
    maxDetailLines: 2,
    bubbleBorder: 2,
  };

  /**
   * Normalize a pet state / alias for status purposes.
   * @param {unknown} state
   * @returns {string}
   */
  function normalizeStatusState(state) {
    return String(state || '')
      .trim()
      .toLowerCase();
  }

  /**
   * True when this state is the local WEEEE / click ack.
   * @param {unknown} state
   * @returns {boolean}
   */
  function isClickState(state) {
    return CLICK_ALIASES.has(normalizeStatusState(state));
  }

  /**
   * Split a summarizer sentence into { verb, target } when it matches a known prefix.
   * @param {unknown} detail
   * @returns {{ verb: string, target: string } | null}
   */
  function splitActivityLine(detail) {
    const line = String(detail || '').replace(/\s+/g, ' ').trim();
    if (!line) return null;
    // Phase fallbacks — not tool lines; don't promote "Read" from "Reading your request"
    if (/^Reading your request$/i.test(line) || /^Finished this turn$/i.test(line)) {
      return null;
    }
    for (const item of ACTIVITY_PREFIXES) {
      const m = line.match(item.re);
      if (!m) continue;
      const target = line.slice(m[0].length).trim();
      return { verb: item.display, target };
    }
    return null;
  }

  /**
   * Phase-only label (dashboard pose name). Never promotes a tool verb.
   * @param {unknown} state
   * @returns {string}
   */
  function statusPhaseLabel(state) {
    const key = normalizeStatusState(state);
    if (!key) return '';
    if (CLICK_ALIASES.has(key)) return 'WEEEE';
    return PHASE_LABELS[key] || key;
  }

  /**
   * Primary label text for the status bubble.
   * Click/WEEEE aliases always surface as **WEEEE** (not "click").
   * While working (or a failed tool), promote the activity verb (Edit, Run, …).
   * @param {unknown} state
   * @param {unknown} [detail]
   * @returns {string}
   */
  function statusPrimaryLabel(state, detail) {
    const key = normalizeStatusState(state);
    if (!key) return '';
    if (CLICK_ALIASES.has(key)) return 'WEEEE';
    if (key === 'working' || key === 'alert') {
      const split = splitActivityLine(detail);
      if (split && split.verb) return split.verb;
    }
    return PHASE_LABELS[key] || key;
  }

  /**
   * Detail line painted under the primary label.
   * For working/alert, drop the verb already shown as the headline.
   * @param {unknown} state
   * @param {unknown} [detail]
   * @returns {string}
   */
  function statusDetailText(state, detail) {
    const line = String(detail == null ? '' : detail).replace(/\s+/g, ' ').trim();
    if (!line) return '';
    const key = normalizeStatusState(state);
    if (key === 'working' || key === 'alert') {
      const split = splitActivityLine(line);
      if (split && split.target) return split.target;
    }
    return line;
  }

  /**
   * Whether the status-toggle chevron should be visible (semantic form).
   *
   * - Bubble **shown/active**: only while pointer is over the bubble, or over
   *   the chevron **after** it is already shown (self-hold). Never from pet alone.
   * - Bubble **hidden/minimized**: while pointer is over the pet, or over the
   *   chevron after it is already shown.
   *
   * Prefer {@link resolveStatusChevronVisibility} for the real pointer wiring
   * (toggle hit-zone + already-visible flags) used by `updateIgnore`.
   *
   * @param {{
   *   statusVisible: boolean,
   *   overPet: boolean,
   *   overStatus: boolean,
   *   overToggle?: boolean,
   * }} opts
   * @returns {boolean}
   */
  function shouldShowStatusChevron(opts) {
    const statusVisible = !!(opts && opts.statusVisible);
    const overPet = !!(opts && opts.overPet);
    const overStatus = !!(opts && opts.overStatus);
    const overToggle = !!(opts && opts.overToggle);
    // overToggle here means "on the chevron after it was already revealed"
    if (overToggle) return true;
    if (statusVisible) return overStatus;
    return overPet;
  }

  /**
   * Full pointer → chevron visibility decision used by `updateIgnore`.
   *
   * Important: when the bubble is **active**, an invisible chevron hit-zone
   * sits on the pet (bottom center). Hovering that zone alone must NOT reveal
   * the chevron — only hovering the bubble (or the chevron once already
   * `.visible`) may show it.
   *
   * @param {{
   *   statusVisible: boolean,
   *   overPet: boolean,
   *   overStatus: boolean,
   *   toggleHitRaw: boolean,
   *   chevronAlreadyVisible: boolean,
   * }} opts
   * @returns {boolean}
   */
  function resolveStatusChevronVisibility(opts) {
    const statusVisible = !!(opts && opts.statusVisible);
    const overPet = !!(opts && opts.overPet);
    const overStatus = !!(opts && opts.overStatus);
    const toggleHitRaw = !!(opts && opts.toggleHitRaw);
    const chevronAlreadyVisible = !!(opts && opts.chevronAlreadyVisible);

    // Self-hold only: toggle zone counts after the chevron is already shown
    // (or while over the bubble, which is the active-mode reveal surface).
    const overToggleHold =
      toggleHitRaw && (chevronAlreadyVisible || (statusVisible && overStatus));

    return shouldShowStatusChevron({
      statusVisible,
      overPet,
      overStatus,
      overToggle: overToggleHold,
    });
  }

  /**
   * Pet window height for a square sprite of `petSizePx`.
   * @param {number} petSizePx
   * @param {boolean} showStatus
   * @returns {number}
   */
  function windowHeightForPet(petSizePx, showStatus) {
    const w = Math.max(1, Number(petSizePx) || 0);
    return w + (showStatus ? STATUS_EXTRA_H : 0);
  }

  /**
   * Max height (px) the status block may occupy inside the reserved strip.
   * @param {number} [extraH]
   * @returns {number}
   */
  function statusBlockMaxHeight(extraH = STATUS_EXTRA_H) {
    return Math.max(0, (Number(extraH) || 0) - LAYOUT.statusMarginTop);
  }

  /**
   * Estimated painted height of the status bubble for label + optional detail.
   * Used to prove the reserved strip fits full intended lines (no vertical clip).
   * @param {{ hasDetail?: boolean, detailLines?: number }} [opts]
   * @returns {number}
   */
  function estimateStatusContentHeight(opts = {}) {
    const hasDetail = !!opts.hasDetail;
    const lines = hasDetail
      ? Math.min(
          LAYOUT.maxDetailLines,
          Math.max(1, Number(opts.detailLines) || LAYOUT.maxDetailLines)
        )
      : 0;
    let h = LAYOUT.statusPaddingY + LAYOUT.labelLineHeight + LAYOUT.bubbleBorder;
    if (hasDetail && lines > 0) {
      h += LAYOUT.detailMarginTop + lines * LAYOUT.detailLineHeight;
    }
    return h;
  }

  /**
   * Whether estimated content fits in the reserved status strip (no clip).
   * @param {{ hasDetail?: boolean, detailLines?: number, extraH?: number }} [opts]
   * @returns {boolean}
   */
  function statusContentFitsReserve(opts = {}) {
    const content = estimateStatusContentHeight(opts);
    const maxH = statusBlockMaxHeight(opts.extraH != null ? opts.extraH : STATUS_EXTRA_H);
    return content <= maxH;
  }

  return {
    CLICK_ALIASES,
    PHASE_LABELS,
    ACTIVITY_PREFIXES,
    STATUS_EXTRA_H,
    LAYOUT,
    normalizeStatusState,
    isClickState,
    splitActivityLine,
    statusPhaseLabel,
    statusPrimaryLabel,
    statusDetailText,
    shouldShowStatusChevron,
    resolveStatusChevronVisibility,
    windowHeightForPet,
    statusBlockMaxHeight,
    estimateStatusContentHeight,
    statusContentFitsReserve,
  };
});
