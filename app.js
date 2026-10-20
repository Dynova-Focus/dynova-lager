import * as gh from './github.js'

const main = document.querySelector('main')
const nav = document.querySelector('nav')
const meldung = document.querySelector('output')

const STAENDE = { voll: 'Voll', knapp: 'Knapp', leer: 'Leer' }
const ZUSTAENDE = { ok: 'Funktioniert', maengel: 'Mit Mängeln', defekt: 'Defekt' }
const TOKEN_LINK = 'https://github.com/settings/personal-access-tokens/new?name=Dynova+Lager&description=Zugang+zum+Dynova+Lager&target_name=Dynova-Focus&expires_in=366&contents=write'

let daten = null
let server = null
let user = null
let offen = 0
let kette = Promise.resolve()
let suche = ''
let meldungTimer

const leer = () => ({ orte: [], dinge: [], leute: {} })

const esc = wert => String(wert ?? '').replace(/[&<>"']/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[z])

const cache = {
  lesen() { try { return JSON.parse(localStorage.getItem('lager-cache')) } catch { return null } },
  schreiben(wert) { try { localStorage.setItem('lager-cache', JSON.stringify(wert)) } catch {} }
}

const anzeigeName = login => daten?.leute?.[login] || login
const personName = login => login === user?.login ? 'dir' : anzeigeName(login)

const nachName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true })
const nachId = (a, b) => a.id.localeCompare(b.id, 'de', { numeric: true })

const finde = (d, id) => d.dinge.find(x => x.id === id)

function seit(iso) {
  const tage = Math.floor((Date.now() - Date.parse(iso)) / 864e5)
  if (Number.isNaN(tage)) return ''
  return tage < 1 ? 'seit heute' : tage === 1 ? 'seit gestern' : `seit ${tage} Tagen`
}

