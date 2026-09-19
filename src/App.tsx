import { lazy, Suspense, useEffect, useState } from 'react'
import { ProductApp } from './engine/ProductApp'
import { ModelSelect } from './entry/ModelSelect'
import { PRODUCTS, productForPath } from './products'

// 개발 전용 모델 조각 뷰어. 동적 import라 프로덕션 번들에 들어가지 않는다.
const PartsViewer = import.meta.env.DEV ? lazy(() => import('./dev/PartsViewer').then((m) => ({ default: m.PartsViewer }))) : null

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const go = (to: string) => {
    window.history.pushState(null, '', to)
    setPath(to)
  }
  if (PartsViewer && path === '/dev/parts')
    return (
      <Suspense fallback={null}>
        <PartsViewer />
      </Suspense>
    )
  const product = productForPath(path)
  if (!product) return <ModelSelect products={PRODUCTS} onSelect={(p) => go(`/${p.id}`)} />
  return <ProductApp key={product.id} product={product} onBack={() => go('/')} />
}
