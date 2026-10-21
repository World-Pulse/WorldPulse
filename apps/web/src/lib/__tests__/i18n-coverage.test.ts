/**
 * Spanish, French and Portuguese have every English phrase (plan L2, Oct 21,
 * 2026). They are the languages WorldPulse reads news in (51, 55 and 17
 * feeds), so the first a reader would be offered; until now each lacked 19
 * phrases, all menu entries added after the files were made (a reader would
 * have seen those entries in English). The new phrases are machine
 * translations, for a native reader to check
 * (departments/languages/missing-phrases-2026-10-21.md in the desk).
 *
 * A new English phrase needs its Spanish, French and Portuguese too.
 */
import { describe, it, expect } from 'vitest'
import en from '../../../messages/en.json'
import es from '../../../messages/es.json'
import fr from '../../../messages/fr.json'
import pt from '../../../messages/pt.json'

type Tree = { [k: string]: string | Tree }

function phrases(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else Object.assign(out, phrases(v, key))
  }
  return out
}

const english = phrases(en as Tree)
const languages = { es, fr, pt } as Record<string, Tree>

describe('Spanish, French and Portuguese', () => {
  for (const [code, messages] of Object.entries(languages)) {
    const own = phrases(messages)

    it(`${code}: every English phrase, and none that English lacks`, () => {
      expect(Object.keys(english).filter(k => !(k in own))).toEqual([])
      expect(Object.keys(own).filter(k => !(k in english))).toEqual([])
    })

    it(`${code}: the menu is not left in English`, () => {
      // the same in English and in this language: the name, and French words that are English too
      const sameWord = new Set(['WorldPulse', 'Finance', 'Sanctions', 'Sources', 'Notifications', 'Mentions', 'Culture', 'Tech', 'IMPACT'])
      const left = Object.entries(english)
        .filter(([k, v]) => k.startsWith('nav.') && own[k] === v && !sameWord.has(v))
        .map(([k]) => k)
      expect(left).toEqual([])
    })

    it(`${code}: placeholders kept`, () => {
      for (const [k, v] of Object.entries(english)) {
        const wanted = (v.match(/\{\w+\}/g) ?? []).sort()
        expect((own[k]?.match(/\{\w+\}/g) ?? []).sort(), `${code} ${k}`).toEqual(wanted)
      }
    })
  }
})
