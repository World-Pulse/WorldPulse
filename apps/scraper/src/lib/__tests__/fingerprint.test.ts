/**
 * In-house fingerprints (lib/fingerprint.ts).
 *
 * The tokenizer and the averaging were checked against the reference
 * implementations on Oct 16, 2026 (Hugging Face tokenizers and Minish Lab's
 * model2vec 0.10, on 1,019 WorldPulse headlines and summaries plus tricky
 * text): identical word-piece ids for all, fingerprints within 0.9999 cosine
 * of the exact float math. These tests pin the rules with a small vocabulary;
 * the last group runs on the real model when it is on disk.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import {
  FINGERPRINT_DIMS, FINGERPRINT_MODEL, convertTable, decodeCompact, encodeCompact, fingerprintWith,
  normalizeText, parseVocab, reportText, similarity, splitWords, toVectorLiteral, tokenIds,
  type FingerprintModel,
} from '../fingerprint'

const VOCAB = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'two', 'ship', '##s', 'sink', 'near', 'horm', '##uz', ',', '.',
  'cafe', 'mu', '##ller', 'σοφος', '東', '京', '!', 'iran', 'tank', '##er'].join('\n')

describe('word pieces', () => {
  const vocab = parseVocab(VOCAB)

  it('lower-cases, strips accents and spaces out Chinese characters', () => {
    expect(normalizeText('Café MÜLLER')).toBe('cafe muller')
    expect(normalizeText('ΣΟΦΟΣ')).toBe('σοφοσ')          // no final-sigma rule, as the reference
    expect(normalizeText('東京')).toBe(' 東  京 ')
    expect(normalizeText('a\u0000b﻿c\td')).toBe('abc d')  // control characters go, a tab is a space
  })

  it('splits around every punctuation mark', () => {
    expect(splitWords("u.s.-led ships, don't")).toEqual(['u', '.', 's', '.', '-', 'led', 'ships', ',', 'don', "'", 't'])
  })

  it('finds the longest pieces, drops unknown words and never adds special tokens', () => {
    const ids = (t: string) => tokenIds(vocab, t).map(i => VOCAB.split('\n')[i])
    expect(ids('Two ships sink near Hormuz.')).toEqual(['two', 'ship', '##s', 'sink', 'near', 'horm', '##uz', '.'])
    expect(ids('Iranian tanker')).toEqual(['tank', '##er'])   // "iranian" can't be pieced: the whole word goes
    expect(ids('Café Müller! 東京')).toEqual(['cafe', 'mu', '##ller', '!', '東', '京'])
    expect(tokenIds(vocab, 'x'.repeat(150))).toEqual([])        // over 100 characters: unknown
    expect(tokenIds(vocab, 'ship '.repeat(600))).toHaveLength(512)
  })
})

/** A model whose rows are known, to check the averaging */
function tinyModel(): FingerprintModel {
  const vocab = parseVocab(VOCAB)
  const rows = VOCAB.split('\n').length
  const scales = new Float32Array(rows).fill(1 / 127)
  const values = new Int8Array(rows * FINGERPRINT_DIMS)
  const ship = vocab.ids.get('ship') ?? 0
  const sink = vocab.ids.get('sink') ?? 0
  values[ship * FINGERPRINT_DIMS + 0] = 127   // "ship" points along dimension 0
  values[sink * FINGERPRINT_DIMS + 1] = 127   // "sink" along dimension 1
  return { vocab, rows, scales, values }
}

describe('fingerprints', () => {
  it('average the rows of the pieces and have length 1', () => {
    const v = fingerprintWith(tinyModel(), 'ship sink')
    expect(v).not.toBeNull()
    expect(v!.length).toBe(FINGERPRINT_DIMS)
    expect(v![0]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(v![1]).toBeCloseTo(Math.SQRT1_2, 5)
    expect(similarity(v!, v!)).toBeCloseTo(1, 5)
  })

  it('are null when no word is known', () => {
    expect(fingerprintWith(tinyModel(), 'zzzz qqqq')).toBeNull()
    expect(fingerprintWith(tinyModel(), '')).toBeNull()
  })

  it('compare by meaning: the same pieces score 1, unrelated ones 0', () => {
    const m = tinyModel()
    expect(similarity(fingerprintWith(m, 'ship')!, fingerprintWith(m, 'ships ship')!)).toBeCloseTo(1, 5)
    expect(similarity(fingerprintWith(m, 'ship')!, fingerprintWith(m, 'sink')!)).toBeCloseTo(0, 5)
  })

  it('are written in pgvector form, with no negative zero', () => {
    const v = new Float32Array(FINGERPRINT_DIMS)
    v[0] = 0.5; v[1] = -0.25; v[2] = -0
    const lit = toVectorLiteral(v)
    expect(lit.startsWith('[0.500000,-0.250000,0.000000,')).toBe(true)
    expect(lit.split(',')).toHaveLength(FINGERPRINT_DIMS)
  })

  it('are made from the headline and the start of the summary', () => {
    expect(reportText('Ships sink', 'Two ships sank near Hormuz on Thursday.')).toBe('Ships sink. Two ships sank near Hormuz on Thursday.')
    expect(reportText('Ships sink', 'Ships sink')).toBe('Ships sink')
    expect(reportText('Ships sink', null)).toBe('Ships sink')
    expect(reportText('T', 'x'.repeat(1000)).length).toBe(3 + 400)
  })

  it('name the model they come from', () => {
    expect(FINGERPRINT_MODEL).toBe('potion-retrieval-32M@6fc8051/256')
  })
})

/** A safetensors file of `rows` rows of 512 float32s */
function fakeTable(rows: number): Buffer {
  const header = Buffer.from(JSON.stringify({ embeddings: { dtype: 'F32', shape: [rows, 512], data_offsets: [0, rows * 2048] } }))
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(header.length))
  const data = Buffer.alloc(rows * 2048)
  for (let r = 0; r < rows; r++) for (let k = 0; k < 512; k++) data.writeFloatLE((r + 1) * (k % 7 - 3) / 100, (r * 512 + k) * 4)
  return Buffer.concat([len, header, data])
}

