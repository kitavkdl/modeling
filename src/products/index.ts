import type { ProductDef } from '../engine/types'
import { keyboardProduct } from './keyboard'

export const PRODUCTS: ProductDef[] = [keyboardProduct]

export function productForPath(pathname: string): ProductDef | null {
  const path = pathname.split(/[?#]/, 1)[0]
  const id = path.replace(/^\/+|\/+$/g, '')
  return PRODUCTS.find((p) => p.id === id) ?? null
}
