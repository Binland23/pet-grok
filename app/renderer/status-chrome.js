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
    detailLineHeight: 13, // ~10px font * 1.3
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
   * Primary label text for the status bubble.
   * Click/WEEEE aliases always surface as **WEEEE** (not "click").
   * @param {unknown} state
   * @returns {string}
   */
  function statusPrimaryLabel(state) {
    const key = normalizeStatusState(state);
    if (!key) return '';
    if (CLICK_ALIASES.has(key)) return 'WEEEE';
    return key;
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
    STATUS_EXTRA_H,
    LAYOUT,
    normalizeStatusState,
    isClickState,
    statusPrimaryLabel,
    shouldShowStatusChevron,
    resolveStatusChevronVisibility,
    windowHeightForPet,
    statusBlockMaxHeight,
    estimateStatusContentHeight,
    statusContentFitsReserve,
  };
});