async function* chunks(buf: Buffer, size: number): AsyncIterable<Uint8Array> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size)
}

describe('the compact model file', () => {
  const file = fakeTable(5)
  const spec = { bytes: file.length, sha256: createHash('sha256').update(file).digest('hex'), rows: 5, dims: 512 }

  it('keeps the first 256 numbers of each row at 8 bits, whatever the download chunks', async () => {
    for (const size of [7, 1000, 1 << 20]) {
      const c = await convertTable(chunks(file, size), spec)
      expect(c.rows).toBe(5)
      // row 2, number 0: 3 * (0 - 3) / 100 = -0.09, the row's largest size
      expect((c.values[2 * FINGERPRINT_DIMS] ?? 0) * (c.scales[2] ?? 0)).toBeCloseTo(-0.09, 3)
      expect(c.values[2 * FINGERPRINT_DIMS]).toBe(-127)
    }
  })

  it('refuses a file that fails its checksum or ends early', async () => {
    await expect(convertTable(chunks(file, 1000), { ...spec, sha256: '0'.repeat(64) })).rejects.toThrow(/checksum/)
    await expect(convertTable(chunks(file.subarray(0, file.length - 2048), 1000), spec)).rejects.toThrow(/checksum|early/)
    await expect(convertTable(chunks(fakeTable(4), 1000), spec)).rejects.toThrow(/shape/)
  })

  it('reads back exactly what was written', async () => {
    const c = await convertTable(chunks(file, 4096), spec)
    const back = decodeCompact(encodeCompact(c.rows, c.scales, c.values))
    expect(back.rows).toBe(5)
    expect(Array.from(back.values)).toEqual(Array.from(c.values))
    expect(Array.from(back.scales)).toEqual(Array.from(c.scales))
    expect(() => decodeCompact(Buffer.from('nope'))).toThrow()
  })
})

describe('the two copies', () => {
  it('in the API and the scraper are identical', () => {
    const here = readFileSync(path.join(__dirname, '..', 'fingerprint.ts'), 'utf8')
    const api = readFileSync(path.join(__dirname, '..', '..', '..', '..', 'api', 'src', 'lib', 'fingerprint.ts'), 'utf8')
    expect(api).toBe(here)
  })
})

// The real model, when a copy is on disk (FINGERPRINT_DIR, or .cache/fingerprint)
const dir = process.env.FINGERPRINT_DIR || path.join(process.cwd(), '.cache', 'fingerprint')
const compact = path.join(dir, 'potion-retrieval-32M-6fc8051-256.i8')
const vocabFile = path.join(dir, 'potion-retrieval-32M-6fc8051.vocab.txt')
const haveModel = existsSync(compact) && existsSync(vocabFile)

describe.skipIf(!haveModel)('on the real model', () => {
  const model = (): FingerprintModel => ({ vocab: parseVocab(readFileSync(vocabFile, 'utf8')), ...decodeCompact(readFileSync(compact)) })

  it('puts two outlets\' headlines for one event close, and other stories far', () => {
    const m = model()
    const f = (t: string) => fingerprintWith(m, t)!
    const a = f('Two ships sink near Hormuz after being hit by projectiles amid surge in attacks')
    const b = f('Container Ship Sinks Near Hormuz After Being Hit by Projectile, Sources Say')
    const c = f('Pope Leo resumes work in hospital while recovering from surgery')
    expect(similarity(a, b)).toBeGreaterThan(0.6)
    expect(similarity(a, c)).toBeLessThan(0.3)
  })
})
