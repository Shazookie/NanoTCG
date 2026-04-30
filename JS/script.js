/* =========================================================
   Nano's Ascension - shared script (v2: collection-driven)
   Implements:
     1. Open card packs        (Must)
     2. Create battle decks    (Must) - restricted to owned variants
     3. Card flipping          (Nice)
     4. Variants w/ rarities   (Should) - persisted per pull
     5. Rarities affect stats  (Nice)   - mult shown base->boosted
     6. Expansions             (Must)
     7. Advanced search        (Must)
     8. Dark mode toggle       (Should)
     9. Favorite card on home  (Nice) - restricted to owned
    10. Collection -> storage  (Should) - per (cardId, variant) stacks
   ========================================================= */

(function () {
  'use strict';

  /* ====== CONFIG ====== */
  const DATA_URL = 'media/cards.json';
  const PACK_SIZE = 5;
  const DEFAULT_EXPANSION = 'Nano Origins';

  // v2 storage - schema changed, old keys are wiped on first load
  const STORAGE = {
    migrated:   'nano.v2.migrated',
    theme:      'nano.theme',
    collection: 'nano.collection.v2', // { "cardId:variantName": stack }
    decks:      'nano.decks.v2',      // [ { name, cards: [{cardId, variantName, count}] } ]
    favorite:   'nano.favorite.v2',   // { cardId, variantName } | null
  };

  // Pack-pull variant rolls. Multipliers shown explicitly on card backs.
  const VARIANTS = [
    { name: 'Standard', mult: 1.00, weight: 70 },
    { name: 'Foil',     mult: 1.10, weight: 22 },
    { name: 'Holo',     mult: 1.25, weight:  7 },
    { name: 'Etched',   mult: 1.50, weight:  1 },
  ];

  // Per-slot rarity weights for pack opening.
  const PACK_RARITY_WEIGHTS = [
    { rarity: 'Common',   weight: 60 },
    { rarity: 'Uncommon', weight: 28 },
    { rarity: 'Rare',     weight: 12 },
  ];

  // Patch JSON-side image paths without rewriting the data file.
  const IMAGE_FIXUPS = {
    'media/images/treat-salmon.png': 'media/images/treat-slamon.png',
  };

  /* ====== STATE ====== */
  let cards = [];
  let cardsById = new Map();

  /* ====== UTILS ====== */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c])));

  const read = (k, fb) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; }
    catch { return fb; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  function weightedPick(items, weightFn) {
    const total = items.reduce((s, i) => s + weightFn(i), 0);
    let r = Math.random() * total;
    for (const it of items) {
      r -= weightFn(it);
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  function variantByName(name) {
    if (!name) return null;
    return VARIANTS.find((v) => v.name === name) || null;
  }

  function normalizeImage(path) {
    if (!path) return '';
    let p = path;
    if (p.startsWith('media/') && !p.startsWith('media/images/')) {
      p = p.replace(/^media\//, 'media/images/');
    }
    if (IMAGE_FIXUPS[p]) p = IMAGE_FIXUPS[p];
    return p;
  }

  function rarityKey(r) { return (r || 'Common').toLowerCase(); }
  function rarityRank(r) {
    return ({ common: 1, uncommon: 2, rare: 3, mythic: 4 })[rarityKey(r)] || 0;
  }
  function variantKey(v) { return (v || 'Standard').toLowerCase(); }
  function stackKey(cardId, variantName) { return cardId + ':' + (variantName || 'Standard'); }

  /* ====== STORAGE MIGRATION ====== */
  function migrateStorage() {
    if (read(STORAGE.migrated, false)) return;
    // v1 keys are obsolete - wipe.
    try {
      localStorage.removeItem('nano.collection');
      localStorage.removeItem('nano.decks');
      localStorage.removeItem('nano.favorite');
    } catch {}
    write(STORAGE.migrated, true);
  }

  /* ====== DATA LOADING ====== */
  async function loadCards() {
    if (cards.length) return cards;
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('Failed to load cards.json (' + res.status + ')');
    const raw = await res.json();
    cards = raw.map((c) => ({
      ...c,
      image: normalizeImage(c.image),
      expansion: c.expansion || DEFAULT_EXPANSION,
    }));
    cardsById = new Map(cards.map((c) => [c.id, c]));
    return cards;
  }

  /* ====== THEME ====== */
  function applyTheme(theme) {
    document.documentElement.classList.toggle('theme-light', theme === 'light');
    $$('.theme-toggle').forEach((b) => b.setAttribute('aria-pressed', String(theme === 'light')));
  }
  function initTheme() {
    const t = read(STORAGE.theme, 'dark');
    applyTheme(t);
    $$('.theme-toggle').forEach((b) => {
      b.addEventListener('click', () => {
        const cur = read(STORAGE.theme, 'dark');
        const next = cur === 'light' ? 'dark' : 'light';
        write(STORAGE.theme, next);
        applyTheme(next);
      });
    });
  }

  /* ====== COLLECTION (per-variant stacks) ====== */
  function getCollection() { return read(STORAGE.collection, {}); }
  function setCollection(col) { write(STORAGE.collection, col); }

  function addToCollection(cardId, variantName) {
    const col = getCollection();
    const k = stackKey(cardId, variantName);
    const stack = col[k] || { cardId, variantName: variantName || 'Standard', count: 0 };
    stack.count = (stack.count || 0) + 1;
    stack.lastPulled = Date.now();
    col[k] = stack;
    setCollection(col);
  }

  function getOwnedCount(cardId, variantName) {
    const col = getCollection();
    const k = stackKey(cardId, variantName);
    return col[k]?.count || 0;
  }

  function getCollectionStacks() {
    return Object.values(getCollection());
  }
  function getTotalPulls() {
    return getCollectionStacks().reduce((s, st) => s + (st.count || 0), 0);
  }
  function getUniqueCount() {
    // unique = distinct cardIds owned (any variant)
    return new Set(getCollectionStacks().map((s) => s.cardId)).size;
  }

  /* ====== FAVORITE ====== */
  function getFavorite() { return read(STORAGE.favorite, null); }
  function setFavorite(cardId, variantName) {
    write(STORAGE.favorite, { cardId, variantName: variantName || 'Standard' });
  }

  /* ====== DECKS ====== */
  function getDecks() { return read(STORAGE.decks, []); }
  function saveDecks(decks) { write(STORAGE.decks, decks); }

  function deckCount(deck, cardId, variantName) {
    const k = stackKey(cardId, variantName);
    const e = deck.cards.find((c) => stackKey(c.cardId, c.variantName) === k);
    return e?.count || 0;
  }
  function deckTotalCards(deck) {
    return deck.cards.reduce((s, c) => s + (c.count || 0), 0);
  }
  function deckAdd(deck, cardId, variantName) {
    const owned = getOwnedCount(cardId, variantName);
    const cur = deckCount(deck, cardId, variantName);
    if (cur >= owned) return false;
    const k = stackKey(cardId, variantName);
    const idx = deck.cards.findIndex((c) => stackKey(c.cardId, c.variantName) === k);
    if (idx >= 0) deck.cards[idx].count += 1;
    else deck.cards.push({ cardId, variantName: variantName || 'Standard', count: 1 });
    return true;
  }
  function deckRemove(deck, cardId, variantName) {
    const k = stackKey(cardId, variantName);
    const idx = deck.cards.findIndex((c) => stackKey(c.cardId, c.variantName) === k);
    if (idx < 0) return;
    deck.cards[idx].count -= 1;
    if (deck.cards[idx].count <= 0) deck.cards.splice(idx, 1);
  }

  /* ====== CARD COMPONENT ====== */
  /*
    opts:
      variantName : string (optional). If set and not 'Standard', applies multiplier and shows variant pip + animated overlay.
      mini        : compact size
      showFavorite: include "Set as Favorite" button on the back
      showOwned   : show "Owned xN" badge on the back (catalog use)
      caption     : optional caption rendered below the card (used in pack reveal)
      onFlip      : callback when flip state changes
  */
  function buildCard(card, opts = {}) {
    const {
      variantName,
      mini = false,
      showFavorite = false,
      showOwned = false,
      caption,
    } = opts;

    const variant = variantByName(variantName) || null;
    const isVariant = variant && variant.name !== 'Standard';
    const mult = variant ? variant.mult : 1;
    const baseAtk = card.attack;
    const baseDef = card.defense;
    const finalAtk = baseAtk != null ? Math.round(baseAtk * mult) : null;
    const finalDef = baseDef != null ? Math.round(baseDef * mult) : null;
    const ownedCount = getOwnedCount(card.id, variant ? variant.name : 'Standard');
    const totalOwned = card.id != null
      ? VARIANTS.reduce((s, v) => s + getOwnedCount(card.id, v.name), 0)
      : 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'card-wrapper';

    const el = document.createElement('article');
    el.className = [
      'card',
      'rarity-' + rarityKey(card.rarity),
      mini ? 'card-mini' : '',
      isVariant ? 'variant-' + variantKey(variant.name) : '',
    ].filter(Boolean).join(' ');
    el.dataset.cardId = card.id;
    if (variant) el.dataset.variant = variant.name;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute(
      'aria-label',
      card.name + (isVariant ? ' (' + variant.name + ')' : '') + ' - press to flip'
    );

    /* Variant pip on front */
    const pipHTML = isVariant
      ? '<span class="variant-pip variant-pip-' + variantKey(variant.name) + '" title="' + esc(variant.name) + ' x' + variant.mult + '">' + variant.name[0] + '</span>'
      : '';

    /* Stat block on back */
    let statsHTML = '';
    if (baseAtk != null || baseDef != null) {
      const renderStat = (label, base, final) => {
        if (base == null) return '';
        if (isVariant && final !== base) {
          const pct = Math.round((mult - 1) * 100);
          return (
            '<div class="stat-row stat-boosted">'
            + '<span class="stat-label">' + label + '</span>'
            + '<span class="stat-base">' + base + '</span>'
            + '<span class="stat-arrow" aria-hidden="true">&rarr;</span>'
            + '<span class="stat-final">' + final + '</span>'
            + '<span class="stat-bonus">+' + pct + '%</span>'
            + '</div>'
          );
        }
        return (
          '<div class="stat-row">'
          + '<span class="stat-label">' + label + '</span>'
          + '<span class="stat-value">' + base + '</span>'
          + '</div>'
        );
      };
      statsHTML = '<div class="stats-block">'
        + renderStat('ATK', baseAtk, finalAtk)
        + renderStat('DEF', baseDef, finalDef)
        + '</div>';
    }

    /* Tags row */
    const tagsHTML = '<div class="card-tags">'
      + '<span class="tag tag-type">' + esc(card.type) + '</span>'
      + '<span class="tag tag-rarity rarity-' + rarityKey(card.rarity) + '">' + esc(card.rarity || 'Common') + '</span>'
      + (isVariant ? '<span class="tag tag-variant variant-' + variantKey(variant.name) + '">' + esc(variant.name) + ' &times;' + variant.mult.toFixed(2) + '</span>' : '')
      + '</div>';

    /* Owned badge */
    const ownedHTML = showOwned && totalOwned > 0
      ? '<span class="owned-badge">Owned &times;' + totalOwned + '</span>'
      : (showOwned ? '<span class="owned-badge owned-zero">Not pulled yet</span>' : '');

    /* Favorite button */
    const favBtnHTML = showFavorite
      ? '<button class="btn btn-mini btn-favorite" type="button">&#9733; Set as Favorite</button>'
      : '';

    el.innerHTML =
      '<div class="card-inner">'
        + '<div class="card-face card-front">'
          + '<img class="card-img" alt="' + esc(card.name) + '" src="' + esc(card.image) + '">'
          + pipHTML
          + '<span class="flip-hint" aria-hidden="true">Flip</span>'
        + '</div>'
        + '<div class="card-face card-back">'
          + '<header class="card-back-head">'
            + '<h3 class="card-name">' + esc(card.name) + '</h3>'
            + '<span class="card-cost" title="Treat Cost">' + (card.treatCost ?? '-') + '</span>'
          + '</header>'
          + (card.role ? '<div class="card-role">' + esc(card.role) + '</div>' : '')
          + tagsHTML
          + statsHTML
          + (card.rulesText ? '<h4 class="card-section">Rules</h4><p class="card-rules">' + esc(card.rulesText) + '</p>' : '')
          + (card.flavorText ? '<p class="card-flavor">' + esc(card.flavorText) + '</p>' : '')
          + (card.details ? '<h4 class="card-section">Strategy</h4><p class="card-details">' + esc(card.details) + '</p>' : '')
          + '<footer class="card-back-foot">'
            + '<span>' + esc(card.expansion) + '</span>'
            + '<span>#' + card.id + '</span>'
            + ownedHTML
          + '</footer>'
          + (favBtnHTML ? '<div class="card-actions">' + favBtnHTML + '</div>' : '')
        + '</div>'
      + '</div>';

    /* image error fallback */
    const img = $('.card-img', el);
    img.addEventListener('error', () => {
      const fb = document.createElement('div');
      fb.className = 'card-art-fallback';
      const initials = card.name.split(/\s+/).map((w) => w[0] || '').slice(0, 2).join('');
      fb.textContent = initials.toUpperCase();
      img.replaceWith(fb);
    });

    /* flip on click / keyboard */
    el.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input')) return;
      el.classList.toggle('is-flipped');
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.classList.toggle('is-flipped');
      }
    });

    /* favorite */
    const favBtn = $('.btn-favorite', el);
    if (favBtn) {
      favBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setFavorite(card.id, variant ? variant.name : 'Standard');
        favBtn.textContent = '★ Favorited';
        favBtn.classList.add('is-favorited');
        setTimeout(() => {
          favBtn.classList.remove('is-favorited');
          favBtn.innerHTML = '★ Set as Favorite';
        }, 1500);
      });
    }

    wrapper.appendChild(el);

    if (caption) {
      const cap = document.createElement('div');
      cap.className = 'card-caption';
      cap.innerHTML = caption;
      wrapper.appendChild(cap);
    }

    return wrapper;
  }

  /* ====== PACK OPENING ====== */
  function rollVariant() { return weightedPick(VARIANTS, (v) => v.weight); }

  function rollPack(expansionFilter) {
    const pool = cards.filter((c) => {
      if (!c.cardCount || c.cardCount <= 0) return false;
      if (expansionFilter && c.expansion !== expansionFilter) return false;
      return true;
    });
    const fallback = pool.length ? pool : cards;
    const result = [];
    for (let i = 0; i < PACK_SIZE; i++) {
      const targetRarity = weightedPick(PACK_RARITY_WEIGHTS, (r) => r.weight).rarity;
      const matches = fallback.filter((c) => (c.rarity || 'Common') === targetRarity);
      const chosen = matches.length
        ? matches[Math.floor(Math.random() * matches.length)]
        : fallback[Math.floor(Math.random() * fallback.length)];
      result.push({ card: chosen, variant: rollVariant() });
    }
    return result;
  }

  function openPackModal(expansionFilter) {
    if (!cards.length) return;
    const pulls = rollPack(expansionFilter);
    pulls.forEach((p) => addToCollection(p.card.id, p.variant.name));

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-content">'
        + '<div class="modal-head">'
          + '<h2>Pack Opened' + (expansionFilter ? ' &mdash; ' + esc(expansionFilter) : '') + '</h2>'
          + '<button class="modal-close" aria-label="Close">&times;</button>'
        + '</div>'
        + '<p class="modal-sub">Click any card to flip and read the rules. New pulls are saved to your collection.</p>'
        + '<div class="pack-grid"></div>'
        + '<div class="modal-foot">'
          + '<span class="muted">Variant multipliers: Foil &times;1.10, Holo &times;1.25, Etched &times;1.50.</span>'
          + '<button class="btn btn-secondary modal-close-bottom">Done</button>'
        + '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    const grid = $('.pack-grid', overlay);
    pulls.forEach((p, i) => {
      const captionParts = [
        '<strong>' + esc(p.card.name) + '</strong>',
        esc(p.card.rarity || 'Common'),
      ];
      if (p.variant.name !== 'Standard') {
        captionParts.push('<span class="caption-variant variant-' + variantKey(p.variant.name) + '">' + esc(p.variant.name) + '</span>');
      }
      const wrap = buildCard(p.card, {
        variantName: p.variant.name,
        showFavorite: true,
        caption: captionParts.join(' &middot; '),
      });
      const cardEl = wrap.querySelector('.card');
      cardEl.style.animationDelay = (i * 0.12) + 's';
      cardEl.classList.add('reveal');
      grid.appendChild(wrap);
    });

    function close() {
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 200);
      document.removeEventListener('keydown', escClose);
    }
    function escClose(e) { if (e.key === 'Escape') close(); }
    $('.modal-close', overlay).addEventListener('click', close);
    $('.modal-close-bottom', overlay).addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', escClose);

    updateHeaderCounts();
    refreshAllPagesPostPull();
  }

  function initPackButtons() {
    $$('[data-action="open-pack"]').forEach((b) => {
      b.addEventListener('click', () => openPackModal(b.dataset.expansion || null));
    });
  }

  /* refresh dynamic sections after a pack opens (home recent pulls, deck builder collection) */
  function refreshAllPagesPostPull() {
    if (typeof renderHome === 'function') renderHome();
    if (typeof renderBattleAll === 'function') renderBattleAll();
    if (typeof renderExpansionsAll === 'function') renderExpansionsAll();
  }
  let renderHome = null;
  let renderBattleAll = null;
  let renderExpansionsAll = null;

  /* ====== HEADER COUNTS ====== */
  function updateHeaderCounts() {
    const total = getTotalPulls();
    const unique = getUniqueCount();
    $$('.collection-count').forEach((el) => { el.textContent = total; });
    $$('.unique-count').forEach((el) => { el.textContent = unique; });
  }

  /* ====== HOME PAGE ====== */
  function initHomePage() {
    if (!document.body.classList.contains('page-home')) return;

    const favSlot = $('#favorite-card');
    const recent = $('#recent-pulls');
    const recentEmpty = $('#recent-empty');

    renderHome = function () {
      // Favorite slot
      if (favSlot) {
        const fav = getFavorite();
        favSlot.innerHTML = '';
        const card = fav && cardsById.get(fav.cardId);
        const owned = fav ? getOwnedCount(fav.cardId, fav.variantName) : 0;
        if (card && owned > 0) {
          favSlot.appendChild(buildCard(card, { variantName: fav.variantName }));
        } else {
          favSlot.innerHTML = '<p class="muted">No favorite yet. Flip a card you own and tap "Set as Favorite."</p>';
        }
      }
      // Recent pulls
      if (recent && recentEmpty) {
        const stacks = getCollectionStacks().slice().sort((a, b) => (b.lastPulled || 0) - (a.lastPulled || 0));
        recent.innerHTML = '';
        if (!stacks.length) {
          recent.style.display = 'none';
          recentEmpty.style.display = 'block';
        } else {
          recent.style.display = '';
          recentEmpty.style.display = 'none';
          stacks.slice(0, 4).forEach((st) => {
            const c = cardsById.get(st.cardId);
            if (!c) return;
            recent.appendChild(buildCard(c, { variantName: st.variantName, mini: true }));
          });
        }
      }
    };
    renderHome();
  }

  /* ====== EXPANSIONS PAGE ====== */
  function initExpansionsPage() {
    const grid = $('#card-grid');
    if (!grid) return;

    const search = $('#search-input');
    const typeSel = $('#filter-type');
    const raritySel = $('#filter-rarity');
    const expSel = $('#filter-expansion');
    const minCost = $('#filter-min-cost');
    const maxCost = $('#filter-max-cost');
    const minAtk = $('#filter-min-atk');
    const minDef = $('#filter-min-def');
    const sortSel = $('#sort-by');
    const ownedToggle = $('#filter-owned-only');
    const resetBtn = $('#reset-filters');
    const counter = $('#result-count');
    const expansionPackBtn = $('#expansion-pack-btn');

    const types = Array.from(new Set(cards.map((c) => c.type))).filter(Boolean).sort();
    const rarities = Array.from(new Set(cards.map((c) => c.rarity || 'Common'))).filter(Boolean).sort((a, b) => rarityRank(a) - rarityRank(b));
    const expansions = Array.from(new Set(cards.map((c) => c.expansion))).sort();

    function fillOpts(sel, opts) {
      if (!sel) return;
      opts.forEach((o) => {
        const el = document.createElement('option');
        el.value = o; el.textContent = o;
        sel.appendChild(el);
      });
    }
    fillOpts(typeSel, types);
    fillOpts(raritySel, rarities);
    fillOpts(expSel, expansions);

    if (expSel && expansionPackBtn) {
      expSel.addEventListener('change', () => {
        const v = expSel.value;
        if (v) {
          expansionPackBtn.dataset.expansion = v;
          expansionPackBtn.textContent = 'Open ' + v + ' Pack';
        } else {
          delete expansionPackBtn.dataset.expansion;
          expansionPackBtn.textContent = 'Open Random Pack';
        }
      });
      expansionPackBtn.addEventListener('click', () => {
        openPackModal(expansionPackBtn.dataset.expansion || null);
      });
    }

    function render() {
      const q = (search?.value || '').trim().toLowerCase();
      const t = typeSel?.value || '';
      const r = raritySel?.value || '';
      const e = expSel?.value || '';
      const minC = minCost?.value !== '' && minCost?.value != null ? parseInt(minCost.value, 10) : null;
      const maxC = maxCost?.value !== '' && maxCost?.value != null ? parseInt(maxCost.value, 10) : null;
      const minA = minAtk?.value !== '' && minAtk?.value != null ? parseInt(minAtk.value, 10) : null;
      const minD = minDef?.value !== '' && minDef?.value != null ? parseInt(minDef.value, 10) : null;
      const sort = sortSel?.value || 'name';
      const ownedOnly = !!ownedToggle?.checked;

      let list = cards.filter((c) => {
        if (t && c.type !== t) return false;
        if (r && (c.rarity || 'Common') !== r) return false;
        if (e && c.expansion !== e) return false;
        if (minC != null && !Number.isNaN(minC) && (c.treatCost || 0) < minC) return false;
        if (maxC != null && !Number.isNaN(maxC) && (c.treatCost || 0) > maxC) return false;
        if (minA != null && !Number.isNaN(minA) && (c.attack || 0) < minA) return false;
        if (minD != null && !Number.isNaN(minD) && (c.defense || 0) < minD) return false;
        if (ownedOnly) {
          const total = VARIANTS.reduce((s, v) => s + getOwnedCount(c.id, v.name), 0);
          if (total <= 0) return false;
        }
        if (q) {
          const hay = [c.name, c.type, c.role, c.rulesText, c.flavorText, c.details, c.rarity, c.expansion]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      const sorters = {
        name: (a, b) => a.name.localeCompare(b.name),
        cost: (a, b) => (a.treatCost || 0) - (b.treatCost || 0),
        attack: (a, b) => (b.attack || 0) - (a.attack || 0),
        defense: (a, b) => (b.defense || 0) - (a.defense || 0),
        rarity: (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity),
      };
      list.sort(sorters[sort] || sorters.name);

      grid.innerHTML = '';
      if (!list.length) {
        grid.innerHTML = '<p class="empty-state">No cards match those filters.</p>';
      } else {
        list.forEach((c) => {
          const totalOwned = VARIANTS.reduce((s, v) => s + getOwnedCount(c.id, v.name), 0);
          const showFav = totalOwned > 0;
          grid.appendChild(buildCard(c, { showFavorite: showFav, showOwned: true }));
        });
      }
      if (counter) counter.textContent = list.length;
    }

    [search, typeSel, raritySel, expSel, minCost, maxCost, minAtk, minDef, sortSel, ownedToggle].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        [search, minCost, maxCost, minAtk, minDef].forEach((el) => { if (el) el.value = ''; });
        [typeSel, raritySel, expSel, sortSel].forEach((el) => { if (el) el.selectedIndex = 0; });
        if (ownedToggle) ownedToggle.checked = false;
        render();
      });
    }

    renderExpansionsAll = render;
    render();
  }

  /* ====== BATTLE / DECK BUILDER ====== */
  function initBattlePage() {
    const root = $('#deck-builder');
    if (!root) return;

    const decksEl = $('#decks-list');
    const deckCardsEl = $('#deck-cards');
    const deckNameEl = $('#deck-name');
    const collectionEl = $('#collection-cards');
    const browseSearch = $('#browse-search');
    const browseType = $('#browse-type');
    const newDeckBtn = $('#new-deck');
    const saveDeckBtn = $('#save-deck');
    const deleteDeckBtn = $('#delete-deck');
    const deckStatsEl = $('#deck-stats');
    const collectionEmpty = $('#collection-empty');

    let activeDeck = { name: 'New Deck', cards: [] };

    function renderDecks() {
      const decks = getDecks();
      decksEl.innerHTML = '';
      if (!decks.length) {
        decksEl.innerHTML = '<li class="muted">No saved decks yet.</li>';
        return;
      }
      decks.forEach((d, i) => {
        const li = document.createElement('li');
        li.className = 'deck-item';
        const btn = document.createElement('button');
        btn.className = 'deck-item-btn';
        btn.dataset.i = String(i);
        btn.innerHTML = esc(d.name) + '<span class="muted"> &middot; ' + deckTotalCards(d) + ' cards</span>';
        btn.addEventListener('click', () => {
          activeDeck = JSON.parse(JSON.stringify(d));
          renderActiveDeck();
        });
        li.appendChild(btn);
        decksEl.appendChild(li);
      });
    }

    function renderActiveDeck() {
      deckNameEl.value = activeDeck.name;
      deckCardsEl.innerHTML = '';
      if (!activeDeck.cards.length) {
        deckCardsEl.innerHTML = '<p class="muted">Deck is empty. Add cards from your collection on the right.</p>';
      } else {
        // sort by cost asc, name
        const sorted = activeDeck.cards.slice().sort((a, b) => {
          const ca = cardsById.get(a.cardId), cb = cardsById.get(b.cardId);
          if (!ca || !cb) return 0;
          return (ca.treatCost || 0) - (cb.treatCost || 0)
            || rarityRank(cb.rarity) - rarityRank(ca.rarity)
            || ca.name.localeCompare(cb.name);
        });
        sorted.forEach((entry) => {
          const c = cardsById.get(entry.cardId);
          if (!c) return;
          for (let i = 0; i < entry.count; i++) {
            const wrap = buildCard(c, { variantName: entry.variantName, mini: true });
            const cardEl = wrap.querySelector('.card');
            const removeBtn = document.createElement('button');
            removeBtn.className = 'card-remove';
            removeBtn.type = 'button';
            removeBtn.innerHTML = '&minus;';
            removeBtn.setAttribute('aria-label', 'Remove from deck');
            removeBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              deckRemove(activeDeck, entry.cardId, entry.variantName);
              renderActiveDeck();
              renderCollection();
            });
            cardEl.appendChild(removeBtn);
            deckCardsEl.appendChild(wrap);
          }
        });
      }
      renderDeckStats();
    }

    function renderDeckStats() {
      const total = deckTotalCards(activeDeck);
      const inDeck = activeDeck.cards.flatMap((e) => {
        const c = cardsById.get(e.cardId);
        return c ? Array(e.count).fill(c) : [];
      });
      const totalCost = inDeck.reduce((s, c) => s + (c.treatCost || 0), 0);
      const avgCost = total ? (totalCost / total).toFixed(2) : '0.00';
      const types = {};
      inDeck.forEach((c) => { types[c.type] = (types[c.type] || 0) + 1; });
      const typeBits = Object.entries(types)
        .map(([t, n]) => '<div>' + esc(t) + ': <strong>' + n + '</strong></div>').join('');
      deckStatsEl.innerHTML =
        '<div><strong>' + total + '</strong> cards</div>'
        + '<div>Avg cost: <strong>' + avgCost + '</strong></div>'
        + typeBits;
    }

    function renderCollection() {
      const stacks = getCollectionStacks();
      const q = (browseSearch?.value || '').trim().toLowerCase();
      const t = browseType?.value || '';

      collectionEl.innerHTML = '';

      if (!stacks.length) {
        collectionEl.style.display = 'none';
        if (collectionEmpty) collectionEmpty.style.display = 'block';
        return;
      }
      collectionEl.style.display = '';
      if (collectionEmpty) collectionEmpty.style.display = 'none';

      // sort: rarity desc, then variant rank desc, then name
      const variantRank = (n) => ({ standard: 1, foil: 2, holo: 3, etched: 4 })[variantKey(n)] || 0;
      const filtered = stacks
        .map((st) => ({ st, c: cardsById.get(st.cardId) }))
        .filter(({ c, st }) => {
          if (!c) return false;
          if (t && c.type !== t) return false;
          if (q) {
            const hay = (c.name + ' ' + (c.role || '') + ' ' + (c.rarity || '') + ' ' + st.variantName).toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => {
          return rarityRank(b.c.rarity) - rarityRank(a.c.rarity)
            || variantRank(b.st.variantName) - variantRank(a.st.variantName)
            || a.c.name.localeCompare(b.c.name);
        });

      if (!filtered.length) {
        collectionEl.innerHTML = '<p class="muted">No cards match.</p>';
        return;
      }

      filtered.forEach(({ st, c }) => {
        const wrap = buildCard(c, { variantName: st.variantName, mini: true });
        const cardEl = wrap.querySelector('.card');
        const inDeck = deckCount(activeDeck, st.cardId, st.variantName);
        const remaining = (st.count || 0) - inDeck;

        const meta = document.createElement('div');
        meta.className = 'collection-card-meta';
        meta.innerHTML =
          '<span class="owned-pill">Owned <strong>' + (st.count || 0) + '</strong></span>'
          + (inDeck > 0 ? '<span class="indeck-pill">In deck <strong>' + inDeck + '</strong></span>' : '');
        wrap.appendChild(meta);

        const addBtn = document.createElement('button');
        addBtn.className = 'card-add';
        addBtn.type = 'button';
        addBtn.innerHTML = '&plus;';
        addBtn.setAttribute('aria-label', 'Add to deck');
        if (remaining <= 0) {
          addBtn.disabled = true;
          addBtn.title = 'All copies already in deck';
        }
        addBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (deckAdd(activeDeck, st.cardId, st.variantName)) {
            renderActiveDeck();
            renderCollection();
          }
        });
        cardEl.appendChild(addBtn);

        collectionEl.appendChild(wrap);
      });
    }

    if (browseType) {
      const types = Array.from(new Set(cards.map((c) => c.type))).filter(Boolean).sort();
      types.forEach((t) => {
        const o = document.createElement('option');
        o.value = t; o.textContent = t;
        browseType.appendChild(o);
      });
    }

    deckNameEl.addEventListener('input', () => { activeDeck.name = deckNameEl.value || 'Untitled Deck'; });
    newDeckBtn.addEventListener('click', () => {
      activeDeck = { name: 'New Deck', cards: [] };
      renderActiveDeck();
      renderCollection();
    });
    saveDeckBtn.addEventListener('click', () => {
      if (!activeDeck.name.trim()) activeDeck.name = 'Untitled Deck';
      const decks = getDecks();
      const existing = decks.findIndex((d) => d.name === activeDeck.name);
      const snap = JSON.parse(JSON.stringify(activeDeck));
      if (existing >= 0) decks[existing] = snap;
      else decks.push(snap);
      saveDecks(decks);
      renderDecks();
      saveDeckBtn.textContent = 'Saved!';
      setTimeout(() => { saveDeckBtn.textContent = 'Save Deck'; }, 1200);
    });
    deleteDeckBtn.addEventListener('click', () => {
      const decks = getDecks().filter((d) => d.name !== activeDeck.name);
      saveDecks(decks);
      activeDeck = { name: 'New Deck', cards: [] };
      renderActiveDeck();
      renderDecks();
      renderCollection();
    });
    [browseSearch, browseType].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', renderCollection);
      el.addEventListener('change', renderCollection);
    });

    renderBattleAll = function () {
      renderDecks();
      renderActiveDeck();
      renderCollection();
    };

    renderBattleAll();
  }

  /* ====== INIT ====== */
  document.addEventListener('DOMContentLoaded', async () => {
    migrateStorage();
    initTheme();
    try {
      await loadCards();
    } catch (err) {
      console.error('Could not load cards:', err);
      const msg = document.createElement('div');
      msg.className = 'data-error';
      msg.textContent = 'Could not load card data. Run a local server: python3 -m http.server 8000';
      document.body.prepend(msg);
      return;
    }
    initPackButtons();
    initHomePage();
    initExpansionsPage();
    initBattlePage();
    updateHeaderCounts();
  });
})();
