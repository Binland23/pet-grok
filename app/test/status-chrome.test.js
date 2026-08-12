'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chrome = require('../renderer/status-chrome');
const {
  statusPrimaryLabel,
  shouldShowStatusChevron,
  resolveStatusChevronVisibility,
  isClickState,
  normalizeStatusState,
  STATUS_EXTRA_H,
  windowHeightForPet,
  estimateStatusContentHeight,
  statusContentFitsReserve,
  statusBlockMaxHeight,
  LAYOUT,
} = chrome;

describe('status primary label (WEEEE path)', () => {
  it('maps click and aliases to WEEEE (not blank, not raw click)', () => {
    for (const key of ['click', 'weee', 'whee', 'wooo', 'WEEE', 'Click', 'WHEEE']) {
      const label = statusPrimaryLabel(key);
      assert.equal(label, 'WEEEE', `expected WEEEE for ${key}, got ${label}`);
      assert.notEqual(String(label).toLowerCase(), 'click');
      assert.ok(String(label).trim().length > 0);
      // Case-insensitive match after CSS text-transform: uppercase
      assert.equal(label.toUpperCase(), 'WEEEE');
    }
  });

  it('leaves non-click states as normalized names', () => {
    assert.equal(statusPrimaryLabel('idle'), 'idle');
    assert.equal(statusPrimaryLabel('WORKING'), 'working');
    assert.equal(statusPrimaryLabel('done'), 'done');
  });

  it('isClickState / normalizeStatusState agree with label mapping', () => {
    assert.equal(isClickState('weee'), true);
    assert.equal(normalizeStatusState(' Weee '), 'weee');
    assert.equal(statusPrimaryLabel(normalizeStatusState('weee')), 'WEEEE');
  });
});

describe('status bubble layout reserve (no cutoff)', () => {
  it('reserves enough height for label + two detail lines', () => {
    assert.ok(STATUS_EXTRA_H >= 72, `STATUS_EXTRA_H too small: ${STATUS_EXTRA_H}`);
    assert.equal(LAYOUT.maxDetailLines, 2);
    assert.equal(
      statusContentFitsReserve({ hasDetail: true, detailLines: 2 }),
      true,
      'two-line detail must fit in reserved strip'
    );
    assert.equal(
      statusContentFitsReserve({ hasDetail: false }),
      true,
      'label-only bubble must fit'
    );
  });

  it('fits a representative long multi-word tool detail without vertical clip', () => {
    // Typical long activity line that previously overflowed the 48px strip
    const longDetail =
      'Running npm test --test-name-pattern status-chrome and writing evidence logs';
    assert.ok(longDetail.split(/\s+/).length >= 6, 'fixture should be multi-word');
    // Product clamps to 2 lines; both lines must fit the reserve
    const contentH = estimateStatusContentHeight({ hasDetail: true, detailLines: 2 });
    const maxH = statusBlockMaxHeight(STATUS_EXTRA_H);
    assert.ok(
      contentH <= maxH,
      `content ${contentH}px must fit in reserve ${maxH}px (extra=${STATUS_EXTRA_H})`
    );
    assert.equal(statusContentFitsReserve({ hasDetail: true, detailLines: 2 }), true);
  });

  it('window height grows by STATUS_EXTRA_H when status is shown', () => {
    assert.equal(windowHeightForPet(192, true), 192 + STATUS_EXTRA_H);
    assert.equal(windowHeightForPet(192, false), 192);
    assert.equal(windowHeightForPet(128, true), 128 + STATUS_EXTRA_H);
  });

  it('ships CSS reserve matching STATUS_EXTRA_H and line-clamp 2', () => {
    const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /--status-reserve:\s*80px/);
    assert.match(html, /line-clamp:\s*2/);
    assert.match(html, /max-height:\s*calc\(100% - var\(--status-reserve\)\)/);
    assert.match(html, /status-collapsed/);
  });
});

