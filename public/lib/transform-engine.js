/**
 * Transform Engine — Moteur d'abstraction Input → Output
 *
 * Permet de dissocier les valeurs brutes du formulaire (Input) de la
 * structure finale générée (Output) en appliquant un `outputTemplate`
 * défini dans le schéma.
 *
 * Directives supportées dans le template :
 *   $repeat   — itère N fois (valeur d'un champ Input ou entier littéral)
 *   $item     — template d'un élément d'itération (utilisé avec $repeat)
 *   $key      — (optionnel) nom dynamique de la clé de chaque itération
 *   $merge    — fusionne un tableau de blocs (objets ou $repeat) en un seul dict
 *   $if       — condition d'inclusion d'un bloc (expression ou nom de champ)
 *   $then     — valeur à inclure si la condition est vraie
 *   $else     — valeur à inclure si la condition est fausse (optionnel)
 *   $value    — résolution directe d'une expression
 *   ${expr}   — interpolation d'expression dans les chaînes de caractères
 *
 * Variables disponibles dans les expressions d'interpolation :
 *   - Tous les champs Input (ex: ${env}, ${project})
 *   - $_index  : index 0-based de l'itération courante
 *   - $_count  : nombre total d'itérations
 *   - Accès imbriqué : ${disque_supplementaire.size}
 *   - Accès tableau  : ${lb_tools_az[_index % lb_tools_az.length]}
 *
 * @param {Object} formData       — Données brutes extraites du formulaire
 * @param {Object} outputTemplate — Template déclaratif issu du schéma
 * @returns {Object}              — Output transformé
 */
function transformOutput(formData, outputTemplate) {
  if (!outputTemplate || typeof outputTemplate !== 'object') {
    return formData;
  }

  try {
    const result = processNode(outputTemplate, { ...formData, _index: 0, _count: 0 });
    return (result !== null && result !== undefined) ? result : {};
  } catch (err) {
    console.error('[TransformEngine] Erreur de transformation :', err);
    return formData;
  }
}

/**
 * Traitement récursif d'un nœud du template.
 * Dispatch vers les handlers spécialisés selon les directives présentes.
 *
 * @param {*}      node    — Nœud du template (objet, string, number, boolean…)
 * @param {Object} context — Contexte courant (formData + variables d'itération)
 * @returns {*} Valeur résolue
 */
function processNode(node, context) {
  // Nœuds primitifs (non-objets)
  if (node === null || node === undefined) return node;
  if (typeof node === 'boolean') return node;
  if (typeof node === 'number') return node;

  // Interpolation des chaînes de caractères : "${expr}"
  if (typeof node === 'string') {
    return interpolateString(node, context);
  }

  // Tableaux : traiter chaque élément indépendamment
  if (Array.isArray(node)) {
    return node
      .map(item => processNode(item, context))
      .filter(item => item !== null && item !== undefined);
  }

  // Objet avec directives
  if (typeof node === 'object') {

    // Directive $repeat : itération
    if ('$repeat' in node) {
      return resolveIterator(node, context);
    }

    // Directive $merge : fusion de plusieurs blocs en un seul dictionnaire plat
    if ('$merge' in node) {
      return resolveMerge(node, context);
    }

    // Directive $if : inclusion conditionnelle
    if ('$if' in node) {
      return resolveConditional(node, context);
    }

    // Directive $value : résolution directe d'une expression
    if ('$value' in node) {
      const expr = node.$value;
      return evaluate(String(expr), context);
    }

    // Objet ordinaire : résoudre récursivement chaque clé
    const result = {};
    for (const [key, value] of Object.entries(node)) {
      const resolvedKey = interpolateString(key, context);
      const resolvedValue = processNode(value, context);

      // Exclure les valeurs null/undefined générées par des conditions non remplies
      if (resolvedValue !== null && resolvedValue !== undefined) {
        result[resolvedKey] = resolvedValue;
      }
    }
    return result;
  }

  return node;
}

/**
 * Résout une directive $repeat.
 *
 * Formats supportés :
 *   $repeat: "fieldName"   → utilise la valeur entière du champ
 *   $repeat: 3             → littéral entier
 *   $repeat: "${expr}"     → expression évaluée
 *
 * Si $key est présent → retourne un objet { computed_key: item }
 * Sinon              → retourne un tableau [ item1, item2, ... ]
 *
 * @param {Object} node    — Nœud contenant $repeat et $item
 * @param {Object} context — Contexte courant
 * @returns {Array|Object} — Résultat de l'itération
 */
