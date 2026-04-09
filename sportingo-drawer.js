/* =============================================================
   sportingo-drawer.js
   Sportingo közös drawer / Sportingo fiók panel logika
   Referencia: web-palya.html végleges drawer implementáció
   Betöltési rend: supabase-js UTÁN töltsd be ezt a fájlt
   ============================================================= */

// ══════════════════════════════════════════════════════════════════
// SPORTINGO FIÓK PANEL JS – Teljes újraírás
// ══════════════════════════════════════════════════════════════════
(function() {
  'use strict';

  const SUPABASE_URL = 'https://amowwfjxeursokkznmxl.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtb3d3Zmp4ZXVyc29ra3pubXhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDE4NzQsImV4cCI6MjA4OTkxNzg3NH0.eajpxK96IAF-4XVIv4JALYZ-LqCqXaxU7GIaAE0T5L0';

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  window._spSb = sb;

  // ── State ──
  let currentUser = null;
  let allBookings = [], filteredBookings = [], currentPage = 1, activeFilter = 'kozelgo';
  let palyaReviewMap = new Map(); // palya_id → {id, rating, szoveg, cimkek}
  const perPage = 10;
  const sportEmoji = { Futball: '⚽', Tenisz: '🎾', Padel: '🎾', Squash: '🟡' };
  const statuszLabel = { varakozik: '⏳ Várakozik', jovahagyva: '✅ Jóváhagyva', elutasitva: '❌ Elutasítva', lemondva: '🚫 Lemondva' };

  function spEsc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  // ── DOM refs ──
  const drawer        = document.getElementById('sp-drawer');
  const drawerOverlay = document.getElementById('sp-drawer-overlay');
  const dAvatar       = document.getElementById('sp-drawer-avatar');
  const dName         = document.getElementById('sp-drawer-name');
  const dEmail        = document.getElementById('sp-drawer-email');
  const logoutBtn     = document.getElementById('sfd-logout-btn');

  function getAuthLabels() { return document.querySelectorAll('.sportingo-auth-label'); }

  // ── UI frissítés ──
  function setLoggedInUI(user) {
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || user.email.split('@')[0];
    getAuthLabels().forEach(l => l.textContent = name);
    document.querySelectorAll('.sportingo-auth-icon').forEach(i => i.textContent = '👤');
    if (dAvatar) dAvatar.textContent = name[0].toUpperCase();
    if (dName)   dName.textContent   = name;
    if (dEmail)  dEmail.textContent  = user.email;
    const ed = document.getElementById('sfd-profil-email-display');
    if (ed) ed.textContent = user.email;
    // Profil mező frissítése
    const pn = document.getElementById('sfd-profil-nev');
    const pt = document.getElementById('sfd-profil-telefon');
    if (pn) pn.value = meta.full_name || meta.name || '';
    if (pt) pt.value = meta.telefon || meta.phone || '';
  }

  function setLoggedOutUI() {
    getAuthLabels().forEach(l => l.textContent = 'Bejelentkezés');
    document.querySelectorAll('.sportingo-auth-icon').forEach(i => i.textContent = '👤');
    if (dAvatar) dAvatar.textContent = '?';
    if (dName)   dName.textContent = '–';
    if (dEmail)  dEmail.textContent = '–';
  }

  // ── Auth init ──
  // Pending állapot: semleges UI amíg a session check fut
  getAuthLabels().forEach(l => l.dataset.spPending = l.textContent);
  getAuthLabels().forEach(l => l.textContent = '…');

  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) { currentUser = session.user; setLoggedInUI(session.user); }
    else { setLoggedOutUI(); }
  });

  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      setLoggedInUI(session.user);
      if (document.getElementById('sp-login-modal-overlay')?.classList.contains('open')) {
        closeLoginModal();
        // ── RACE CONDITION FIX: ha public review pending van, NEM nyitjuk a drawert ──
        // A _checkPublicReviewPending fogja kezelni a visszatérést
        if (!window._spPublicReviewPending) {
          setTimeout(openDrawer, 350);
        }
      }
    }
    if (event === 'SIGNED_OUT') { currentUser = null; setLoggedOutUI(); closeDrawer(); }
    if (event === 'TOKEN_REFRESHED' && session) { currentUser = session.user; }
  });

  // ── Tab navigáció ──
  window.sfdSwitchTab = function(name) {
    document.querySelectorAll('.sfd-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.sfdTab === name));
    document.querySelectorAll('.sfd-panel').forEach(p => p.classList.toggle('active', p.id === 'sfd-panel-' + name));
    if (name === 'foglalasok') loadBookings();
    if (name === 'kedvencek')  loadKedvencek();
    if (name === 'profil')     loadProfil();
    if (name === 'statisztika') loadStatisztika();
    if (name === 'attekintes') loadAttekintes();
    if (name === 'ertekelesek') loadErtekelesek();
  };

  document.querySelectorAll('.sfd-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => sfdSwitchTab(btn.dataset.sfdTab));
  });

  // ── Drawer megnyitás/zárás ──
  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('open');
    if (drawerOverlay) drawerOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Alapértelmezett tab: Áttekintés
    sfdSwitchTab('attekintes');
    loadAttekintes();
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    if (drawerOverlay) drawerOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  window.closeDrawerGlobal = closeDrawer;

  // ── Foglalás lemondás – confirm modal + DB update ──────────────
  let _cancelTargetId = null;

  function sfdConfirmCancel(foglalasId) {
    _cancelTargetId = foglalasId;
    const overlay = document.getElementById('sp-confirm-modal-overlay');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function sfdCloseConfirm() {
    const overlay = document.getElementById('sp-confirm-modal-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    _cancelTargetId = null;
  }

  async function sfdDoCancel() {
    if (!_cancelTargetId) return;
    const id = _cancelTargetId;
    const okBtn = document.getElementById('sp-confirm-yes');
    if (okBtn) { okBtn.disabled = true; okBtn.textContent = '⏳ Lemondás...'; }
    try {
      // 1. Foglalás adatai – idopont_kezdes + idopont_veg a biztonságos időablakhoz
      const { data: fogl } = await sb.from('foglalasok')
        .select('palya_id, idopont_id, idopont_kezdes, idopont_veg, idopontok(datum)')
        .eq('id', id)
        .single();

      // 2. Státusz: lemondva
      const { error } = await sb.from('foglalasok').update({ statusz: 'lemondva' }).eq('id', id);
      if (error) throw error;

      // 3. Slot felszabadítás – kizárólag az eltárolt időablak alapján (biztonságos)
      const datum = fogl?.idopontok?.datum;
      if (fogl?.palya_id && datum && fogl?.idopont_kezdes && fogl?.idopont_veg) {
        await sb.from('idopontok')
          .update({ foglalt: false })
          .eq('palya_id', fogl.palya_id)
          .eq('datum', datum)
          .gte('kezdes', fogl.idopont_kezdes)
          .lt('kezdes', fogl.idopont_veg);
      } else if (fogl?.idopont_id) {
        // Fallback régi foglalásokhoz (migráció előttiekhez)
        await sb.from('idopontok').update({ foglalt: false }).eq('id', fogl.idopont_id);
      }

      sfdCloseConfirm();
      showSfdToast('🚫 Foglalás lemondva');
      await loadBookings();
      if (typeof loadAttekintes === 'function') await loadAttekintes();
    } catch(e) {
      if (okBtn) { okBtn.disabled = false; okBtn.textContent = 'Foglalás lemondása'; }
      showSfdToast('❌ Hiba történt a lemondásnál');
    }
  }

  function showSfdToast(msg) {
    let toast = document.getElementById('sfd-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sfd-toast';
      var ts = toast.style;
      ts.position = 'fixed'; ts.bottom = '24px'; ts.left = '50%';
      ts.transform = 'translateX(-50%) translateY(12px)';
      ts.background = '#0a1628'; ts.color = 'white';
      ts.padding = '10px 20px'; ts.borderRadius = '100px';
      ts.fontFamily = 'Plus Jakarta Sans, sans-serif';
      ts.fontSize = '.82rem'; ts.fontWeight = '700';
      ts.boxShadow = '0 8px 32px rgba(0,0,0,.22)';
      ts.opacity = '0'; ts.transition = 'opacity .22s, transform .22s';
      ts.zIndex = '99999'; ts.pointerEvents = 'none'; ts.whiteSpace = 'nowrap';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(12px)';
    }, 2600);
  }

  // Globális elérhetőség az inline onclick-hez (IIFE miatt szükséges)
  window.sfdConfirmCancel = sfdConfirmCancel;
  window.sfdCloseConfirm  = sfdCloseConfirm;

  // Confirm modal gombok
  document.addEventListener('click', function(e) {
    if (e.target.id === 'sp-confirm-no' || e.target === document.getElementById('sp-confirm-modal-overlay')) {
      sfdCloseConfirm();
    }
    if (e.target.id === 'sp-confirm-yes') {
      sfdDoCancel();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('sp-confirm-modal-overlay')?.classList.contains('open')) {
      sfdCloseConfirm();
    }
  });

  // ── Logout ──
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      closeDrawer();
      await sb.auth.signOut();
      logoutBtn.disabled = false;
    });
  }

  // ── Click kezelés ──
  document.addEventListener('click', e => {
    const authBtn = e.target.closest('.sportingo-auth-btn');
    if (authBtn) { e.preventDefault(); e.stopPropagation(); currentUser ? openDrawer() : openLoginModal(); return; }
    if (e.target.matches('[data-sp-close-login]') || e.target === document.getElementById('sp-login-modal-overlay')) { closeLoginModal(); return; }
    if (e.target.matches('[data-sp-close-drawer]') || e.target.closest('[data-sp-close-drawer]') || e.target === drawerOverlay) { closeDrawer(); return; }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeLoginModal(); } });

  // ── Filter chips ──
  document.querySelectorAll('.sfd-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.sfd-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.sfdFilter;
      currentPage = 1;
      applyBookingFilter();
    });
  });

  const prevBtn = document.getElementById('sfd-prev-page');
  const nextBtn = document.getElementById('sfd-next-page');
  if (prevBtn) prevBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderBookings(); } });
  if (nextBtn) nextBtn.addEventListener('click', () => { const max = Math.ceil(filteredBookings.length / perPage); if (currentPage < max) { currentPage++; renderBookings(); } });

  // ── ÁTTEKINTÉS ──
  async function loadAttekintes() {
    if (!currentUser) return;
    const email = currentUser.email;

    // Stats
    const [{ data: fogl }, { data: kedv }] = await Promise.all([
      sb.from('foglalasok').select('id,statusz,palyas(sportag,nev,helyszin_nev,slug),idopont_kezdes,idopont_veg,idopontok(datum)').eq('ugyfel_email', email),
      sb.from('kedvencek').select('id').eq('ugyfel_email', email)
    ]);

    const fEl = document.getElementById('sfd-stat-foglalasok');
    const kEl = document.getElementById('sfd-stat-kedvencek');
    // Csak aktív (nem lemondott, nem elutasított) foglalások száma
    const aktivFogl = fogl ? fogl.filter(f => f.statusz !== 'lemondva' && f.statusz !== 'elutasitva') : [];
    if (fEl) fEl.textContent = aktivFogl.length;
    if (kEl) kEl.textContent = kedv ? kedv.length : '0';

    // Következő / legutóbbi jóváhagyott foglalás
    const nextWrap = document.getElementById('sfd-next-booking-wrap');
    if (nextWrap) {
      const jovahagyott = fogl ? fogl.filter(f => f.statusz === 'jovahagyva') : [];
      if (jovahagyott.length > 0) {
        const now = new Date();
        // Jövőbeli jóváhagyott foglalások: idopont_kezdes alapján
        const jovobeliek = jovahagyott.filter(f => {
          const datum = f.idopontok?.datum || null;
          const kezdes = f.idopont_kezdes || null;
          if (!datum) return false;
          const dt = new Date(datum + (kezdes ? 'T' + kezdes + ':00' : 'T00:00:00'));
          return dt > now;
        });
        // Ha van jövőbeli: a legközelebbi; ha nincs: a legutóbbi múltbeli
        let kivalasztott;
        if (jovobeliek.length > 0) {
          kivalasztott = jovobeliek.reduce((a, b) => {
            const da = new Date((a.idopontok?.datum || '') + 'T' + (a.idopont_kezdes || '00:00') + ':00');
            const db = new Date((b.idopontok?.datum || '') + 'T' + (b.idopont_kezdes || '00:00') + ':00');
            return da < db ? a : b;
          });
        } else {
          // Fallback: legutóbbi múltbeli jóváhagyott (created_at DESC, első elem)
          kivalasztott = jovahagyott[0];
        }
        const nev = kivalasztott.palyas?.helyszin_nev || kivalasztott.palyas?.nev || '–';
        const slug = kivalasztott.palyas?.slug || '';
        const label = jovobeliek.length > 0 ? '📅 Következő foglalás' : '✅ Legutóbbi jóváhagyott foglalás';
        const kartyaTag = slug ? 'a' : 'div';
        const kartyaHref = slug ? ` href="https://sportingo.hu/palya/${spEsc(slug)}"` : '';
        const kartyaClass = slug ? ' clickable' : '';
        nextWrap.innerHTML = `
          <${kartyaTag}${kartyaHref} class="sfd-next-booking${kartyaClass}">
            <div class="sfd-next-label">${label}</div>
            <div class="sfd-next-val">${spEsc(nev)}</div>
            <div class="sfd-next-sub">${sportEmoji[kivalasztott.palyas?.sportag] || '🏟'} ${kivalasztott.palyas?.sportag || ''}</div>
          </${kartyaTag}>`;
      } else {
        nextWrap.innerHTML = '';
      }
    }
  }

  // ── FOGLALÁSOK ──
  async function loadBookings() {
    const list = document.getElementById('sfd-bookings-list');
    if (!currentUser || !list) return;
    list.innerHTML = '<div class="sfd-empty"><div class="sfd-empty-icon">⏳</div><div class="sfd-empty-sub">Betöltés...</div></div>';
    const { data, error } = await sb.from('foglalasok')
      .select('*,palyas(nev,helyszin_nev,sportag,slug,helyszin_id),idopontok(datum)')
      .eq('ugyfel_email', currentUser.email)
      .order('created_at', { ascending: false });
    if (error || !data) {
      list.innerHTML = '<div class="sfd-empty"><div class="sfd-empty-icon">⚠️</div><div class="sfd-empty-title">Hiba történt</div><div class="sfd-empty-sub">Nem sikerült betölteni a foglalásokat.</div></div>';
      return;
    }
    allBookings = data;
    // ── Review map: meglévő értékelések pályánként ──
    palyaReviewMap = new Map();
    const palyaIds = [...new Set(data.map(f => f.palya_id).filter(Boolean))];
    if (palyaIds.length && currentUser) {
      try {
        const { data: meglevoErt } = await sb.from('ertekelesek')
          .select('id, palya_id, rating, szoveg, cimkek, letrehozas_datum, updated_at')
          .eq('user_id', currentUser.id)
          .in('palya_id', palyaIds)
          .order('letrehozas_datum', { ascending: false });
        if (meglevoErt) {
          // Pályánként csak a legfrissebb review-t tároljuk
          meglevoErt.forEach(e => {
            if (!palyaReviewMap.has(e.palya_id)) palyaReviewMap.set(e.palya_id, e);
          });
        }
      } catch(e) { /* map üres marad */ }
    }
    applyBookingFilter();
  }

  function isFoglalasFuture(f) {
    if (f.idopontok?.datum && f.idopont_veg) {
      return new Date(f.idopontok.datum + 'T' + f.idopont_veg + ':00') > new Date();
    } else if (f.idopontok?.datum) {
      return new Date(f.idopontok.datum + 'T23:59:00') > new Date();
    }
    return false; // ha nincs időpontadat, múltbelinek tekintjük
  }

  function applyBookingFilter() {
    if (activeFilter === 'kozelgo') {
      filteredBookings = allBookings.filter(f =>
        (f.statusz === 'jovahagyva' || f.statusz === 'varakozik') && isFoglalasFuture(f)
      );
    } else if (activeFilter === 'multbeli') {
      filteredBookings = allBookings.filter(f => !isFoglalasFuture(f));
    } else if (activeFilter === 'mind') {
      filteredBookings = allBookings;
    } else {
      // státusz alapú filterek (varakozik, lemondva, stb.)
      filteredBookings = allBookings.filter(f => f.statusz === activeFilter);
    }
    currentPage = 1;
    renderBookings();
  }

  function renderBookings() {
    const list = document.getElementById('sfd-bookings-list');
    const pag  = document.getElementById('sfd-pagination');
    if (!list) return;

    if (!filteredBookings.length) {
      list.innerHTML = `<div class="sfd-empty">
        <div class="sfd-empty-icon">📋</div>
        <div class="sfd-empty-title">Nincs foglalás</div>
        <div class="sfd-empty-sub">Keress pályát és küldj foglalási kérést – megjelennek majd itt.</div>
        <a href="https://sportingo.hu" class="sfd-empty-cta" onclick="closeDrawerGlobal()">🔎 Pályák keresése</a>
      </div>`;
      if (pag) pag.style.display = 'none';
      return;
    }

    const maxPage = Math.ceil(filteredBookings.length / perPage);
    const page = filteredBookings.slice((currentPage - 1) * perPage, currentPage * perPage);

    list.innerHTML = page.map(f => {
      const nev   = f.palyas?.helyszin_nev || f.palyas?.nev || '–';
      const sport = f.palyas?.sportag || '';
      const emoji = sportEmoji[sport] || '🏟';
      const safe  = ['varakozik','jovahagyva','elutasitva','lemondva'].includes(f.statusz) ? f.statusz : '';
      const slug  = f.palyas?.slug || '';
      // Tényleges foglalt dátum és időintervallum megjelenítése (nem a created_at)
      const foglDatum = f.idopontok?.datum || null;
      let dateStr = '';
      if (foglDatum && f.idopont_kezdes && f.idopont_veg) {
        const d = new Date(foglDatum).toLocaleDateString('hu-HU', { year:'numeric', month:'2-digit', day:'2-digit' });
        dateStr = `${d} ${f.idopont_kezdes}–${f.idopont_veg}`;
      } else if (foglDatum) {
        dateStr = new Date(foglDatum).toLocaleDateString('hu-HU', { year:'numeric', month:'2-digit', day:'2-digit' });
      } else if (f.created_at) {
        dateStr = new Date(f.created_at).toLocaleDateString('hu-HU', { year:'numeric', month:'short', day:'numeric' });
      }
      // Lemondás gomb: csak jövőbeli foglalásra, státusz + tényleges dátum+idő alapján
      let isFuture = false;
      if (f.idopontok?.datum && f.idopont_veg) {
        isFuture = new Date(f.idopontok.datum + 'T' + f.idopont_veg + ':00') > new Date();
      } else if (f.idopontok?.datum) {
        // Ha nincs veg időpont, a nap végéig (23:59) tekintjük jövőbelinek
        isFuture = new Date(f.idopontok.datum + 'T23:59:00') > new Date();
      }
      const canCancel = (f.statusz === 'varakozik' || f.statusz === 'jovahagyva') && isFuture;
      const cancelBtn = canCancel
        ? `<button class="sfd-cancel-btn" onclick="sfdConfirmCancel('${f.id}')">🚫 Foglalás lemondása</button>`
        : '';
      const palyaUrl = slug ? `https://sportingo.hu/palya/${spEsc(slug)}` : '';

      // Review CTA: csak múltbeli, jóváhagyott foglalásoknál
      let reviewBtn = '';
      const idopntElmult = !isFuture && (f.idopontok?.datum || f.idopont_veg);
      if (f.statusz === 'jovahagyva' && idopntElmult) {
        const meglevoReview = palyaReviewMap.get(f.palya_id) || null;
        const palyaNev = (f.palyas?.helyszin_nev || f.palyas?.nev || '').replace(/"/g, '&quot;');
        const helyszinId = f.palyas?.helyszin_id || '';
        if (meglevoReview) {
          // Van meglévő review → edit mód: data-rv átadja az id-t a modalnak
          const rvJson = encodeURIComponent(JSON.stringify({ id: meglevoReview.id, rating: meglevoReview.rating, szoveg: meglevoReview.szoveg || '', cimkek: meglevoReview.cimkek || [] }));
          reviewBtn = `<button class="sfd-btn-ertekeles" data-fid="${f.id}" data-pid="${f.palya_id}" data-hid="${helyszinId}" data-nev="${palyaNev}" data-rv="${rvJson}" onclick="sfdNyitReviewModal(this)">✏️ Értékelés módosítása</button>`;
        } else {
          reviewBtn = `<button class="sfd-btn-ertekeles" data-fid="${f.id}" data-pid="${f.palya_id}" data-hid="${helyszinId}" data-nev="${palyaNev}" onclick="sfdNyitReviewModal(this)">⭐ Értékelem</button>`;
        }
      }

      return `<div class="sfd-booking-card ${safe}">
        <div class="sfd-booking-top">
          <div class="sfd-booking-name">${emoji} ${palyaUrl ? `<a href="${palyaUrl}" class="sfd-booking-name-link">${spEsc(nev)}</a>` : spEsc(nev)}</div>
          <span class="sfd-status-pill ${safe}">${statuszLabel[f.statusz] || f.statusz}</span>
        </div>
        <div class="sfd-booking-meta">${dateStr ? '📅 ' + dateStr : ''} ${sport ? '· ' + sport : ''}</div>
        ${palyaUrl ? `<a href="${palyaUrl}" class="sfd-booking-link">Pálya megtekintése ↗</a>` : ''}
        ${reviewBtn}
        ${cancelBtn}
      </div>`;
    }).join('');

    if (maxPage > 1 && pag) {
      pag.style.display = 'flex';
      const pi = document.getElementById('sfd-page-info');
      if (pi) pi.textContent = currentPage + ' / ' + maxPage;
      if (prevBtn) prevBtn.disabled = currentPage === 1;
      if (nextBtn) nextBtn.disabled = currentPage === maxPage;
    } else if (pag) {
      pag.style.display = 'none';
    }
  }

  // ── KEDVENCEK ──
  async function loadKedvencek() {
    const list = document.getElementById('sfd-kedvencek-list');
    if (!currentUser || !list) return;
    list.innerHTML = '<div class="sfd-empty"><div class="sfd-empty-icon">⏳</div><div class="sfd-empty-sub">Betöltés...</div></div>';
    const { data, error } = await sb.from('kedvencek')
      .select('id,palya_id,palyas(nev,helyszin_nev,sportag,slug,varos)')
      .eq('ugyfel_email', currentUser.email)
      .order('created_at', { ascending: false });

    if (error || !data || !data.length) {
      list.innerHTML = `<div class="sfd-empty">
        <div class="sfd-empty-icon">❤️</div>
        <div class="sfd-empty-title">Még nincsenek kedvenceid</div>
        <div class="sfd-empty-sub">Mentsd el a kedvenc pályáidat, hogy legközelebb gyorsabban foglalhass.</div>
        <a href="https://sportingo.hu" class="sfd-empty-cta" onclick="closeDrawerGlobal()">🔎 Pályák felfedezése</a>
      </div>`;
      return;
    }

    list.innerHTML = data.map(k => {
      const p    = k.palyas || {};
      const nev  = p.helyszin_nev || p.nev || '–';
      const slug = p.slug || '';
      const varos = p.varos || '';
      const emoji = sportEmoji[p.sportag] || '🏟';
      return `<div class="sfd-kedvenc-card" data-kedvenc-id="${k.id}">
        <div class="sfd-kedvenc-icon">${emoji}</div>
        <div class="sfd-kedvenc-info">
          <div class="sfd-kedvenc-name">${slug ? `<a href="https://sportingo.hu/palya/${spEsc(slug)}" class="sfd-booking-name-link">${spEsc(nev)}</a>` : spEsc(nev)}</div>
          <div class="sfd-kedvenc-meta">${varos ? '📍 ' + spEsc(varos) : (p.sportag || '')}</div>
        </div>
        <div class="sfd-kedvenc-actions">
          ${slug ? `<a href="https://sportingo.hu/palya/${spEsc(slug)}" class="sfd-kedvenc-link">Foglalás →</a>` : ''}
          <button class="sfd-kedvenc-remove" data-kid="${k.id}" title="Törlés">🗑</button>
        </div>
      </div>`;
    }).join('');

    list.addEventListener('click', async e => {
      const btn = e.target.closest('.sfd-kedvenc-remove');
      if (!btn) return;
      btn.textContent = '⏳';
      const { error: delErr } = await sb.from('kedvencek').delete().eq('id', btn.dataset.kid);
      if (!delErr) {
        btn.closest('.sfd-kedvenc-card').remove();
        const kEl = document.getElementById('sfd-stat-kedvencek');
        if (kEl) kEl.textContent = Math.max(0, parseInt(kEl.textContent || '0') - 1);
      } else { btn.textContent = '🗑'; }
    }, { once: true });
  }

  // ── PROFIL ──
  function loadProfil() {
    if (!currentUser) return;
    const meta = currentUser.user_metadata || {};
    const pn = document.getElementById('sfd-profil-nev');
    const pt = document.getElementById('sfd-profil-telefon');
    if (pn) pn.value = meta.full_name || meta.name || '';
    if (pt) pt.value = meta.telefon || meta.phone || '';
    const ed = document.getElementById('sfd-profil-email-display');
    if (ed) ed.textContent = currentUser.email;
  }

  const profilSaveBtn = document.getElementById('sfd-profil-save-btn');
  if (profilSaveBtn) {
    profilSaveBtn.addEventListener('click', async function() {
      if (!currentUser) return;
      const nev = (document.getElementById('sfd-profil-nev')?.value || '').trim();
      const tel = (document.getElementById('sfd-profil-telefon')?.value || '').trim();
      const msg = document.getElementById('sfd-profil-msg');
      this.disabled = true; this.textContent = '⏳ Mentés...';
      const { error } = await sb.auth.updateUser({ data: { full_name: nev, name: nev, telefon: tel, phone: tel } });
      this.disabled = false; this.textContent = '💾 Adatok mentése';
      if (msg) msg.style.display = 'block';
      if (!error) {
        if (msg) { msg.className = 'sfd-msg ok'; msg.textContent = '✅ Adatok mentve!'; }
        if (nev && dAvatar) dAvatar.textContent = nev[0].toUpperCase();
        if (nev && dName)   dName.textContent = nev;
        getAuthLabels().forEach(l => l.textContent = nev);
        if (currentUser.user_metadata) { currentUser.user_metadata.full_name = nev; currentUser.user_metadata.telefon = tel; }
      } else {
        if (msg) { msg.className = 'sfd-msg err'; msg.textContent = '❌ Hiba történt.'; }
      }
      setTimeout(() => { if (msg) msg.style.display = 'none'; }, 3000);
    });
  }

  const pwResetBtn = document.getElementById('sfd-pw-reset-btn');
  if (pwResetBtn) {
    pwResetBtn.addEventListener('click', async function() {
      if (!currentUser) return;
      const msg = document.getElementById('sfd-pw-msg');
      this.disabled = true; this.textContent = '⏳ Küldés...';
      const { error } = await sb.auth.resetPasswordForEmail(currentUser.email, { redirectTo: 'https://sportingo.hu/jelszo-reset' });
      this.disabled = false; this.textContent = '📧 Jelszóváltoztatási email';
      if (msg) msg.style.display = 'block';
      if (!error) { if (msg) { msg.className = 'sfd-msg ok'; msg.textContent = '✅ Email elküldve!'; } }
      else         { if (msg) { msg.className = 'sfd-msg err'; msg.textContent = '❌ Nem sikerült.'; } }
      setTimeout(() => { if (msg) msg.style.display = 'none'; }, 4000);
    });
  }

  // ── STATISZTIKA ──
  async function loadStatisztika() {
    if (!currentUser) return;
    const { data } = await sb.from('foglalasok')
      .select('statusz,palyas(sportag,nev,helyszin_nev,slug)')
      .eq('ugyfel_email', currentUser.email);

    const totalEl    = document.getElementById('sfd-ins-total');
    const approvedEl = document.getElementById('sfd-ins-approved');
    const sportEl    = document.getElementById('sfd-ins-sport');
    const placeEl    = document.getElementById('sfd-ins-place');
    const placeCard  = placeEl ? placeEl.closest('.sfd-insight-card') : null;
    const emptyEl    = document.getElementById('sfd-stats-empty');

    if (!data || data.length === 0) {
      if (totalEl) totalEl.textContent = '0';
      if (approvedEl) approvedEl.textContent = '0';
      if (sportEl) sportEl.textContent = '–';
      if (placeEl) placeEl.textContent = '–';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (totalEl) totalEl.textContent = data.length;
    if (approvedEl) approvedEl.textContent = data.filter(f => f.statusz === 'jovahagyva').length;

    // Kedvenc sportág
    const sportCount = {};
    data.forEach(f => { const s = f.palyas?.sportag; if (s) sportCount[s] = (sportCount[s] || 0) + 1; });
    const topSport = Object.entries(sportCount).sort((a,b) => b[1]-a[1])[0];
    if (sportEl) sportEl.textContent = topSport ? topSport[0] : '–';

    // Legtöbbet látogatott helyszín – slug alapján kattintható kártya
    const placeMap = {}; // nev → { count, slug }
    data.forEach(f => {
      const n = f.palyas?.helyszin_nev || f.palyas?.nev;
      if (!n) return;
      if (!placeMap[n]) placeMap[n] = { count: 0, slug: f.palyas?.slug || '' };
      placeMap[n].count++;
      if (!placeMap[n].slug && f.palyas?.slug) placeMap[n].slug = f.palyas.slug;
    });
    const topPlace = Object.entries(placeMap).sort((a,b) => b[1].count - a[1].count)[0];
    if (placeEl) placeEl.textContent = topPlace ? topPlace[0] : '–';
    if (placeCard && topPlace && topPlace[1].slug) {
      placeCard.classList.add('clickable');
      placeCard.style.cursor = 'pointer';
      placeCard.onclick = () => { window.open('https://sportingo.hu/palya/' + topPlace[1].slug, '_blank'); };
    } else if (placeCard) {
      placeCard.classList.remove('clickable');
      placeCard.onclick = null;
    }
  }

  // ── ÉRTÉKELÉSEIM ──
  async function loadErtekelesek() {
    if (!currentUser) return;

    const loadingEl = document.getElementById('sfd-ert-loading');
    const contentEl = document.getElementById('sfd-ert-content');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    // Múltbeli, jóváhagyott foglalások a meglévő allBookings state-ből
    // Ha loadBookings még nem futott, lekérjük célzottan
    let foglalasok = allBookings.length > 0 ? allBookings : null;
    if (!foglalasok) {
      try {
        const { data } = await sb.from('foglalasok')
          .select('id,palya_id,statusz,idopont_kezdes,idopont_veg,idopontok(datum),palyas(nev,helyszin_nev,slug,sportag,helyszin_id)')
          .eq('ugyfel_email', currentUser.email)
          .order('created_at', { ascending: false });
        foglalasok = data || [];
      } catch(e) { foglalasok = []; }
    }

    // Saját értékelések lekérése – pályánként a legfrissebb
    let sajatReviewMap = new Map(); // palya_id → legfrissebb review
    if (palyaReviewMap.size > 0) {
      // Ha a palyaReviewMap már feltöltve van (loadBookings futott), használjuk
      sajatReviewMap = palyaReviewMap;
    } else {
      // Célzott lekérés
      const palyaIds = [...new Set(foglalasok.map(f => f.palya_id).filter(Boolean))];
      if (palyaIds.length) {
        try {
          const { data: ertList } = await sb.from('ertekelesek')
            .select('id, palya_id, rating, szoveg, cimkek, letrehozas_datum, updated_at')
            .eq('user_id', currentUser.id)
            .in('palya_id', palyaIds)
            .order('letrehozas_datum', { ascending: false });
          if (ertList) {
            ertList.forEach(e => {
              if (!sajatReviewMap.has(e.palya_id)) sajatReviewMap.set(e.palya_id, e);
            });
          }
        } catch(e) { /* map üres marad */ }
      }
    }

    // Múltbeli jóváhagyott foglalások – pályánként csak egyszer (legfrissebb foglalás)
    const now = new Date();
    const multbeliJovahagyott = foglalasok.filter(f => {
      if (f.statusz !== 'jovahagyva') return false;
      return !isFoglalasFuture(f);
    });

    // Pályánként a legfrissebb múltbeli foglalás
    const palyaFoglalasMap = new Map();
    multbeliJovahagyott.forEach(f => {
      if (!palyaFoglalasMap.has(f.palya_id)) palyaFoglalasMap.set(f.palya_id, f);
    });

    // Egységes lista: minden pálya ahol volt foglalás
    // ha van review → szerkeszthető; ha nincs → értékelhető
    const varList = [];
    const meglevoList = [];

    palyaFoglalasMap.forEach((f, palyaId) => {
      const review = sajatReviewMap.get(palyaId) || null;
      const palyaNev = f.palyas?.helyszin_nev || f.palyas?.nev || '–';
      const slug = f.palyas?.slug || '';
      const sportag = f.palyas?.sportag || '';
      const helyszinId = f.palyas?.helyszin_id || '';
      const foglalasId = f.id || '';
      const foglDatum = f.idopontok?.datum
        ? new Date(f.idopontok.datum).toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' })
        : null;

      if (!review) {
        varList.push({ palyaNev, slug, sportag, foglDatum, palyaId, foglalasId, helyszinId, review: null });
      } else {
        // Van review → szerkeszthető (nincs 90 napos tiltás)
        meglevoList.push({ palyaNev, slug, sportag, foglDatum, palyaId, foglalasId, helyszinId, review });
      }
    });

    // Render: A) Értékelésre vár
    const varListEl = document.getElementById('sfd-ert-var-list');
    if (varListEl) {
      if (varList.length === 0) {
        varListEl.innerHTML = `<div class="sfd-empty" style="padding:12px 0 4px;">
          <div class="sfd-empty-icon">✅</div>
          <div class="sfd-empty-title" style="font-size:.88rem;">Minden pályát értékeltél</div>
          <div class="sfd-empty-sub">Nincsenek most értékelésre váró pályáid.</div>
        </div>`;
      } else {
        varListEl.innerHTML = varList.map(item => {
          const emojiSport = sportEmoji[item.sportag] || '🏟';
          const linkNev = item.slug
            ? `<a href="https://sportingo.hu/palya/${spEsc(item.slug)}" class="sfd-booking-name-link">${spEsc(item.palyaNev)}</a>`
            : spEsc(item.palyaNev);
          const foglMeta = item.foglDatum ? `📅 ${item.foglDatum}` : '';
          const nevEscaped = spEsc(item.palyaNev).replace(/"/g, '&quot;');
          const ctaGomb = `<button class="sfd-btn-ertekeles" data-fid="${spEsc(item.foglalasId)}" data-pid="${spEsc(item.palyaId)}" data-hid="${spEsc(item.helyszinId||'')}" data-nev="${nevEscaped}" onclick="sfdNyitReviewModal(this)">⭐ Értékelem</button>`;
          return `<div class="sfd-ert-card">
            <div class="sfd-ert-card-top">
              <div class="sfd-ert-card-nev">${emojiSport} ${linkNev}</div>
            </div>
            ${foglMeta ? `<div class="sfd-ert-card-meta">${foglMeta}</div>` : ''}
            <div class="sfd-ert-cta-wrap">${ctaGomb}</div>
          </div>`;
        }).join('');
      }
    }

    // Render: B) Korábbi értékelések
    const meglevoListEl = document.getElementById('sfd-ert-meglevo-list');
    if (meglevoListEl) {
      if (meglevoList.length === 0) {
        meglevoListEl.innerHTML = `<div class="sfd-empty" style="padding:12px 0 4px;">
          <div class="sfd-empty-icon">⭐</div>
          <div class="sfd-empty-sub">Még nincs korábbi értékelésed.</div>
        </div>`;
      } else {
        meglevoListEl.innerHTML = meglevoList.map(item => {
          const rv = item.review;
          const emojiSport = sportEmoji[item.sportag] || '🏟';
          const linkNev = item.slug
            ? `<a href="https://sportingo.hu/palya/${spEsc(item.slug)}" class="sfd-booking-name-link">${spEsc(item.palyaNev)}</a>`
            : spEsc(item.palyaNev);
          // Csillagok
          const csillagSzam = rv.rating || 0;
          const csillagok = '★'.repeat(csillagSzam) + '☆'.repeat(5 - csillagSzam);
          // Dátum – updated_at ha van, különben letrehozas_datum
          // ── 9. DEFENZÍV DATE PARSE ──
          const _safeDate = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
          const isUpdated = _safeDate(rv.updated_at) && _safeDate(rv.letrehozas_datum)
            && (_safeDate(rv.updated_at) - _safeDate(rv.letrehozas_datum)) > 60000;
          const datumAlap = isUpdated ? rv.updated_at : rv.letrehozas_datum;
          const datumLabel = isUpdated ? 'Frissítve' : 'Értékelve';
          const ertDatumStr = _safeDate(datumAlap)
            ? _safeDate(datumAlap).toLocaleDateString('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' })
            : '';
          // Cimkék
          const cimkekHTML = rv.cimkek && rv.cimkek.length
            ? rv.cimkek.map(c => `<span class="sfd-ert-cimke">${spEsc(c)}</span>`).join('')
            : '';
          // Edit gomb – meglevoId átadása a modalnak
          const nevEscaped = spEsc(item.palyaNev).replace(/"/g, '&quot;');
          const rvJson = encodeURIComponent(JSON.stringify({ id: rv.id, rating: rv.rating, szoveg: rv.szoveg || '', cimkek: rv.cimkek || [] }));
          const editGomb = `<button class="sfd-btn-ertekeles" data-fid="${spEsc(item.foglalasId)}" data-pid="${spEsc(item.palyaId)}" data-hid="${spEsc(item.helyszinId||'')}" data-nev="${nevEscaped}" data-rv="${rvJson}" onclick="sfdNyitReviewModal(this)">✏️ Módosítás</button>`;
          return `<div class="sfd-ert-card">
            <div class="sfd-ert-card-top">
              <div class="sfd-ert-card-nev">${emojiSport} ${linkNev}</div>
              <div class="sfd-ert-stars">${csillagok}</div>
            </div>
            <div class="sfd-ert-card-meta">${ertDatumStr ? `${datumLabel}: ${ertDatumStr}` : ''}</div>
            ${rv.szoveg ? `<div class="sfd-ert-card-preview">${spEsc(rv.szoveg)}</div>` : ''}
            ${cimkekHTML ? `<div style="margin-top:4px;">${cimkekHTML}</div>` : ''}
            <div class="sfd-ert-cta-wrap" style="margin-top:8px;">${editGomb}</div>
          </div>`;
        }).join('');
      }
    }

    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
  }

  // ── Login modal (változatlan logika, új ID-k mentén) ──
  let loginView = 'login';
  let forgotCooldown = false;

  function injectLoginModal() {
    if (document.getElementById('sp-login-modal-overlay')) return;
    const div = document.createElement('div');
    div.innerHTML = `<div id="sp-login-modal-overlay">
  <div id="sp-login-modal">
    <div class="sp-modal-head">
      <div>
        <div class="sp-modal-logo"><img src="https://amowwfjxeursokkznmxl.supabase.co/storage/v1/object/public/brand/Sportingo%20BRAND.svg" alt="Sportingo"></div>
        <div class="sp-modal-subtitle" id="sp-login-modal-title">Bejelentkezés</div>
      </div>
      <button type="button" class="sp-modal-close" data-sp-close-login>&#x2715;</button>
    </div>
    <div id="sp-login-modal-body">
      <div id="sp-login-alert" class="sp-login-alert"></div>
      <div class="sp-login-tabs">
        <button class="sp-login-tab active" onclick="spSetLoginView('login')">Bejelentkezés</button>
        <button class="sp-login-tab" onclick="spSetLoginView('register')">Regisztráció</button>
      </div>
      <div class="sp-lv-section active" id="sp-lv-login">
        <input type="email" id="sp-login-email" class="sp-login-input" placeholder="Email cím" autocomplete="email">
        <input type="password" id="sp-login-password" class="sp-login-input" placeholder="Jelszó" autocomplete="current-password">
        <button id="sp-login-btn" class="sp-login-btn" onclick="spHandleLogin()">Bejelentkezés →</button>
        <button class="sp-login-link" onclick="spSetLoginView('forgot')" style="display:block;margin-bottom:12px;">Elfelejtett jelszó?</button>
        <div class="sp-login-divider">vagy</div>
        <button class="sp-google-btn" onclick="spGoogleLogin()">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Folytatás Google-lel
        </button>
      </div>
      <div class="sp-lv-section" id="sp-lv-register">
        <input type="text" id="sp-reg-nev" class="sp-login-input" placeholder="Teljes neved" autocomplete="name">
        <input type="email" id="sp-reg-email" class="sp-login-input" placeholder="Email cím" autocomplete="email">
        <input type="password" id="sp-reg-password" class="sp-login-input" placeholder="Jelszó (min. 6 karakter)" autocomplete="new-password">
        <button id="sp-reg-btn" class="sp-login-btn" onclick="spHandleRegister()">Regisztráció →</button>
        <div class="sp-login-divider">vagy</div>
        <button class="sp-google-btn" onclick="spGoogleLogin()">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Folytatás Google-lel
        </button>
      </div>
      <div class="sp-lv-section" id="sp-lv-forgot">
        <p style="font-size:.85rem;color:#6b8a9a;margin-bottom:14px;">Add meg az email címed, küldünk egy visszaállító linket.</p>
        <input type="email" id="sp-forgot-email" class="sp-login-input" placeholder="Email cím" autocomplete="email">
        <button id="sp-forgot-btn" class="sp-login-btn" onclick="spHandleForgot()">Email küldése</button>
        <button class="sp-login-link" onclick="spSetLoginView('login')" style="display:block;text-align:center;">← Vissza</button>
      </div>
    </div>
    <div class="sp-modal-foot">Pályatulajdonos? <a href="https://portal.sportingo.hu" target="_blank">Tulajdonosi portál →</a></div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
  }

  function openLoginModal() {
    injectLoginModal();
    const overlay = document.getElementById('sp-login-modal-overlay');
    if (!overlay) return;
    window._spLoginWasOpen = true;
    setLoginView('login');
    const alertEl = document.getElementById('sp-login-alert');
    if (alertEl) alertEl.style.display = 'none';
    const emailEl = document.getElementById('sp-login-email');
    if (emailEl) emailEl.value = '';
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { if (emailEl) emailEl.focus(); }, 100);
  }

  function closeLoginModal() {
    const lmo = document.getElementById('sp-login-modal-overlay');
    if (!lmo) return;
    lmo.classList.remove('open');
    document.body.style.overflow = '';
  }

  function setLoginView(view) {
    loginView = view;
    ['login','register','forgot'].forEach(v => {
      const el = document.getElementById('sp-lv-' + v);
      if (el) el.style.display = v === view ? 'block' : 'none';
    });
    document.querySelectorAll('.sp-login-tab').forEach(btn => {
      const isLogin = btn.textContent.includes('Bejelentkezés');
      const isReg   = btn.textContent.includes('Regisztráció');
      btn.classList.toggle('active', (view === 'login' && isLogin) || (view === 'register' && isReg));
    });
    const title = document.getElementById('sp-login-modal-title');
    if (title) title.textContent = view === 'login' ? 'Bejelentkezés' : view === 'register' ? 'Regisztráció' : 'Jelszó visszaállítás';
    const alertEl = document.getElementById('sp-login-alert');
    if (alertEl) alertEl.style.display = 'none';
  }

  function showLoginAlert(msg, isError) {
    const el = document.getElementById('sp-login-alert');
    if (!el) return;
    el.textContent = msg; el.className = 'sp-login-alert ' + (isError ? 'error' : 'success'); el.style.display = 'block';
  }

  window.spSetLoginView = setLoginView;

  window.spHandleLogin = async function() {
    const email = (document.getElementById('sp-login-email')?.value || '').trim();
    const pw    = (document.getElementById('sp-login-password')?.value || '');
    if (!email || !pw) { showLoginAlert('Kérjük töltsd ki az összes mezőt!', true); return; }
    const btn = document.getElementById('sp-login-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (btn) { btn.disabled = false; btn.textContent = 'Bejelentkezés →'; }
    if (error) showLoginAlert('Hibás email vagy jelszó!', true);
  };

  window.spHandleRegister = async function() {
    const email = (document.getElementById('sp-reg-email')?.value || '').trim();
    const pw    = (document.getElementById('sp-reg-password')?.value || '');
    const nev   = (document.getElementById('sp-reg-nev')?.value || '').trim();
    if (!email || !pw || !nev) { showLoginAlert('Kérjük töltsd ki az összes mezőt!', true); return; }
    if (pw.length < 6) { showLoginAlert('A jelszó legalább 6 karakter legyen!', true); return; }
    const btn = document.getElementById('sp-reg-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    const { error } = await sb.auth.signUp({ email, password: pw, options: { data: { full_name: nev } } });
    if (btn) { btn.disabled = false; btn.textContent = 'Regisztráció →'; }
    if (error) showLoginAlert(error.message, true);
    else showLoginAlert('✅ Sikeres regisztráció! Ellenőrizd az emailed.', false);
  };

  window.spGoogleLogin = async function() {
    try { sessionStorage.setItem('sp_return_to', window.location.href); } catch(e) {}
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://sportingo.hu/auth-callback' } });
    if (error) showLoginAlert('Google belépés sikertelen!', true);
  };

  window.spHandleForgot = async function() {
    if (forgotCooldown) { showLoginAlert('Kérlek várj legalább 60 másodpercet!', true); return; }
    const email = (document.getElementById('sp-forgot-email')?.value || '').trim();
    if (!email) { showLoginAlert('Add meg az email címed!', true); return; }
    const btn = document.getElementById('sp-forgot-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://sportingo.hu/jelszo-reset' });
    if (btn) { btn.disabled = false; btn.textContent = 'Email küldése'; }
    if (error) { showLoginAlert('Nem sikerült!', true); return; }
    showLoginAlert('✅ Email elküldve!', false);
    forgotCooldown = true;
    setTimeout(() => { forgotCooldown = false; }, 60000);
  };

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const overlay = document.getElementById('sp-login-modal-overlay');
    if (!overlay?.classList.contains('open')) return;
    if (loginView === 'login')    window.spHandleLogin();
    if (loginView === 'register') window.spHandleRegister();
    if (loginView === 'forgot')   window.spHandleForgot();
  });

  // ── REVIEW MODAL (drawer) ──────────────────────────────────────
  const SFD_RATING_LABELS = {1:'Rossz élmény',2:'Alap elvárások alatt',3:'Átlagos',4:'Jó, ajánlom',5:'Kiváló, mindenképp ajánlom!'};
  // submitting mező a dupla submit ellen (state szintű guard)
  let _sfdRv = { foglalasId:null, palyaId:null, helyszinId:null, rating:0, cimkek:[], meglevoId:null, submitting:false };

  window.sfdNyitReviewModal = function(btn) {
    // ── 5. DEFENZÍV JSON PARSE – crash safe ──
    let rv = null;
    if (btn.dataset.rv) {
      try {
        rv = JSON.parse(decodeURIComponent(btn.dataset.rv));
      } catch(e) {
        console.warn('[sfdNyitReviewModal] Review JSON parse hiba:', e);
        rv = {};
      }
    }

    // ── 6. MODAL HARD RESET – nincs state leakage ──
    document.querySelectorAll('.sfd-review-star').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sfd-review-cimke').forEach(c => c.classList.remove('selected', 'disabled'));

    // ── NO FLICKER: state reset ELŐBB, render UTÁNA ──
    // ── EMPTY STATE HARDENING: null-safe értékek ──
    _sfdRv = {
      foglalasId:  btn.dataset.fid,
      palyaId:     btn.dataset.pid,
      helyszinId:  btn.dataset.hid || null,
      rating:      (rv && rv.rating)  ? (rv.rating  || 0) : 0,
      cimkek:      (rv && rv.cimkek)  ? rv.cimkek.slice() : [],
      meglevoId:   (rv && rv.id)      ? rv.id              : null,
      submitting:  false   // reset minden megnyitásnál
    };

    // Inline blokk megjelenítése (overlay nincs)
    const blokk = document.getElementById('sfd-review-modal');
    if (!blokk) return;

    // Render – state már tiszta, nincs flicker
    const nevEl = document.getElementById('sfd-review-modal-sub');
    if (nevEl) nevEl.textContent = btn.dataset.nev || 'Pálya értékelése';

    const errEl = document.getElementById('sfd-review-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

    // ── 2. EDIT BETÖLTÉS – NULL SAFE ──
    const szEl = document.getElementById('sfd-review-szoveg');
    if (szEl) szEl.value = (rv && rv.szoveg) ? (rv.szoveg || '') : '';

    document.querySelectorAll('.sfd-review-star').forEach(s => {
      s.classList.toggle('active', _sfdRv.rating > 0 && parseInt(s.dataset.val) <= _sfdRv.rating);
    });

    const lblEl = document.getElementById('sfd-review-rating-label');
    if (lblEl) lblEl.textContent = _sfdRv.rating > 0
      ? _sfdRv.rating + ' csillag – ' + (SFD_RATING_LABELS[_sfdRv.rating] || '')
      : 'Kattints egy csillagra az értékeléshez';

    // ── 4. CTA KONZISZTENCIA ──
    const subBtn = document.getElementById('sfd-review-submit-btn');
    if (subBtn) {
      subBtn.disabled = _sfdRv.rating === 0;
      subBtn.textContent = _sfdRv.meglevoId ? '✏️ Értékelés módosítása' : '⭐ Értékelem';
    }

    document.querySelectorAll('.sfd-review-cimke').forEach(el => {
      el.classList.remove('selected', 'disabled');
      if (_sfdRv.cimkek.indexOf(el.dataset.cimke) >= 0) el.classList.add('selected');
    });
    if (_sfdRv.cimkek.length >= 3) {
      document.querySelectorAll('.sfd-review-cimke').forEach(el => {
        if (!el.classList.contains('selected')) el.classList.add('disabled');
      });
    }

    // Inline display – NEM overlay, NEM body.overflow
    blokk.style.display = 'block';

    // ── 3. EDIT UX BOOST – focus delay ──
    setTimeout(function() {
      document.getElementById('sfd-review-szoveg')?.focus();
    }, 200);
  };

  function sfdZarjReviewModal() {
    // Inline blokk elrejtése (overlay nincs többé)
    const blokk = document.getElementById('sfd-review-modal');
    if (blokk) blokk.style.display = 'none';
    document.body.style.overflow = '';
    _sfdRv = { foglalasId:null, palyaId:null, helyszinId:null, rating:0, cimkek:[], meglevoId:null, submitting:false };
    // Inline state reset ha elérhető
    if (typeof window.spZarjInlineReview === 'function') window.spZarjInlineReview();
  }

  document.querySelectorAll('.sfd-review-star').forEach(star => {
    star.addEventListener('click', function() {
      const val = parseInt(this.dataset.val);
      _sfdRv.rating = val;
      document.querySelectorAll('.sfd-review-star').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.val) <= val);
      });
      const lbl = document.getElementById('sfd-review-rating-label');
      if (lbl) lbl.textContent = val + ' csillag – ' + (SFD_RATING_LABELS[val] || '');
      const btn = document.getElementById('sfd-review-submit-btn');
      if (btn) btn.disabled = false;
    });
  });

  document.querySelectorAll('.sfd-review-cimke').forEach(el => {
    el.addEventListener('click', function() {
      if (this.classList.contains('disabled')) return;
      const cimke = this.dataset.cimke;
      if (this.classList.contains('selected')) {
        this.classList.remove('selected');
        _sfdRv.cimkek = _sfdRv.cimkek.filter(c => c !== cimke);
      } else {
        if (_sfdRv.cimkek.length >= 3) return;
        this.classList.add('selected');
        _sfdRv.cimkek.push(cimke);
      }
      const maxed = _sfdRv.cimkek.length >= 3;
      document.querySelectorAll('.sfd-review-cimke').forEach(c => {
        if (!c.classList.contains('selected')) c.classList.toggle('disabled', maxed);
      });
    });
  });

  const sfdRvCancelBtn = document.getElementById('sfd-review-cancel-btn');
  if (sfdRvCancelBtn) sfdRvCancelBtn.addEventListener('click', sfdZarjReviewModal);
  // Overlay listener ELTÁVOLÍTVA – nincs overlay, inline blokk van
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && window._spInlineReviewOpen) {
      sfdZarjReviewModal();
    }
  });

  const sfdRvSubmitBtn = document.getElementById('sfd-review-submit-btn');
  if (sfdRvSubmitBtn) {
    sfdRvSubmitBtn.addEventListener('click', async function() {
      // ── 1+2. SUBMIT GUARD ──
      if (_sfdRv.submitting || window._reviewSubmitting) return;

      // ── PUBLIC MODE DETEKTÁLÁS ──
      // Ha window._spPublicReview van beállítva → public entry point-ból jöttünk
      var publicMode = !!(window._spPublicReview && window._spPublicReview.isPublic);
      var publicPalyaId = publicMode ? window._spPublicReview.palyaId : null;

      // ── NULL-SAFE errEl ──
      const errEl = document.getElementById('sfd-review-error');
      if (errEl) errEl.style.display = 'none';

      // Validációk
      if (!_sfdRv.rating && !publicMode) {
        if (errEl) { errEl.textContent = 'Kérjük adj csillag értékelést!'; errEl.style.display = 'block'; }
        return;
      }
      // Public mode: rating a csillag klikk állapotából jön
      var currentRating = _sfdRv.rating || 0;
      if (publicMode) {
        // Rating kiolvasása a DOM-ból – public modal esetén _sfdRv nem mindig frissül
        var activeStars = document.querySelectorAll('.sfd-review-star.active');
        currentRating = activeStars.length || 0;
      }
      if (!currentRating) {
        if (errEl) { errEl.textContent = 'Kérjük adj csillag értékelést!'; errEl.style.display = 'block'; }
        return;
      }
      if (!publicMode && (!_sfdRv.foglalasId || !_sfdRv.palyaId)) {
        if (errEl) { errEl.textContent = 'Hiányzó foglalás adat. Próbáld újra!'; errEl.style.display = 'block'; }
        return;
      }
      if (!currentUser) {
        if (errEl) { errEl.textContent = 'Bejelentkezés szükséges!'; errEl.style.display = 'block'; }
        return;
      }

      // ── ORIGINAL TEXT ──
      const originalText = this.textContent;

      // Guardok be
      _sfdRv.submitting = true;
      window._reviewSubmitting = true;
      this.disabled = true;
      this.textContent = '⏳ Küldés...';

      const szoveg = (document.getElementById('sfd-review-szoveg')?.value || '').trim();

      // Szöveg limit
      if (szoveg.length > 1000) {
        if (errEl) { errEl.textContent = 'Maximum 1000 karakter lehet.'; errEl.style.display = 'block'; }
        _sfdRv.submitting = false;
        window._reviewSubmitting = false;
        this.disabled = false;
        this.textContent = originalText;
        return;
      }

      // Cimkék kiolvasása
      var currentCimkek = publicMode
        ? Array.from(document.querySelectorAll('.sfd-review-cimke.selected')).map(function(el) { return el.dataset.cimke; })
        : (_sfdRv.cimkek || []);

      let dbError;
      let isUpdate = false;

      try {
        if (publicMode) {
          // ── PUBLIC INSERT – foglalas_id: null, review_tipus a trigger dönti el ──
          // FAIL-SAFE: ha null foglalás → 'public' típus (trigger és frontend default)
          var { error: pubErr } = await sb.from('ertekelesek').insert({
            foglalas_id: null,                     // szándékosan null – public review
            palya_id:    publicPalyaId,
            helyszin_id: null,
            user_id:     currentUser.id,
            user_nev:    currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || null,
            rating:      currentRating,
            szoveg:      szoveg || null,
            cimkek:      currentCimkek.length ? currentCimkek : null
            // review_tipus-t a DB trigger állítja – frontend nem dönt
          });

          // 23505 → már van public review → UPDATE
          if (pubErr && pubErr.code === '23505') {
            try {
              var { data: existing } = await sb.from('ertekelesek')
                .select('id')
                .eq('user_id', currentUser.id)
                .eq('palya_id', publicPalyaId)
                .single();
              if (existing?.id) {
                var { error: updErr } = await sb.from('ertekelesek')
                  .update({
                    rating:     currentRating,
                    szoveg:     szoveg || null,
                    cimkek:     currentCimkek.length ? currentCimkek : null,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', existing.id);
                dbError = updErr;
                isUpdate = true;
              } else {
                dbError = pubErr;
              }
            } catch(e) { dbError = pubErr; }
          } else {
            dbError = pubErr;
          }

        } else if (_sfdRv.meglevoId) {
          // ── DRAWER: ismert meglévő review → UPDATE ──
          var { error: updErr } = await sb.from('ertekelesek')
            .update({
              rating:     _sfdRv.rating,
              szoveg:     szoveg || null,
              cimkek:     _sfdRv.cimkek.length ? _sfdRv.cimkek : null,
              updated_at: new Date().toISOString()
            })
            .eq('id', _sfdRv.meglevoId);
          dbError = updErr;
          isUpdate = true;

        } else {
          // ── DRAWER: INSERT kísérlet ──
          var { error: insErr } = await sb.from('ertekelesek').insert({
            foglalas_id: _sfdRv.foglalasId, palya_id: _sfdRv.palyaId,
            helyszin_id: _sfdRv.helyszinId || null, user_id: currentUser.id,
            user_nev:    currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || null,
            rating:      _sfdRv.rating, szoveg: szoveg || null,
            cimkek:      _sfdRv.cimkek.length ? _sfdRv.cimkek : null
          });

          if (insErr && insErr.code === '23505') {
            try {
              var { data: existing } = await sb.from('ertekelesek')
                .select('id')
                .eq('user_id', currentUser.id)
                .eq('palya_id', _sfdRv.palyaId)
                .single();
              if (existing?.id) {
                var { error: updErr } = await sb.from('ertekelesek')
                  .update({
                    rating:     _sfdRv.rating,
                    szoveg:     szoveg || null,
                    cimkek:     _sfdRv.cimkek.length ? _sfdRv.cimkek : null,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', existing.id);
                dbError = updErr;
                isUpdate = true;
              } else { dbError = insErr; }
            } catch(e) { dbError = insErr; }
          } else {
            dbError = insErr;
          }
        }

      } catch(unexpectedErr) {
        console.error('[sfdReviewSubmit] Váratlan hiba:', unexpectedErr);
        dbError = { message: 'Váratlan hiba történt.' };
      } finally {
        // ── GUARANTEED RESET ──
        _sfdRv.submitting = false;
        window._reviewSubmitting = false;
        this.disabled = false;
        this.textContent = originalText;
        // Public state törlése
        if (publicMode) window._spPublicReview = null;
      }

      if (dbError) {
        let uzenet = 'Hiba történt. Kérjük próbáld újra!';
        if (dbError.code === '23505' || dbError.message?.includes('egy_user_egy_palya')) uzenet = 'Ehhez a pályához már van értékelésed.';
        else if (dbError.message?.includes('nem a te foglalásod')) uzenet = 'Ez a foglalás nem a te foglalásod.';
        else if (dbError.message?.includes('jóváhagyott')) uzenet = 'Csak jóváhagyott foglaláshoz lehet értékelést írni.';
        else if (dbError.message?.includes('lezajlott')) uzenet = 'Csak már lezajlott foglaláshoz lehet értékelést írni.';
        else if (dbError.message?.includes('Review identity')) uzenet = 'Hiba történt az értékelés mentésénél.';
        else if (dbError.message?.includes('Váratlan')) uzenet = 'Váratlan hiba. Kérjük próbáld újra!';
        if (errEl) { errEl.textContent = uzenet; errEl.style.display = 'block'; }
        return;
      }

      // ── SMOOTH CLOSE ──
      setTimeout(() => { sfdZarjReviewModal(); }, 250);
      showSfdToast(isUpdate ? '✏️ Értékelésed frissítve!' : '⭐ Köszönjük az értékelést!');
      await loadBookings();
    });
  }

  // ── WINDOW BRIDGE – külső kód (pl. web-palya-29.html) eléri ezeket ──
  window.sfdZarjReviewModalGlobal = sfdZarjReviewModal;
  window.sfdOpenLoginModalGlobal  = openLoginModal;
  window.sfdCloseDrawerGlobal     = closeDrawer;

  // ── PUBLIC REVIEW SIGNED_IN HOOK ──
  // Ha login után window._spPublicReviewPending van → review modal megnyitása
  // Ez az onAuthStateChange-ben már fut, kiegészítjük itt
  const _origOnAuth = sb.auth.onAuthStateChange;
  // A hook a meglévő onAuthStateChange callback után fut
  // window._spPublicReviewPending = { palyaId, palyaNev } – a palya oldal állítja be
  const _checkPublicReviewPending = function() {
    var pending = window._spPublicReviewPending;
    if (!pending || !currentUser) return;
    window._spPublicReviewPending = null;

    // ── Drawer bezárása garantáltan, MAJD modal nyitás ──
    // Az eredeti SIGNED_IN handler closeLoginModal()-t hív (body overflow reset kell)
    // + drawer animáció: 350ms + buffer = 500ms elegendő
    closeDrawer(); // explicit bezárás – safe ha már zárva
    setTimeout(function() {
      if (typeof window.spNyitPublicReviewModal === 'function') {
        window.spNyitPublicReviewModal(pending.palyaId, pending.palyaNev, null);
      }
    }, 500);
  };

  // Felülírjuk az auth state change callback-et hogy a pending hook fusson
  sb.auth.onAuthStateChange(function(event, session) {
    if (event === 'SIGNED_IN' && session) {
      _checkPublicReviewPending();
    }
  });

})();
