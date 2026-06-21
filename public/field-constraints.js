/* Shared schema constraints used by both form and graph renderers. */
(function (global) {
  function hasBound(field, name) {
    return field?.[name] !== undefined && field[name] !== null && field[name] !== '';
  }

  function getBound(field, name) {
    const value = Number(field?.[name]);
    return hasBound(field, name) && Number.isFinite(value) ? value : null;
  }

  function isEmpty(value) {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  }

  function getIssues(field, value) {
    const issues = [];
    const label = field.label || field.name;
    const min = getBound(field, 'min');
    const max = getBound(field, 'max');

    if (field.required && isEmpty(value)) return [`${label} requis`];
    if (isEmpty(value)) return issues;

    if (field.type === 'string') {
      const text = String(value);
      if (min !== null && text.length < min) issues.push(`${label} : minimum ${min} caractères`);
      if (max !== null && text.length > max) issues.push(`${label} : maximum ${max} caractères`);
      if (field.validation?.regex) {
        try {
          if (!new RegExp(field.validation.regex).test(text)) {
            issues.push(field.validation.message || `${label} : format invalide`);
          }
        } catch (_) { /* Invalid schema patterns are ignored consistently. */ }
      }
    } else if (field.type === 'integer' || field.type === 'number') {
      const number = Number(value);
      if (Number.isFinite(number)) {
        if (min !== null && number < min) issues.push(`${label} : minimum ${min}`);
        if (max !== null && number > max) issues.push(`${label} : maximum ${max}`);
      }
    } else if (field.type === 'array' && Array.isArray(value)) {
      if (min !== null && value.length < min) issues.push(`${label} : minimum ${min} élément(s)`);
      if (max !== null && value.length > max) issues.push(`${label} : maximum ${max} élément(s)`);
    }
    return issues;
  }

  function clampNumber(field, value) {
    let number = Number(value);
    if (!Number.isFinite(number)) return value;
    const min = getBound(field, 'min');
    const max = getBound(field, 'max');
    if (min !== null) number = Math.max(min, number);
    if (max !== null) number = Math.min(max, number);
    return field.type === 'integer' ? Math.round(number) : number;
  }

  function inputAttributes(field) {
    const attributes = {};
    const min = getBound(field, 'min');
    const max = getBound(field, 'max');
    if (field.type === 'integer' || field.type === 'number') {
      if (min !== null) attributes.min = min;
      if (max !== null) attributes.max = max;
    }
    if (field.type === 'string') {
      if (min !== null) attributes.minlength = min;
      if (max !== null) attributes.maxlength = max;
      if (field.validation?.regex) attributes.pattern = field.validation.regex;
    }
    return attributes;
  }

  global.FieldConstraints = { hasBound, getBound, isEmpty, getIssues, clampNumber, inputAttributes };
})(window);
