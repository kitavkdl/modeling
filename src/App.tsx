import { useEffect, useState } from 'react'
import { ProductApp } from './engine/ProductApp'
import { ModelSelect } from './entry/ModelSelect'
import { PRODUCTS, productForPath } from './products'

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
  const product = productForPath(path)
  if (!product) return <ModelSelect products={PRODUCTS} onSelect={(p) => go(`/${p.id}`)} />
  return <ProductApp key={product.id} product={product} onBack={() => go('/')} />
}
