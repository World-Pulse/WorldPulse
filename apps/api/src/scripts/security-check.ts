/**
 * security-check.ts — Static security audit script for WorldPulse API
 *
 * Usage: tsx src/scripts/security-check.ts
 *
 * Checks:
 *  1. All route files have schema validation (no naked req.body access)
 *  2. Dangerous patterns: eval(), new Function(), direct SQL string concatenation
 *  3. Prints a summary: "X routes audited, Y risks found"
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// ─── Config ──────────────────────────────────────────────────────────────────

const ROUTES_DIR = join(__dirname, '..', 'routes')
const SRC_DIR    = join(__dirname, '..', '..', 'src')

// ─── Types ───────────────────────────────────────────────────────────────────

interface Finding {
  file:    string
  line:    number
  rule:    string
  snippet: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
}

// ─── Patterns to detect ───────────────────────────────────────────────────────

const DANGEROUS_PATTERNS: Array<{
  name:     string
  regex:    RegExp
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  description: string
}> = [
  {
    name:        'eval_usage',
    regex:       /\beval\s*\(/,
    severity:    'HIGH',
    description: 'eval() is dangerous — allows arbitrary code execution',
  },
  {
    name:        'function_constructor',
    regex:       /new\s+Function\s*\(/,
    severity:    'HIGH',
    description: 'new Function() is equivalent to eval()',
  },
  {
    name:        'sql_concatenation',
    regex:       /`[^`]*(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)[^`]*\$\{/i,
    severity:    'HIGH',
    description: 'SQL query with template literal interpolation — use parameterized queries',
  },
  {
    name:        'sql_plus_concat',
    regex:       /["'](SELECT|INSERT|UPDATE|DELETE|DROP|ALTER)\s[^"']*["']\s*\+/i,
    severity:    'HIGH',
    description: 'SQL query built with string concatenation (+) — use parameterized queries',
  },
  {
    name:        'naked_req_body',
    regex:       /req\.body\.[a-zA-Z_]+(?!\s*\?\?|\s*\|\||\s*&&)/,
    severity:    'MEDIUM',
    description: 'Direct req.body property access without validation — use Zod or JSON schema',
  },
  {
    name:        'child_process_exec',
    regex:       /\bexec\s*\(|\.exec\s*\(/,
    severity:    'HIGH',
    description: 'Shell exec detected — ensure no user input is interpolated',
  },
  {
    name:        'hardcoded_secret',
    regex:       /(?:password|secret|api_?key|token)\s*=\s*["'][a-zA-Z0-9+/=]{8,}["']/i,
    severity:    'HIGH',
    description: 'Possible hardcoded credential — use environment variables',
  },
  {
    name:        'console_log_sensitive',
    regex:       /console\.(log|debug)\s*\(.*(?:password|token|secret|jwt)/i,
    severity:    'MEDIUM',
    description: 'Possible logging of sensitive data to console',
  },
]

// ─── Schema validation check ─────────────────────────────────────────────────

/**
 * Check if a route file has JSON schema or Zod validation declared.
 * Returns true if at least one validation approach is found.
 */
