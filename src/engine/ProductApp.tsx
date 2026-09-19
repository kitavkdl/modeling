import { useEffect, useMemo } from 'react'
import { AssemblyProvider } from './context'
import { Scene } from './scene/Scene'
import { createAssemblyStore } from './store'
import type { ProductDef } from './types'
import { Hud } from './ui/Hud'
import { Tray } from './ui/Tray'

export function ProductApp({ product, onBack }: { product: ProductDef; onBack: () => void }) {
  const store = useMemo(() => createAssemblyStore(product), [product])
  useEffect(() => {
    // 개발 중 콘솔에서 상태를 만지기 위한 훅. 프로덕션 번들에는 들어가지 않는다.
    if (import.meta.env.DEV) (window as unknown as { __assembly?: unknown }).__assembly = store
  }, [store])
  useEffect(() => {
    document.title = `${product.nameEn} · Assembly`
    return () => {
      document.title = 'Assembly'
    }
  }, [product])
  return (
    <AssemblyProvider product={product} store={store}>
      <div className="app">
        <Scene />
        <Hud onBack={onBack} />
        <Tray />
      </div>
    </AssemblyProvider>
  )
}
