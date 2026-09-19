import { ProductApp } from './engine/ProductApp'
import { keyboardProduct } from './products/keyboard'

export default function App() {
  return <ProductApp product={keyboardProduct} onBack={() => {}} />
}
