import type { ProductDef } from '../engine/types'
import { keyboardProduct } from './keyboard'

export const PRODUCTS: ProductDef[] = [keyboardProduct]

export function productForPath(pathname: string): ProductDef | null {
  const id = pathname.replace(/^\/+|\/+$/g, '')
  return PRODUCTS.find((p) => p.id === id) ?? null
}
