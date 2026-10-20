export const REPO = 'Dynova-Focus/dynova-lager-data'
const DATEI = 'lager.json'
const API = 'https://api.github.com'

const speicher = schluessel => ({
  get: () => { try { return localStorage.getItem(schluessel) } catch { return null } },
  set: wert => { try { localStorage.setItem(schluessel, wert) } catch {} }
})

export const token = speicher('lager-token')
export const name = speicher('lager-name')

export function abmelden() {
  try { ['lager-token', 'lager-name', 'lager-cache'].forEach(k => localStorage.removeItem(k)) } catch {}
}

async function anfrage(pfad, optionen = {}) {
  const antwort = await fetch(API + pfad, {
    ...optionen,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token.get()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!antwort.ok) {
    const fehler = new Error(`GitHub ${antwort.status}`)
    fehler.status = antwort.status
    throw fehler
  }
  return antwort.json()
}

const zuBase64 = text => {
  const bytes = new TextEncoder().encode(text)
  let binaer = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binaer)
}

const ausBase64 = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, '')), c => c.charCodeAt(0)))

export const zugriff = async () => (await anfrage(`/repos/${REPO}`)).permissions?.push === true

export async function laden() {
  try {
    const datei = await anfrage(`/repos/${REPO}/contents/${DATEI}`)
    return { daten: JSON.parse(ausBase64(datei.content)), sha: datei.sha }
  } catch (fehler) {
    if (fehler.status === 404) return { daten: null, sha: null }
    throw fehler
  }
}

export async function speichern(daten, sha, nachricht) {
  const inhalt = { message: nachricht, content: zuBase64(JSON.stringify(daten, null, 2) + '\n') }
  if (sha) inhalt.sha = sha
  const antwort = await anfrage(`/repos/${REPO}/contents/${DATEI}`, { method: 'PUT', body: JSON.stringify(inhalt) })
  return antwort.content.sha
}