function resolveIterator(node, context) {
  const repeatSpec = node.$repeat;
  const itemTemplate = node.$item;
  const keyTemplate = node.$key || null;

  if (itemTemplate === undefined) {
    console.warn('[TransformEngine] $repeat sans $item — ignoré');
    return null;
  }

  // Résoudre le nombre d'itérations
  let count = 0;
  if (typeof repeatSpec === 'number') {
    count = Math.max(0, Math.floor(repeatSpec));
  } else if (typeof repeatSpec === 'string') {
    // Peut être un nom de champ direct ou une interpolation
    const resolved = evaluate(repeatSpec, context);
    count = Math.max(0, Math.floor(Number(resolved) || 0));
  }

  if (count === 0) return [];

  const useObjectOutput = keyTemplate !== null;

  if (useObjectOutput) {
    // Mode dictionnaire : { clé_calculée: item, ... }
    const result = {};
    for (let i = 0; i < count; i++) {
      const iterContext = { ...context, _index: i, _count: count };
      const computedKey = interpolateString(String(keyTemplate), iterContext);
      const resolvedItem = processNode(itemTemplate, iterContext);
      if (resolvedItem !== null && resolvedItem !== undefined) {
        result[computedKey] = resolvedItem;
      }
    }
    return result;
  } else {
    // Mode tableau : [ item1, item2, ... ]
    const result = [];
    for (let i = 0; i < count; i++) {
      const iterContext = { ...context, _index: i, _count: count };
      const resolvedItem = processNode(itemTemplate, iterContext);
      if (resolvedItem !== null && resolvedItem !== undefined) {
        result.push(resolvedItem);
      }
    }
    return result;
  }
}

/**
 * Résout une directive $merge.
 *
 * Fusionne un tableau de blocs (chacun pouvant être un $repeat ou un objet
 * ordinaire) en un seul dictionnaire plat. Utile pour combiner plusieurs
 * boucles d'itération dans un même objet de sortie.
 *
 * Format :
 *   $merge:
 *     - $repeat: fieldName
 *       $key: "${expr}"
 *       $item: { ... }
 *     - $repeat: otherField
 *       $key: "${expr}"
 *       $item: { ... }
 *
 * @param {Object} node    — Nœud contenant $merge (tableau de blocs)
 * @param {Object} context — Contexte courant
 * @returns {Object}       — Dictionnaire fusionné
 */
function resolveMerge(node, context) {
  const blocks = node.$merge;

  if (!Array.isArray(blocks)) {
    console.warn('[TransformEngine] $merge attend un tableau de blocs — ignoré');
    return null;
  }

  const result = {};
  for (const block of blocks) {
    const resolved = processNode(block, context);
    // On ne fusionne que les objets (dict de clés)
    if (resolved !== null && resolved !== undefined && typeof resolved === 'object' && !Array.isArray(resolved)) {
      Object.assign(result, resolved);
    }
  }
  return result;
}

/**
 * Résout une directive $if/$then/$else.
 *
 * Formats supportés pour $if :
 *   $if: "fieldName"        → true si le champ est truthy
 *   $if: "${expr}"          → expression évaluée
 *   $if: "fieldName != ''"  → expression JS complète
 *
 * @param {Object} node    — Nœud contenant $if, $then, et optionnellement $else
 * @param {Object} context — Contexte courant
 * @returns {*} Valeur de $then, $else, ou null si condition non remplie
 */
function resolveConditional(node, context) {
  const condition = node.$if;
  const thenBranch = node.$then;
  const elseBranch = node.$else !== undefined ? node.$else : null;

  // Évaluer la condition
  let conditionMet = false;
  if (typeof condition === 'boolean') {
    conditionMet = condition;
  } else if (typeof condition === 'string') {
    // Si la chaîne ne contient pas d'opérateurs, on teste la valeur du champ directement
    const isSimpleFieldName = /^[\w_$][\w_$\d.]*$/.test(condition.trim());
    if (isSimpleFieldName) {
      // Accès imbriqué (ex: "disque_supplementaire" ou "disque_supplementaire.size")
      const val = resolvePath(condition.trim(), context);
      conditionMet = isTruthy(val);
    } else {
      // Expression JS complète
      const evaluated = evaluate(condition, context);
      conditionMet = isTruthy(evaluated);
    }
  } else if (typeof condition === 'number') {
    conditionMet = condition !== 0;
  }

  if (conditionMet) {
    return thenBranch !== undefined ? processNode(thenBranch, context) : true;
  } else {
    return elseBranch !== null ? processNode(elseBranch, context) : null;
  }
}

