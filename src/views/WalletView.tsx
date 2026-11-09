import { AssetsPage } from '../wallet/AssetsPage';
import { GiftsPage } from '../wallet/GiftsPage';
import { LedgerPage } from '../wallet/LedgerPage';
import { StocksPage } from '../wallet/StocksPage';
import { SubsPage } from '../wallet/SubsPage';

export type WalletPage = 'ledger' | 'assets' | 'stocks' | 'subs' | 'gifts';

export interface WalletFocus {
  date: string;
  action?: 'noTrade' | 'closed';
  nonce: number;
}

const PAGES: [WalletPage, string][] = [
  ['ledger', '記帳'],
  ['assets', '資產'],
  ['stocks', '股票'],
  ['subs', '訂閱'],
  ['gifts', '禮券'],
];

export function WalletView({ page, onPage, focus }: { page: WalletPage; onPage: (p: WalletPage) => void; focus?: WalletFocus }) {
  return (
    <div className="page wallet">
      <header className="page-header">
        <h2>錢包</h2>
      </header>
      <div className="segmented wallet-tabs">
        {PAGES.map(([id, label]) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => onPage(id)}>
            {label}
          </button>
        ))}
      </div>
      {page === 'ledger' && <LedgerPage />}
      {page === 'assets' && <AssetsPage openIncome={focus?.nonce} />}
      {page === 'stocks' && <StocksPage focus={focus} />}
      {page === 'subs' && <SubsPage />}
      {page === 'gifts' && <GiftsPage />}
    </div>
  );
}
