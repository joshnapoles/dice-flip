import { DicePanel } from './components/DicePanel/DicePanel'

export default function App() {
  return (
    <div style={{ 
      padding: '40px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh'
    }}>
      <DicePanel
        diceCount={2}
        showAddButton={false}
      />
    </div>
  )
}



