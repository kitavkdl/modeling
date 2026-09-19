import type { ProductDef } from '../engine/types'
import { keyboardProduct } from './keyboard'
import { ninja400Product } from './ninja400'

export const PRODUCTS: ProductDef[] = [keyboardProduct, ninja400Product]

export function productForPath(pathname: string): ProductDef | null {
  const path = pathname.split(/[?#]/, 1)[0]
  const id = path.replace(/^\/+|\/+$/g, '')
  return PRODUCTS.find((p) => p.id === id) ?? null
}
