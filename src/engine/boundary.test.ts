import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// engine은 특정 제품을 몰라야 하고, 제품끼리도 서로를 몰라야 한다.
// 다음 제품(닌자 400)이 들어오기 전에 이 경계가 깨지지 않았는지 확인한다.

/** 디렉터리 아래 .ts/.tsx 파일을 재귀적으로 나열한다. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSourceFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** import ... from '...' / require('...') / import('...') 안의 모듈 지정자만 뽑는다. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = []
  const re = /(?:from\s+|import\(|require\()\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) specs.push(m[1])
  return specs
}

const ENGINE_DIR = path.resolve(__dirname)
const PRODUCTS_DIR = path.resolve(__dirname, '../products')

describe('engine import boundary', () => {
  it('engine의 비 테스트 코드는 products/ 를 import하지 않는다', () => {
    const files = listSourceFiles(ENGINE_DIR).filter((f) => !/\.test\.tsx?$/.test(f))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf-8')
      for (const spec of importSpecifiers(source)) {
        expect(spec.includes('products/'), `${file} imports "${spec}"`).toBe(false)
      }
    }
  })
})

describe('product-to-product import boundary', () => {
  const productNames = fs
    .readdirSync(PRODUCTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it('제품 폴더는 다른 제품 폴더를 import하지 않는다', () => {
    expect(productNames.length).toBeGreaterThan(0)
    for (const name of productNames) {
      const others = productNames.filter((n) => n !== name)
      const files = listSourceFiles(path.join(PRODUCTS_DIR, name))
      for (const file of files) {
        const source = fs.readFileSync(file, 'utf-8')
        for (const spec of importSpecifiers(source)) {
          for (const other of others) {
            const touchesOther = spec === `../${other}` || spec.startsWith(`../${other}/`) || spec.includes(`products/${other}`)
            expect(touchesOther, `${file} imports "${spec}" (other product: ${other})`).toBe(false)
          }
        }
      }
    }
  })
})
