import { WalletConnection } from './components/WalletConnection';
import { TransferHistory } from './components/TransferHistory';
import { TotalSupply } from './components/TotalSupply';

export function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Octant</h1>
        <TotalSupply />
      </div>
      <WalletConnection />
      <TransferHistory />
    </div>
  );
}
