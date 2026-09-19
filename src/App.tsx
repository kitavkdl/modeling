import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Tray } from './ui/Tray'

export default function App() {
  return (
    <div className="app">
      <Scene />
      <Hud />
      <Tray />
    </div>
  )
}
