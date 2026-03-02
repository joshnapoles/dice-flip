import styles from './App.module.css'
import { DicePanel } from './components/DicePanel/DicePanel'

export default function App() {
  return (
    <div className={styles.app}>
      <DicePanel diceCount={1} showAddButton={true} />
    </div>
  )
}