describe('status chevron hover visibility', () => {
  it('bubble shown + hover pet → chevron hidden', () => {
    assert.equal(
      shouldShowStatusChevron({
        statusVisible: true,
        overPet: true,
        overStatus: false,
        overToggle: false,
      }),
      false
    );
  });

  it('bubble shown + hover bubble → chevron visible', () => {
    assert.equal(
      shouldShowStatusChevron({
        statusVisible: true,
        overPet: false,
        overStatus: true,
        overToggle: false,
      }),
      true
    );
  });

  it('bubble hidden + hover pet → chevron visible', () => {
    assert.equal(
      shouldShowStatusChevron({
        statusVisible: false,
        overPet: true,
        overStatus: false,
        overToggle: false,
      }),
      true
    );
  });

  it('bubble hidden + hover neither → chevron hidden', () => {
    assert.equal(
      shouldShowStatusChevron({
        statusVisible: false,
        overPet: false,
        overStatus: false,
        overToggle: false,
      }),
      false
    );
  });

  it('chevron stays visible while pointer is on the toggle itself (already revealed)', () => {
    assert.equal(
      shouldShowStatusChevron({
        statusVisible: true,
        overPet: false,
        overStatus: false,
        overToggle: true,
      }),
      true
    );
    assert.equal(
      shouldShowStatusChevron({
        statusVisible: false,
        overPet: false,
        overStatus: false,
        overToggle: true,
      }),
      true
    );
  });
});

describe('resolveStatusChevronVisibility (updateIgnore flag wiring)', () => {
  it('active + toggle-zone only (not status, not already visible) → hidden', () => {
    // Models the bug: invisible chevron sits on pet bottom-center; bare
    // toggleHitRaw + showStatus must NOT reveal when overStatus is false.
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: true,
        overPet: false,
        overStatus: false,
        toggleHitRaw: true,
        chevronAlreadyVisible: false,
      }),
      false
    );
  });

  it('active + toggle-zone + pet hover still → hidden (no pet reveal)', () => {
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: true,
        overPet: true,
        overStatus: false,
        toggleHitRaw: true,
        chevronAlreadyVisible: false,
      }),
      false
    );
  });

  it('active + over status → visible (even if toggle not hit)', () => {
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: true,
        overPet: false,
        overStatus: true,
        toggleHitRaw: false,
        chevronAlreadyVisible: false,
      }),
      true
    );
  });

  it('active + already visible + still on toggle → self-hold visible', () => {
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: true,
        overPet: false,
        overStatus: false,
        toggleHitRaw: true,
        chevronAlreadyVisible: true,
      }),
      true
    );
  });

  it('minimized + over pet → visible', () => {
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: false,
        overPet: true,
        overStatus: false,
        toggleHitRaw: false,
        chevronAlreadyVisible: false,
      }),
      true
    );
  });

  it('minimized + toggle-zone cold (not already visible, not pet) → hidden', () => {
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: false,
        overPet: false,
        overStatus: false,
        toggleHitRaw: true,
        chevronAlreadyVisible: false,
      }),
      false
    );
  });

  it('minimized + already visible + on toggle → self-hold visible', () => {
    assert.equal(
      resolveStatusChevronVisibility({
        statusVisible: false,
        overPet: false,
        overStatus: false,
        toggleHitRaw: true,
        chevronAlreadyVisible: true,
      }),
      true
    );
  });
});

describe('shipped pet.js wiring', () => {
  it('loads status-chrome helpers and uses them for label + chevron', () => {
    const petPath = path.join(__dirname, '..', 'renderer', 'pet.js');
    const src = fs.readFileSync(petPath, 'utf8');
    assert.match(src, /PetStatusChrome/);
    assert.match(src, /statusPrimaryLabel/);
    assert.match(src, /resolveStatusChevronVisibility/);
    assert.match(src, /chevronFromPointer/);
    assert.match(src, /chevronAlreadyVisible/);
    assert.match(src, /setStatus\('click'/);
    // playClickAck must paint WEEEE even before frames finish loading
    assert.match(src, /playClickAck/);
    assert.match(src, /setStatus\('click',\s*''\)/);
    // Must not promote toggle reveal via bare showStatus alone
    assert.doesNotMatch(
      src,
      /overToggle:\s*toggleHitRaw\s*&&\s*\([^)]*showStatus/
    );
  });

  it('main process sizes the window with shared STATUS_EXTRA_H', () => {
    const mainPath = path.join(__dirname, '..', 'main', 'main.js');
    const src = fs.readFileSync(mainPath, 'utf8');
    assert.match(src, /status-chrome/);
    assert.match(src, /windowHeightForPet/);
    assert.doesNotMatch(src, /STATUS_EXTRA_H\s*=\s*48/);
  });
});
