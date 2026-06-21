/* Safely renders Font Awesome classes supplied by a schema field. */
(function () {
  const FALLBACK_ICON = 'fa-solid fa-file-lines';
  const CLASS_PATTERN = /^fa(?:-[a-z0-9-]+)?$/;

  function normalize(icon) {
    if (typeof icon !== 'string') return FALLBACK_ICON;
    const classes = icon.trim().split(/\s+/).filter(className => CLASS_PATTERN.test(className));
    return classes.some(className => className === 'fa-solid' || className === 'fa-regular' || className === 'fa-brands')
      ? classes.join(' ')
      : FALLBACK_ICON;
  }

  function markup(icon, extraClass = '') {
    return `<i class="${normalize(icon)}${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true"></i>`;
  }

  window.ConfigIcons = { markup, normalize };
})();