/**
 * Interpole les expressions `${...}` dans une chaîne de caractères.
 * Si la chaîne entière est une seule expression `${expr}`, retourne
 * directement la valeur évaluée (peut être non-string).
 *
 * Exemples :
 *   "${env}-vm${_index + 1}"  → "prod-vm1"
 *   "${worker_count}"         → 3 (number, pas "3")
 *
 * @param {string} str     — Chaîne à interpoler
 * @param {Object} context — Contexte d'évaluation
 * @returns {*} Chaîne interpolée ou valeur directe
 */
function interpolateString(str, context) {
  if (typeof str !== 'string') return str;

  // Détecter si toute la chaîne est une seule expression ${...} (sans texte autour)
  // On utilise un compteur de profondeur pour gérer les accolades imbriquées.
  if (str.startsWith('${') && str.endsWith('}')) {
    // Vérifier qu'il n'y a qu'une seule expression ${...} englobant toute la chaîne
    let depth = 0;
    let onlyOneExpr = true;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '{' && i > 0 && str[i - 1] === '$') {
        depth++;
      } else if (str[i] === '{') {
        depth++;
      } else if (str[i] === '}') {
        depth--;
        // Si la profondeur revient à 0 avant la fin de la chaîne, ce n'est pas une expression unique
        if (depth === 0 && i < str.length - 1) {
          onlyOneExpr = false;
          break;
        }
      }
    }
    if (onlyOneExpr && depth === 0) {
      // Extraire le contenu intérieur : retire le "${" de début et le "}" de fin
      const innerExpr = str.slice(2, -1);
      return evaluate(innerExpr, context);
    }
  }

  // Interpolation mixte : remplacer chaque ${...} par sa valeur stringifiée
  // Le regex utilise un lookahead négatif pour ne pas consommer les accolades imbriquées
  return str.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const val = evaluate(expr.trim(), context);
    return val !== null && val !== undefined ? String(val) : '';
  });
}

/**
 * Évalue une expression JavaScript dans un contexte sandboxé.
 * Les variables du contexte sont directement accessibles par leur nom.
 *
 * Exemples d'expressions :
 *   "env"                        → context.env
 *   "_index + 1"                 → 1 (pour _index = 0)
 *   "disque_supplementaire.size" → valeur imbriquée
 *   "env === 'prod' ? 'x' : 'y'"→ expression ternaire
 *
 * @param {string} expr    — Expression JS à évaluer
 * @param {Object} context — Variables disponibles
 * @returns {*} Résultat de l'évaluation, ou undefined en cas d'erreur
 */
function evaluate(expr, context) {
  // Raccourci : accès direct à une propriété simple (sans opérateurs)
  const isSimplePath = /^[\w_$][\w_$\d.]*$/.test(expr.trim());
  if (isSimplePath) {
    return resolvePath(expr.trim(), context);
  }

  // Expression complexe : évaluation sandboxée via new Function
  try {
    const argNames = Object.keys(context);
    const argValues = Object.values(context);

    // Proxy pour éviter les ReferenceError sur les variables non définies
    const safeContext = new Proxy(context, {
      has() { return true; },
      get(target, key) {
        if (key === Symbol.unscopables) return undefined;
        return target[key];
      }
    });

    const fn = new Function('__ctx__', `
      with (__ctx__) {
        try { return (${expr}); } catch(e) { return undefined; }
      }
    `);
    return fn(safeContext);
  } catch (err) {
    console.warn('[TransformEngine] Erreur d\'évaluation de l\'expression :', expr, err.message);
    return undefined;
  }
}

/**
 * Résout un chemin pointé (ex: "a.b.c") dans un objet.
 *
 * @param {string} path    — Chemin sous forme "a.b.c"
 * @param {Object} context — Objet source
 * @returns {*} Valeur à ce chemin, ou undefined
 */
function resolvePath(path, context) {
  const parts = path.split('.');
  let current = context;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Détermine si une valeur est "truthy" au sens du moteur de template.
 * Un objet vide {}, un tableau vide [], null, undefined, 0 et false sont falsy.
 *
 * @param {*} val — Valeur à tester
 * @returns {boolean}
 */
function isTruthy(val) {
  if (val === null || val === undefined || val === false || val === 0 || val === '') {
    return false;
  }
  if (Array.isArray(val) && val.length === 0) return false;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) {
    return false;
  }
  return true;
}

// Export conditionnel : Node.js (tests) ou navigateur (global)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { transformOutput, processNode, interpolateString, evaluate, resolvePath, isTruthy, resolveMerge };
}