const datum = iso => new Date(iso).toLocaleString('de-CH', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' })

function sichererLink(wert) {
  try {
    const url = new URL(wert.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

function neueId() {
  let id
  do id = Math.random().toString(36).slice(2, 8)
  while (daten.dinge.some(x => x.id === id))
  return id
}

function melden(text, fehler = false) {
  meldung.value = text
  meldung.toggleAttribute('data-fehler', fehler)
  clearTimeout(meldungTimer)
  meldungTimer = setTimeout(() => { meldung.value = '' }, fehler ? 6000 : 1800)
}

function logbuch(x, kontext, text) {
  x.verlauf ??= []
  x.verlauf.push({ t: kontext.jetzt, wer: kontext.wer, text })
  if (x.verlauf.length > 100) x.verlauf.splice(0, x.verlauf.length - 100)
}

function aendern(text, fn) {
  const kontext = { jetzt: new Date().toISOString(), wer: user.login }
  const anwenden = d => {
    d.leute ??= {}
    d.leute[user.login] = user.name || user.login
    fn(d, kontext)
  }
  anwenden(daten)
  auffrischen()
  offen++
  kette = kette
    .then(() => sichern(text, anwenden))
    .finally(() => {
      if (--offen) return
      daten = structuredClone(server.daten)
      auffrischen()
    })
}

async function sichern(text, anwenden) {
  for (let versuch = 0; versuch < 5; versuch++) {
    const neu = structuredClone(server.daten)
    anwenden(neu)
    try {
      const sha = await gh.speichern(neu, server.sha, `${user.name || user.login}: ${text}`)
      server = { daten: neu, sha }
      cache.schreiben({ user, ...server })
      melden('Gespeichert')
      return
    } catch (fehler) {
      if (fehler.status === 409 || fehler.status === 422) {
        await neuLaden()
        continue
      }
      if (fehler.status === 401) return abgelaufen()
      break
    }
  }
  melden(`Nicht gespeichert: ${text}`, true)
}

async function neuLaden() {
  const { daten: d, sha } = await gh.laden()
  server = { daten: d ?? leer(), sha }
  server.daten.leute ??= {}
  if (!offen) daten = structuredClone(server.daten)
  cache.schreiben({ user, ...server })
}

function auffrischen() {
  const fokus = document.activeElement
  if (fokus?.matches('search input')) return startListe()
  if (fokus?.closest('form')) return
  zeigen()
}

function dingZeile(x, mitOrt = true) {
  const info = [
    x.kategorie,
    mitOrt && x.ort,
    x.art === 'stueck' && x.bei && `bei ${personName(x.bei)} ${seit(x.seit)}`,
    x.art === 'stueck' && x.zustand !== 'ok' && ZUSTAENDE[x.zustand],
    x.art === 'teil' && x.menge != null && `${x.menge} Stk.`
  ].filter(Boolean).join(' · ')
  return `<li><a href="#/ding/${x.id}"><strong>${esc(x.name)}</strong><small>${esc(info)}</small></a>${steuerung(x)}</li>`
}

function steuerung(x) {
  if (x.art === 'teil') {
    return `<span role="group" aria-label="Füllstand">${Object.entries(STAENDE).map(([wert, text]) =>
      `<button data-tun="stand" data-id="${x.id}" data-wert="${wert}" aria-pressed="${x.stand === wert}">${text}</button>`).join('')}</span>`
  }
  if (!x.bei) return `<button data-tun="nehmen" data-id="${x.id}">Nehmen</button>`
  if (x.bei === user.login) return `<button data-tun="zurueck" data-id="${x.id}" data-sekundaer>Zurück</button>`
  return `<button data-tun="nehmen" data-id="${x.id}" data-sekundaer>Übernehmen</button>`
}

const liste = dinge => `<ul>${dinge.map(x => dingZeile(x)).join('')}</ul>`

function ortRaster(orte) {
  return `<ul data-raster>${orte.map(o => {
    const anzahl = daten.dinge.filter(x => x.ort === o.id).length
    return `<li><a href="#/ort/${encodeURIComponent(o.id)}"><strong>${esc(o.id)}</strong><small>${esc(o.name || 'Ohne Namen')} · ${anzahl}</small></a></li>`
  }).join('')}</ul>`
}

function loginSeite(hinweis = '') {
  nav.hidden = true
  main.innerHTML = `
<h1>Willkommen im Dynova Lager</h1>
<p>Jedes Handy und jeder Laptop wird einmal eingerichtet. Danach bleibst du angemeldet, bis der Schlüssel nach einem Jahr abläuft.</p>
${hinweis ? `<p role="alert">${esc(hinweis)}</p>` : ''}
<ol data-schritte>
<li><a href="${TOKEN_LINK}" target="_blank" rel="noopener">Schlüssel auf GitHub erstellen</a> (dazu bei GitHub angemeldet sein)</li>
<li><strong>Resource owner:</strong> Dynova-Focus</li>
<li><strong>Repository access:</strong> Only select repositories → <code>dynova-lager-data</code></li>
<li><strong>Permissions:</strong> Contents → <em>Read and write</em></li>
<li>Unten auf <em>Generate token</em>, Schlüssel kopieren und hier einfügen</li>
</ol>
<form data-form="login">
<label>Schlüssel<input name="token" type="password" autocomplete="off" required placeholder="github_pat_…"></label>
<button>Verbinden</button>
</form>`
}

function abgelaufen() {
  gh.token.weg()
  daten = null
  loginSeite('Dein Schlüssel ist abgelaufen oder ungültig. Bitte einen neuen erstellen.')
}

function startSeite() {
  main.innerHTML = `<search><input type="search" placeholder="Suchen: Bauteil, Board, Werkzeug, Person …" aria-label="Suchen" value="${esc(suche)}"></search><section></section>`
  const feld = main.querySelector('input')
  feld.addEventListener('input', () => { suche = feld.value; startListe() })
  startListe()
}

function startListe() {
  const bereich = main.querySelector('search + section')
  if (!bereich) return
  const woerter = suche.toLowerCase().split(/\s+/).filter(Boolean)
  if (woerter.length) {
    const passt = text => woerter.every(w => text.toLowerCase().includes(w))
    const dinge = daten.dinge.filter(x => passt([x.name, x.kategorie, x.notiz, x.ort, x.bei && personName(x.bei)].join(' '))).sort(nachName)
    const orte = daten.orte.filter(o => passt(`${o.id} ${o.name} ${o.notiz}`)).sort(nachId)
    bereich.innerHTML = (dinge.length ? liste(dinge) : '') + (orte.length ? ortRaster(orte) : '') || '<p>Nichts gefunden.</p>'
    return
  }
  const meine = daten.dinge.filter(x => x.bei === user.login).sort(nachName)
  bereich.innerHTML = (meine.length ? `<h2>Bei dir</h2>${liste(meine)}` : '') + `<h2>Orte</h2>${ortRaster([...daten.orte].sort(nachId))}`
}

function ortSeite(id) {
  const ort = daten.orte.find(o => o.id === id)
  if (!ort) {
    main.innerHTML = `<h1>${esc(id)}</h1><p>Diesen Ort gibt es noch nicht.</p><button data-tun="ortAnlegen" data-id="${esc(id)}">${esc(id)} anlegen</button>`
    return
  }
  const dinge = daten.dinge.filter(x => x.ort === id).sort(nachName)
  main.innerHTML = `
<h1>${esc(ort.id)} <small>${esc(ort.name)}</small></h1>
${ort.notiz ? `<p>${esc(ort.notiz)}</p>` : ''}
${dinge.length ? `<ul>${dinge.map(x => dingZeile(x, false)).join('')}</ul>` : '<p>Hier ist noch nichts erfasst.</p>'}
<p><a href="#/neu/${encodeURIComponent(ort.id)}" role="button">Neues Ding hier</a></p>
<details>
<summary>Ort bearbeiten</summary>
<form data-form="ort" data-id="${esc(ort.id)}">
<label>Name<input name="name" value="${esc(ort.name)}" placeholder="z. B. Sensorik, Kabel, Lötzubehör"></label>
<label>Notiz<textarea name="notiz" rows="2">${esc(ort.notiz)}</textarea></label>
<button>Speichern</button>
${dinge.length ? '' : `<button type="button" data-tun="ortLoeschen" data-id="${esc(ort.id)}" data-gefahr>Ort löschen</button>`}
</form>
</details>`
}

function dingSeite(id) {
  const x = finde(daten, id)
  if (!x) {
    main.innerHTML = '<h1>Nicht gefunden</h1><p>Dieses Ding wurde gelöscht oder der QR-Code ist falsch.</p>'
    return
  }
  const zeilen = [
    ['Ort', `<a href="#/ort/${encodeURIComponent(x.ort)}">${esc(x.ort)}</a>`],
    x.kategorie && ['Kategorie', esc(x.kategorie)],
    x.art === 'teil' ? ['Füllstand', STAENDE[x.stand]] : ['Zustand', ZUSTAENDE[x.zustand]],
    x.art === 'teil' && x.menge != null && ['Menge', `${x.menge} Stk.`],
    x.art === 'stueck' && ['Bei', x.bei ? `${esc(personName(x.bei))}, ${seit(x.seit)}` : 'Im Lager'],
    x.link && ['Link', `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(new URL(x.link).hostname)}</a>`],
    x.notiz && ['Notiz', esc(x.notiz)]
  ].filter(Boolean)
  main.innerHTML = `
<h1>${esc(x.name)}</h1>
<dl>${zeilen.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
<p>${steuerung(x)}</p>
<h2>Logbuch</h2>
<form data-form="logbuch" data-id="${x.id}">
<input name="text" required aria-label="Eintrag" placeholder="z. B. ADC-Kanal 3 rauscht">
<button>Eintragen</button>
</form>
<ol>${[...(x.verlauf ?? [])].reverse().map(v => `<li><time>${datum(v.t)}</time> <strong>${esc(anzeigeName(v.wer))}</strong> ${esc(v.text)}</li>`).join('')}</ol>
<details>
<summary>Bearbeiten</summary>
${dingFormular(x)}
<button data-tun="dingLoeschen" data-id="${x.id}" data-gefahr>Löschen</button>
</details>`
}

function dingFormular(x = {}, ortId) {
  const neu = !x.id
  const art = x.art ?? 'teil'
  const ort = x.ort ?? ortId ?? daten.orte[0]?.id
  const kategorien = [...new Set(daten.dinge.map(d => d.kategorie).filter(Boolean))].sort()
  return `
<form data-form="ding"${neu ? '' : ` data-id="${x.id}"`}>
${neu ? `<fieldset>
<legend>Was ist es?</legend>
<label><input type="radio" name="art" value="teil" checked><span>Material mit Füllstand<small>Widerstände, Stecker, Kabel, Schrauben</small></span></label>
<label><input type="radio" name="art" value="stueck"><span>Einzelstück zum Ausleihen<small>Eigene Boards, Werkzeug, Messgeräte</small></span></label>
</fieldset>` : ''}
<label>Name<input name="name" required value="${esc(x.name)}" placeholder="z. B. 10 kΩ 0603 oder Control-Board Rev 2"></label>
<label>Kategorie<input name="kategorie" list="kategorien" value="${esc(x.kategorie)}" placeholder="z. B. Widerstand, Board, Werkzeug"></label>
<datalist id="kategorien">${kategorien.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
<label>Ort<select name="ort">${[...daten.orte].sort(nachId).map(o => `<option value="${esc(o.id)}"${o.id === ort ? ' selected' : ''}>${esc(o.id)}${o.name ? ` · ${esc(o.name)}` : ''}</option>`).join('')}</select></label>
${neu || art === 'teil' ? `<label data-nur="teil">Menge <small>(optional, nur bei teuren Teilen nötig)</small><input name="menge" type="number" min="0" inputmode="numeric" value="${esc(x.menge)}"></label>` : ''}
${!neu && art === 'stueck' ? `<label>Zustand<select name="zustand">${Object.entries(ZUSTAENDE).map(([k, v]) => `<option value="${k}"${x.zustand === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
<label>Link <small>(Shop, Datenblatt, Repo)</small><input name="link" type="url" value="${esc(x.link)}" placeholder="https://"></label>
<label>Notiz<textarea name="notiz" rows="2">${esc(x.notiz)}</textarea></label>
${neu ? '<label data-nur="stueck">Anzahl <small>(legt nummerierte Stücke an: #1, #2 …)</small><input name="anzahl" type="number" min="1" max="50" value="1" inputmode="numeric"></label>' : ''}
<button>${neu ? 'Anlegen' : 'Speichern'}</button>
</form>`
}

function neuSeite(ortId) {
  if (!daten.orte.length) {
    main.innerHTML = '<h1>Neues Ding</h1><p>Lege zuerst unter <a href="#/mehr">Mehr</a> einen Ort an.</p>'
    return
  }
  main.innerHTML = `<h1>Neues Ding</h1>${dingFormular({}, ortId)}`
}

function ausgeliehenSeite() {
  const weg = daten.dinge.filter(x => x.bei)
  const meine = weg.filter(x => x.bei === user.login).sort(nachName)
  const andere = {}
  for (const x of weg.filter(x => x.bei !== user.login)) (andere[x.bei] ??= []).push(x)
  main.innerHTML = `
<h1>Ausgeliehen</h1>
<h2>Bei dir</h2>
${meine.length ? liste(meine) : '<p>Du hast nichts ausgeliehen.</p>'}
${Object.entries(andere).sort(([a], [b]) => personName(a).localeCompare(personName(b))).map(([login, dinge]) =>
  `<h2>Bei ${esc(personName(login))}</h2>${liste(dinge.sort(nachName))}`).join('')}`
}

function knappSeite() {
  const rang = { leer: 0, knapp: 1 }
  const dinge = daten.dinge.filter(x => x.art === 'teil' && x.stand in rang).sort((a, b) => rang[a.stand] - rang[b.stand] || nachName(a, b))
  main.innerHTML = `
<h1>Bestellen</h1>
<p>Alles, was als knapp oder leer markiert ist. Nach dem Auffüllen auf <em>Voll</em> tippen.</p>
${dinge.length ? `<ul>${dinge.map(x => dingZeile(x).replace('</a>', `</a>${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener" aria-label="Im Shop öffnen">↗</a>` : ''}`)).join('')}</ul>` : '<p>Nichts zu bestellen.</p>'}`
}

function mehrSeite() {
  main.innerHTML = `
<h1>Mehr</h1>
<h2>Neuer Ort</h2>
<form data-form="ortNeu">
<label>Kürzel<input name="id" required placeholder="z. B. A31 oder REGAL-OBEN" autocapitalize="characters"></label>
<label>Name<input name="name" placeholder="z. B. Lötplatz, Schrank Messgeräte"></label>
<button>Anlegen</button>
</form>
<h2>Etiketten</h2>
<p><a href="#/etiketten" role="button">QR-Codes drucken</a></p>
<h2>Verlauf</h2>
<p><a href="https://github.com/${gh.REPO}/commits/main" target="_blank" rel="noopener">Alle Änderungen auf GitHub ansehen</a></p>
<h2>Konto</h2>
<p>Angemeldet als <strong>${esc(user.name || user.login)}</strong> (${esc(user.login)})</p>
<button data-tun="abmelden" data-sekundaer>Abmelden</button>`
}

function qr(text) {
  if (typeof qrcode !== 'function') return `<p>${esc(text)}</p>`
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
}

function etikettenSeite() {
  const basis = location.origin + location.pathname
  const etikett = (pfad, gross, klein) => `<figure>${qr(basis + pfad)}<figcaption><strong>${esc(gross)}</strong>${klein ? `<small>${esc(klein)}</small>` : ''}</figcaption></figure>`
  const stuecke = daten.dinge.filter(x => x.art === 'stueck').sort(nachName)
  main.innerHTML = `
<h1>Etiketten</h1>
<p>Auf A4 drucken, ausschneiden und mit breitem Klebeband überkleben. Die Codes bleiben gültig, auch wenn sich der Inhalt ändert.</p>
<label><input type="checkbox" id="stuecke"> Auch Einzelstücke (Boards, Werkzeug)</label>
<p><button data-tun="drucken">Drucken</button></p>
<section data-etiketten>${[...daten.orte].sort(nachId).map(o => etikett(`#/ort/${encodeURIComponent(o.id)}`, o.id, o.name)).join('')}</section>
<section data-etiketten data-stuecke>${stuecke.map(x => etikett(`#/ding/${x.id}`, x.name, x.kategorie)).join('')}</section>`
}

const routen = [
  [/^#\/ort\/(.+)$/, ortSeite],
  [/^#\/ding\/(.+)$/, dingSeite],
  [/^#\/neu(?:\/(.+))?$/, neuSeite],
  [/^#\/ausgeliehen$/, ausgeliehenSeite],
  [/^#\/knapp$/, knappSeite],
  [/^#\/mehr$/, mehrSeite],
  [/^#\/etiketten$/, etikettenSeite]
]

function zeigen() {
  if (!daten || !user) return
  nav.hidden = false
  const hash = decodeURIComponent(location.hash)
  for (const a of nav.querySelectorAll('a')) a.toggleAttribute('aria-current', hash.startsWith(a.getAttribute('href')))
  for (const [muster, seite] of routen) {
    const treffer = hash.match(muster)
    if (treffer) return seite(treffer[1])
  }
  startSeite()
}

const aktionen = {
  stand({ id, wert }) {
    const x = finde(daten, id)
    if (!x || x.stand === wert) return
    aendern(`${x.name} ist ${STAENDE[wert].toLowerCase()}`, (d, k) => {
      const y = finde(d, id)
      if (!y) return
      y.stand = wert
      logbuch(y, k, `Füllstand: ${STAENDE[wert]}`)
    })
  },
  nehmen({ id }) {
    const x = finde(daten, id)
    if (!x) return
    aendern(`nimmt ${x.name}`, (d, k) => {
      const y = finde(d, id)
      if (!y) return
      logbuch(y, k, y.bei && y.bei !== k.wer ? `übernommen von ${d.leute[y.bei] || y.bei}` : 'genommen')
      y.bei = k.wer
      y.seit = k.jetzt
    })
  },
  zurueck({ id }) {
    const x = finde(daten, id)
    if (!x) return
    aendern(`legt ${x.name} zurück in ${x.ort}`, (d, k) => {
      const y = finde(d, id)
      if (!y) return
      y.bei = null
      y.seit = null
      logbuch(y, k, `zurückgelegt in ${y.ort}`)
    })
  },
  dingLoeschen({ id }) {
    const x = finde(daten, id)
    if (!x || !confirm(`${x.name} wirklich löschen?`)) return
    location.hash = `#/ort/${encodeURIComponent(x.ort)}`
    aendern(`löscht ${x.name}`, d => { d.dinge = d.dinge.filter(y => y.id !== id) })
  },
  ortAnlegen({ id }) {
    aendern(`neuer Ort ${id}`, d => { if (!d.orte.some(o => o.id === id)) d.orte.push({ id, name: '', notiz: '' }) })
  },
  ortLoeschen({ id }) {
    if (!confirm(`Ort ${id} löschen?`)) return
    location.hash = '#/'
    aendern(`löscht Ort ${id}`, d => {
      if (d.dinge.some(x => x.ort === id)) return
      d.orte = d.orte.filter(o => o.id !== id)
    })
  },
  drucken() { print() },
  abmelden() {
    if (!confirm('Abmelden? Du brauchst danach wieder einen Schlüssel.')) return
    gh.token.weg()
    daten = null
    user = null
    loginSeite()
  }
}

const formulare = {
  async login(form) {
    const schluessel = new FormData(form).get('token').trim()
    const knopf = form.querySelector('button')
    knopf.disabled = true
    gh.token.set(schluessel)
    try {
      user = await gh.ich()
      if (!await gh.zugriff()) throw Object.assign(new Error(), { status: 403 })
      await neuLaden()
      location.hash = '#/'
      zeigen()
    } catch (fehler) {
      gh.token.weg()
      user = null
      loginSeite(fehler.status === 401
        ? 'Dieser Schlüssel funktioniert nicht. Wurde er vollständig kopiert?'
        : fehler.status === 403 || fehler.status === 404
          ? 'Der Schlüssel hat keinen Schreibzugriff auf dynova-lager-data. Prüfe Repository und Permissions, oder warte, bis ein Org-Admin den Schlüssel freigegeben hat.'
          : 'Keine Verbindung zu GitHub. Bitte nochmals versuchen.')
    }
  },
  ding(form) {
    const f = Object.fromEntries(new FormData(form))
    const felder = {
      name: f.name.trim(),
      kategorie: f.kategorie.trim(),
      ort: f.ort,
      link: sichererLink(f.link),
      notiz: f.notiz.trim()
    }
    const menge = f.menge === undefined ? undefined : f.menge === '' ? null : Math.max(0, Number(f.menge))
    const id = form.dataset.id
    if (id) {
      aendern(`bearbeitet ${felder.name}`, (d, k) => {
        const y = finde(d, id)
        if (!y) return
        if (y.ort !== felder.ort) logbuch(y, k, `verschoben nach ${felder.ort}`)
        if (f.zustand && y.zustand !== f.zustand) logbuch(y, k, `Zustand: ${ZUSTAENDE[f.zustand]}`)
        Object.assign(y, felder)
        if (menge !== undefined) y.menge = menge
        if (f.zustand) y.zustand = f.zustand
      })
      zeigen()
      return
    }
    const stueck = f.art === 'stueck'
    const anzahl = stueck ? Math.min(50, Math.max(1, Number(f.anzahl) || 1)) : 1
    const ids = []
    while (ids.length < anzahl) {
      const neu = neueId()
      if (!ids.includes(neu)) ids.push(neu)
    }
    aendern(`neu: ${felder.name}${anzahl > 1 ? ` (${anzahl}×)` : ''}`, (d, k) => {
      ids.forEach((neu, i) => {
        if (finde(d, neu)) return
        const x = {
          id: neu,
          art: stueck ? 'stueck' : 'teil',
          ...felder,
          name: anzahl > 1 ? `${felder.name} #${i + 1}` : felder.name,
          ...(stueck ? { zustand: 'ok', bei: null, seit: null } : { stand: 'voll', menge: menge ?? null }),
          verlauf: []
        }
        logbuch(x, k, 'angelegt')
        d.dinge.push(x)
      })
    })
    location.hash = anzahl > 1 ? `#/ort/${encodeURIComponent(felder.ort)}` : `#/ding/${ids[0]}`
  },
  logbuch(form) {
    const id = form.dataset.id
    const text = new FormData(form).get('text').trim()
    const x = finde(daten, id)
    if (!text || !x) return
    aendern(`Logbuch ${x.name}`, (d, k) => {
      const y = finde(d, id)
      if (y) logbuch(y, k, text)
    })
    form.reset()
    zeigen()
  },
  ort(form) {
    const id = form.dataset.id
    const f = Object.fromEntries(new FormData(form))
    const name = f.name.trim()
    const notiz = f.notiz.trim()
    aendern(`bearbeitet Ort ${id}`, d => {
      const o = d.orte.find(o => o.id === id)
      if (o) Object.assign(o, { name, notiz })
    })
    zeigen()
  },
  ortNeu(form) {
    const f = Object.fromEntries(new FormData(form))
    const id = f.id.trim().toUpperCase().replace(/\s+/g, '-')
    const name = f.name.trim()
    if (!id) return
    if (!daten.orte.some(o => o.id === id)) {
      aendern(`neuer Ort ${id}`, d => { if (!d.orte.some(o => o.id === id)) d.orte.push({ id, name, notiz: '' }) })
    }
    location.hash = `#/ort/${encodeURIComponent(id)}`
  }
}

document.addEventListener('click', e => {
  const knopf = e.target.closest('[data-tun]')
  if (!knopf || !aktionen[knopf.dataset.tun]) return
  e.preventDefault()
  aktionen[knopf.dataset.tun](knopf.dataset)
})

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form]')
  if (!form || !formulare[form.dataset.form]) return
  e.preventDefault()
  formulare[form.dataset.form](form)
})

addEventListener('hashchange', () => {
  zeigen()
  scrollTo(0, 0)
})

document.addEventListener('visibilitychange', async () => {
  if (document.hidden || !user || offen) return
  try {
    await neuLaden()
    auffrischen()
  } catch {}
})

async function start() {
  if (!gh.token.get()) return loginSeite()
  const gespeichert = cache.lesen()
  if (gespeichert?.daten && gespeichert.user) {
    user = gespeichert.user
    daten = structuredClone(gespeichert.daten)
    server = { daten: gespeichert.daten, sha: gespeichert.sha }
    zeigen()
  } else {
    main.innerHTML = '<p>Lager wird geladen …</p>'
  }
  try {
    user = await gh.ich()
    await neuLaden()
    auffrischen()
  } catch (fehler) {
    if (fehler.status === 401) return abgelaufen()
    if (fehler.status === 403 || fehler.status === 404) {
      gh.token.weg()
      return loginSeite('Kein Zugriff mehr auf das Lager. Bitte einen neuen Schlüssel erstellen.')
    }
    if (daten) melden('Offline: zeige letzten Stand', true)
    else main.innerHTML = '<h1>Keine Verbindung</h1><p>GitHub ist gerade nicht erreichbar. Seite später neu laden.</p>'
  }
}

start()
