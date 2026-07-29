import { Button } from 'antd'

function App(): React.JSX.Element {
  return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[#1b1b1f]">
      <Button type="primary">Antd Primary</Button>
      <Button>Antd Default</Button>
      <div className="text-white text-lg font-bold">TailwindCSS</div>
    </div>
  )
}

export default App
