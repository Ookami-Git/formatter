/**
 * Schema and outputTemplate validator.
 * Validates JS syntax in template expressions and ensures structural integrity of template directives.
 */

function validateYamlSchema(schema, docPrefix = '') {
  const warnings = [];
  if (!schema || typeof schema !== 'object') {
    return warnings;
  }

  // 1. Validate fields if present (general schema checks could go here)
  
  // 2. Validate outputTemplate if present
  if (schema.outputTemplate) {
    validateOutputTemplate(schema.outputTemplate, warnings, 'outputTemplate', docPrefix);
  }

  return warnings;
}

function validateOutputTemplate(node, warnings, contextPath, docPrefix) {
  if (node === null || node === undefined) return;
  if (typeof node === 'boolean' || typeof node === 'number') return;

  const addWarning = (msg) => {
    const fullPrefix = docPrefix ? `${docPrefix} ` : '';
    warnings.push(`${fullPrefix}${msg}`);
  };

  if (typeof node === 'string') {
    validateExpressionsInString(node, addWarning, contextPath);
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      validateOutputTemplate(item, warnings, `${contextPath}[${index}]`, docPrefix);
    });
    return;
  }

  if (typeof node === 'object') {
    const keys = Object.keys(node);
    
    // Check for unrecognized keys starting with $
    const allowedDirectives = [
      '$repeat', '$item', '$key', '$merge', '$if', '$then', '$else', '$value'
    ];
    
    for (const key of keys) {
      if (key.startsWith('$') && !allowedDirectives.includes(key)) {
        addWarning(`${contextPath} : la directive "${key}" n'est pas reconnue par le moteur de template`);
      }
    }

    // 1. Directive $repeat
    if ('$repeat' in node) {
      if (!('$item' in node)) {
        addWarning(`${contextPath} : directive $repeat présente mais directive $item manquante`);
      }
      validateRawExpression(node.$repeat, addWarning, `${contextPath}.$repeat`);
    }

    // 2. Directive $key
    if ('$key' in node) {
      if (!('$repeat' in node)) {
        addWarning(`${contextPath} : directive $key présente mais directive $repeat manquante`);
      }
      if (typeof node.$key === 'string') {
        validateExpressionsInString(node.$key, addWarning, `${contextPath}.$key`);
      }
    }

    // 3. Directive $item
    if ('$item' in node) {
      if (!('$repeat' in node)) {
        addWarning(`${contextPath} : directive $item présente mais directive $repeat manquante`);
      }
      validateOutputTemplate(node.$item, warnings, `${contextPath}.$item`, docPrefix);
    }

    // 4. Directive $merge
    if ('$merge' in node) {
      if (!Array.isArray(node.$merge)) {
        addWarning(`${contextPath} : directive $merge doit contenir un tableau de blocs`);
      } else {
        validateOutputTemplate(node.$merge, warnings, `${contextPath}.$merge`, docPrefix);
      }
    }

    // 5. Directive $if
    if ('$if' in node) {
      if (!('$then' in node)) {
        addWarning(`${contextPath} : directive $if présente mais directive $then manquante`);
      }
      validateRawExpression(node.$if, addWarning, `${contextPath}.$if`);
    }

    // 6. Directive $then
    if ('$then' in node) {
      if (!('$if' in node)) {
        addWarning(`${contextPath} : directive $then présente mais directive $if manquante`);
      }
      validateOutputTemplate(node.$then, warnings, `${contextPath}.$then`, docPrefix);
    }

    // 7. Directive $else
    if ('$else' in node) {
      if (!('$if' in node)) {
        addWarning(`${contextPath} : directive $else présente mais directive $if manquante`);
      }
      validateOutputTemplate(node.$else, warnings, `${contextPath}.$else`, docPrefix);
    }

    // 8. Directive $value
    if ('$value' in node) {
      validateRawExpression(node.$value, addWarning, `${contextPath}.$value`);
    }

    // Validate non-directive keys and values
    for (const [key, value] of Object.entries(node)) {
      if (!key.startsWith('$')) {
        // The key itself can have interpolation
        validateExpressionsInString(key, addWarning, `${contextPath}.${key} (clé)`);
        validateOutputTemplate(value, warnings, `${contextPath}.${key}`, docPrefix);
      }
    }
  }
}

function validateExpressionsInString(str, addWarning, contextPath) {
  let idx = 0;
  while (idx < str.length) {
    const startIdx = str.indexOf('${', idx);
    if (startIdx === -1) {
      break;
    }
    
    // Find the matching '}'
    let depth = 1;
    let endIdx = startIdx + 2;
    let inQuotes = false;
    let quoteChar = null;
    
    while (depth > 0 && endIdx < str.length) {
      const char = str[endIdx];
      // Escaping check inside JS block
      if ((char === '"' || char === "'" || char === '`') && str[endIdx - 1] !== '\\') {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = null;
        }
      }
      
      if (!inQuotes) {
        if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
        }
      }
      if (depth > 0) {
        endIdx++;
      }
    }
    
    if (depth > 0) {
      addWarning(`${contextPath} : Accolade de fermeture manquante dans la chaîne "${str}"`);
      break;
    }
    
    const expr = str.substring(startIdx + 2, endIdx);
    
    // Validate JS syntax of the extracted expression
    try {
      new Function('__ctx__', `with(__ctx__){ return (${expr}); }`);
    } catch (e) {
      addWarning(`${contextPath} : Erreur de syntaxe JS dans l'expression \`\${${expr}}\` : ${e.message}`);
    }
    
    idx = endIdx + 1;
  }
}

function validateRawExpression(expr, addWarning, contextPath) {
  if (typeof expr !== 'string') return;
  
  // Try to parse/compile the raw expression as a JS expression
  try {
    new Function('__ctx__', `with(__ctx__){ return (${expr}); }`);
  } catch (e) {
    addWarning(`${contextPath} : Erreur de syntaxe JS dans l'expression \`${expr}\` : ${e.message}`);
  }
}

module.exports = {
  validateYamlSchema
};