function hasSchemaValidation(source: string): boolean {
  return (
    /\bschema\s*:\s*\{/.test(source)  ||  // Fastify JSON schema
    /z\.(object|string|number|enum|array)\(/.test(source) ||  // Zod
    /\bvalidate\s*\(/.test(source)
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scanFile(filePath: string, relativePath: string): Finding[] {
  let source: string
  try {
    source = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const lines = source.split('\n')
  const findings: Finding[] = []

  for (const pattern of DANGEROUS_PATTERNS) {
    lines.forEach((line, idx) => {
      // Skip comment lines
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

      if (pattern.regex.test(line)) {
        findings.push({
          file:     relativePath,
          line:     idx + 1,
          rule:     pattern.name,
          snippet:  line.trim().slice(0, 120),
          severity: pattern.severity,
        })
      }
    })
  }

  return findings
}

function getTypeScriptFiles(dir: string): string[] {
  let files: string[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        files = files.concat(getTypeScriptFiles(fullPath))
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        files.push(fullPath)
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return files
}

// ─── Route audit ─────────────────────────────────────────────────────────────

function auditRoutes(): { routesAudited: number; routesWithValidation: number; missingValidation: string[] } {
  let routeFiles: string[]
  try {
    routeFiles = readdirSync(ROUTES_DIR)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  } catch {
    console.error(`Could not read routes directory: ${ROUTES_DIR}`)
    return { routesAudited: 0, routesWithValidation: 0, missingValidation: [] }
  }

  let routesWithValidation = 0
  const missingValidation: string[] = []

  for (const file of routeFiles) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf-8')
    if (hasSchemaValidation(source)) {
      routesWithValidation++
    } else {
      missingValidation.push(file)
    }
  }

  return { routesAudited: routeFiles.length, routesWithValidation, missingValidation }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  WorldPulse API — Security Audit')
  console.log('═══════════════════════════════════════════════════\n')

  // 1. Route validation audit
  const { routesAudited, routesWithValidation, missingValidation } = auditRoutes()
  console.log(`📋 Route Schema Validation`)
  console.log(`   Routes audited: ${routesAudited}`)
  console.log(`   Routes with validation: ${routesWithValidation}/${routesAudited}`)
  if (missingValidation.length > 0) {
    console.log(`   ⚠  Routes missing validation:`)
    for (const f of missingValidation) {
      console.log(`      - ${f}`)
    }
  }
  console.log()

  // 2. Dangerous pattern scan across all source files
  const allFiles = getTypeScriptFiles(join(__dirname, '..'))
  const allFindings: Finding[] = []

  for (const filePath of allFiles) {
    // Skip test files, node_modules, and this script itself
    if (
      filePath.includes('__tests__') ||
      filePath.includes('node_modules') ||
      filePath.includes('security-check.ts')
    ) continue

    const relativePath = filePath.replace(join(__dirname, '..', '..'), '').replace(/^\//, '')
    const findings = scanFile(filePath, relativePath)
    allFindings.push(...findings)
  }

  // 3. Report findings grouped by severity
  const high   = allFindings.filter(f => f.severity === 'HIGH')
  const medium = allFindings.filter(f => f.severity === 'MEDIUM')
  const low    = allFindings.filter(f => f.severity === 'LOW')

  if (allFindings.length > 0) {
    console.log('🔍 Pattern Scan Findings')

    if (high.length > 0) {
      console.log(`\n   🔴 HIGH (${high.length})`)
      for (const f of high) {
        console.log(`      [${f.rule}] ${f.file}:${f.line}`)
        console.log(`        > ${f.snippet}`)
      }
    }

    if (medium.length > 0) {
      console.log(`\n   🟡 MEDIUM (${medium.length})`)
      for (const f of medium) {
        console.log(`      [${f.rule}] ${f.file}:${f.line}`)
        console.log(`        > ${f.snippet}`)
      }
    }

    if (low.length > 0) {
      console.log(`\n   🔵 LOW (${low.length})`)
      for (const f of low) {
        console.log(`      [${f.rule}] ${f.file}:${f.line}`)
        console.log(`        > ${f.snippet}`)
      }
    }
  } else {
    console.log('🔍 Pattern Scan: ✅ No dangerous patterns detected\n')
  }

  // 4. Summary
  const totalRisks = allFindings.length + missingValidation.length
  console.log('\n═══════════════════════════════════════════════════')
  console.log(`  SUMMARY: ${routesAudited} routes audited, ${totalRisks} risks found`)
  if (high.length > 0) {
    console.log(`  ⚠  ${high.length} HIGH severity finding(s) require immediate attention`)
  }
  console.log('═══════════════════════════════════════════════════\n')

  // Exit with non-zero if HIGH findings exist (useful in CI)
  if (high.length > 0) {
    process.exit(1)
  }
}

main()
