import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createMaterialRegistry, type MaterialRegistry } from './materials'
import type { AssemblyState, AssemblyStore } from './store'
import type { ProductDef } from './types'

interface Ctx {
  product: ProductDef
  store: AssemblyStore
  materials: MaterialRegistry
}

const AssemblyContext = createContext<Ctx | null>(null)

export function AssemblyProvider({ product, store, children }: { product: ProductDef; store: AssemblyStore; children: ReactNode }) {
  const value = useMemo<Ctx>(() => ({ product, store, materials: createMaterialRegistry(product.materials) }), [product, store])
  return <AssemblyContext.Provider value={value}>{children}</AssemblyContext.Provider>
}

function useCtx(): Ctx {
  const c = useContext(AssemblyContext)
  if (!c) throw new Error('AssemblyProvider missing')
  return c
}

export const useProduct = () => useCtx().product
export const useAssemblyStore = () => useCtx().store
export const useMaterials = () => useCtx().materials
export function useAssembly<T>(selector: (s: AssemblyState) => T): T {
  return useStore(useCtx().store, selector)
}
