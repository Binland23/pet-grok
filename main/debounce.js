'use strict';

function debounce(fn, delayMs) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
  wrapped.cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

module.exports = { debounce };
