import { Titlebar } from './shell/Titlebar'
import { StatusBar } from './shell/StatusBar'
import { Workspace } from './shell/Workspace'

function App(): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Titlebar />
      <Workspace />
      <StatusBar />
    </div>
  )
}

export default App
