import { DicePanel } from './components/DicePanel/DicePanel'

export default function App() {
  return (
    <div style={{ 
      padding: '40px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh'
    }}>
      <DicePanel
        diceCount={2}
        showAddButton={false}
        onDieLanded={(index, value) => {
          console.log(`Die ${index + 1} landed on ${value}`)
        }}
        onAllLanded={(results, total) => {
          console.log('Final roll:', results, 'Total:', total)
        }}
      />
    </div>
  )
}


